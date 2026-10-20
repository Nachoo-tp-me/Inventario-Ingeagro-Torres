// C1-B: getSignedProductImages real (lib/product-catalog.ts) con un cliente de Storage simulado: los fallos recuperables
// degradan a «sin foto»; autenticación, autorización y configuración se propagan. Sin red, sin Supabase, sin .env.
// Node >=22; esbuild externo. SHELVES_TEST_TOOLS=<tools> node --test tests/product-images.integration.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { root, requireTools } from './helpers/shelves-fixture.mjs';
const { build } = requireTools('esbuild');

const apiError = (message, status) => Object.assign(new Error(message), { name: 'StorageApiError', status, statusCode: String(status) });
const unknownError = (message, original) => Object.assign(new Error(message), { name: 'StorageUnknownError', originalError: original });

async function load() {
  const result = await build({ stdin: { resolveDir: root, loader: 'ts', contents: "export { getSignedProductImages } from './lib/product-catalog';" }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{ name: 'fake-auth', setup(b) {
      b.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: 'fake-auth', namespace: 'fake' }));
      b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ loader: 'js', contents: 'export async function requireAuthorizedUser(){const state=globalThis.__images;state.auth++;if(state.denied)throw new Error("No autorizado");return {storage:{from(bucket){state.buckets.push(bucket);return {async createSignedUrls(paths,seconds){state.calls.push({paths,seconds});return state.respond(paths)}}}}}}' }));
    } }] });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

test('getSignedProductImages: degradación recuperable y propagación de errores críticos', async t => {
  const { getSignedProductImages } = await load();
  const state = globalThis.__images = { auth: 0, denied: false, calls: [], buckets: [], respond: paths => ({ data: paths.map(path => ({ signedUrl: 'https://signed.test/' + path })), error: null }) };
  const logged = []; const original = console.error; console.error = (...args) => logged.push(args); t.after(() => { console.error = original; });
  const reset = () => { state.auth = 0; state.denied = false; state.calls.length = 0; state.buckets.length = 0; logged.length = 0; };

  await t.test('éxito: duplicados y nulos se omiten, 3600 s, un solo cliente autorizado', async () => {
    reset(); const urls = await getSignedProductImages(['a.jpg', null, 'a.jpg', 'b.png']);
    assert.deepEqual([...urls], [['a.jpg', 'https://signed.test/a.jpg'], ['b.png', 'https://signed.test/b.png']]); assert.deepEqual(state.calls, [{ paths: ['a.jpg', 'b.png'], seconds: 3600 }]); assert.equal(state.auth, 1);
    reset(); assert.equal((await getSignedProductImages([null, null])).size, 0); assert.equal(state.auth, 0, 'sin rutas no se consulta Storage');
  });

  await t.test('fallo recuperable (5xx, red, tiempo de espera): catálogo/búsqueda/estantes reciben un mapa vacío y se registra solo un código', async () => {
    for (const error of [apiError('Bad gateway https://x.supabase.co/object/sign/product-images/p-1/foto.jpg?token=SECRETO', 502), unknownError('fetch failed', new TypeError('fetch failed')), apiError('Request timeout', 408)]) {
      reset(); state.respond = () => ({ data: null, error });
      const urls = await getSignedProductImages(['p-1/foto.jpg']); assert.equal(urls.size, 0, 'sin foto, sin excepción');
      assert.equal(logged.length, 1); const text = JSON.stringify(logged[0]); assert.ok(!/SECRETO|p-1|supabase|foto\.jpg/.test(text), 'el registro no contiene rutas, URLs ni tokens'); assert.match(text, /"code":"(502|408|StorageUnknownError)"/);
    }
  });

  await t.test('autorización, configuración y programación se propagan sin degradar', async () => {
    for (const error of [apiError('Unauthorized', 401), apiError('new row violates row-level security policy', 403), apiError('Bucket not found', 404), apiError('Invalid API key', 400)]) {
      reset(); state.respond = () => ({ data: null, error }); await assert.rejects(getSignedProductImages(['p-1/foto.jpg']), actual => actual === error); assert.equal(logged.length, 0);
    }
    reset(); state.respond = () => { throw new TypeError('storage is undefined'); }; await assert.rejects(getSignedProductImages(['x.jpg']), /storage is undefined/);
    reset(); state.denied = true; await assert.rejects(getSignedProductImages(['x.jpg']), /No autorizado/); assert.equal(state.calls.length, 0, 'sin sesión autorizada no se firma nada');
  });

  await t.test('con 150 rutas y un trozo caído, el resto se firma', async () => {
    reset(); const paths = Array.from({ length: 150 }, (_, i) => `p/${i}.jpg`); let first = true;
    state.respond = chunk => { if (first) { first = false; return { data: null, error: apiError('Service unavailable', 503) }; } return { data: chunk.map(path => ({ signedUrl: 'u:' + path })), error: null }; };
    const urls = await getSignedProductImages(paths); assert.equal(state.calls.length, 2); assert.equal(urls.size, 50); assert.equal(urls.get('p/149.jpg'), 'u:p/149.jpg'); assert.equal(urls.has('p/0.jpg'), false);
  });
});
