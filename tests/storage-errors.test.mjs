// C1-B: el firmado de fotografías degrada solo ante fallos recuperables de Storage; autenticación, autorización,
// configuración y errores de programación se propagan. Respuestas de Storage simuladas (sin red ni Supabase real).
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyStorageError, signImagePaths, storageLogCode } from '../lib/storage-errors.ts';

// Misma forma que storage-js: StorageApiError (status HTTP) y StorageUnknownError (fallo de transporte).
const apiError = (message, status) => Object.assign(new Error(message), { name: 'StorageApiError', status, statusCode: String(status) });
const unknownError = (message, original) => Object.assign(new Error(message), { name: 'StorageUnknownError', originalError: original });
const ok = urls => ({ data: urls.map(signedUrl => ({ signedUrl })), error: null });

test('clasificación: recuperables', () => {
  for (const error of [apiError('Bad gateway', 502), apiError('Internal error', 500), apiError('Service unavailable', 503), apiError('Request timeout', 408), apiError('Too many requests', 429),
    unknownError('fetch failed', new TypeError('fetch failed')), unknownError('The operation was aborted', Object.assign(new Error('x'), { name: 'AbortError' })), unknownError('ECONNRESET socket hang up')])
    assert.equal(classifyStorageError(error), 'recoverable', error.message);
});

test('clasificación: se propagan autenticación, autorización, configuración y programación', () => {
  for (const error of [apiError('Unauthorized', 401), apiError('Forbidden', 403), apiError('new row violates row-level security policy', 403), apiError('Bucket not found', 404), apiError('Object not found', 404),
    apiError('Invalid JWT', 400), apiError('Bad request', 400), apiError('The JWT has expired', 500), apiError('Invalid API key', 502),
    new TypeError('Cannot read properties of undefined'), new Error('boom'), unknownError('Unexpected token < in JSON at position 0'), 'texto', null, undefined, 42])
    assert.equal(classifyStorageError(error), 'propagate', String(error?.message ?? error));
});

test('un mensaje de pasarela que cita una URL con «token» sigue siendo recuperable; JWT inválido o expirado no', () => {
  assert.equal(classifyStorageError(apiError('Bad gateway https://x.supabase.co/object/sign/b/p.jpg?token=abc', 502)), 'recoverable');
  for (const message of ['Invalid token', 'JWT expired', 'jwt malformed', 'Token is expired', 'invalid signature']) assert.equal(classifyStorageError(apiError(message, 502)), 'propagate', message);
});

test('el texto de acceso/configuración manda aunque el estado parezca recuperable', () => {
  assert.equal(classifyStorageError(apiError('Invalid JWT', 503)), 'propagate');
  assert.equal(classifyStorageError(apiError('Bucket not found', 502)), 'propagate');
});

test('storageLogCode devuelve solo el estado o el nombre, nunca mensajes ni rutas', () => {
  assert.equal(storageLogCode(apiError('secret path prod-1/image.jpg', 503)), '503');
  assert.equal(storageLogCode(unknownError('fetch failed https://x.supabase.co/storage?token=abc')), 'StorageUnknownError');
  assert.equal(storageLogCode({ name: 'x y z', message: 'm' }), 'storage');
  assert.equal(storageLogCode(null), 'storage');
});

test('signImagePaths: éxito, rutas sin URL y orden por trozos', async () => {
  const calls = [];
  const urls = await signImagePaths(['a', 'b', 'c'], async chunk => { calls.push(chunk); return chunk.length === 2 ? { data: [{ signedUrl: 'u-a' }, { signedUrl: null }], error: null } : ok(['u-c']); }, () => assert.fail('sin errores'), 2);
  assert.deepEqual(calls, [['a', 'b'], ['c']]); assert.deepEqual([...urls], [['a', 'u-a'], ['c', 'u-c']]);
  assert.deepEqual([...await signImagePaths([], async () => assert.fail('no se llama'), () => {})], []);
});

test('fallo recuperable: el trozo afectado queda sin foto, los demás se firman y solo se informa un código', async () => {
  const reported = [];
  const urls = await signImagePaths(['a', 'b', 'c'], async chunk => chunk[0] === 'a' ? { data: null, error: apiError('Bad gateway secret-path', 502) } : ok(['u-c']), code => reported.push(code), 2);
  assert.deepEqual([...urls], [['c', 'u-c']]); assert.deepEqual(reported, ['502']);
  const network = await signImagePaths(['a'], async () => ({ data: null, error: unknownError('fetch failed', new TypeError('fetch failed')) }), code => reported.push(code));
  assert.equal(network.size, 0); assert.deepEqual(reported, ['502', 'StorageUnknownError']);
});

test('fallo de autorización/configuración: se propaga el mismo error y no se informa como recuperable', async () => {
  for (const error of [apiError('Unauthorized', 401), apiError('new row violates row-level security policy', 403), apiError('Bucket not found', 404), apiError('Invalid API key', 400)]) {
    const reported = [];
    await assert.rejects(signImagePaths(['a'], async () => ({ data: null, error }), code => reported.push(code)), actual => actual === error);
    assert.deepEqual(reported, []);
  }
});

test('una excepción lanzada al firmar (programación) se propaga sin degradar', async () => {
  const boom = new TypeError('storage is undefined');
  await assert.rejects(signImagePaths(['a'], async () => { throw boom; }, () => assert.fail('no se informa')), actual => actual === boom);
});
