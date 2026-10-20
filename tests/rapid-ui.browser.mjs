// UI06: Carga rápida (inicio y ubicación). Componentes reales RapidStart y RapidLocation dentro de AppShell, con el
// ProductForm REAL en modo quick (sin stub). Servicios sintéticos: acciones de stock y resolución de códigos contra el
// fixture de estantes; cliente Supabase del formulario en memoria. Sin red externa, sin .env, sin Supabase real.
// Node >=22; esbuild y Playwright externos. SHELVES_TEST_TOOLS=<tools>; RAPID_UI_ARTIFACTS=<ruta externa opcional>.
// RAPID_UI_SRC=<copia del código a medir> y RAPID_UI_BASELINE=1 solo sirven para medir un commit anterior (sin umbrales).
// node --test tests/rapid-ui.browser.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createShelfFixture, productId, secondProductId, root as repoRoot, requireTools } from './helpers/shelves-fixture.mjs';
const { build } = requireTools('esbuild'); const { chromium } = requireTools('playwright');
const root = process.env.RAPID_UI_SRC ?? repoRoot, baseline = process.env.RAPID_UI_BASELINE === '1';

const fixtureSource = `
  import {useEffect,useState,useSyncExternalStore} from 'react';
  import {createRoot} from 'react-dom/client';
  import {AppShell} from './components/app-shell';
  import {RapidStart} from './components/rapid-start';
  import {RapidLocation} from './components/rapid-location';
  const subscribe=cb=>{addEventListener('popstate',cb);return()=>removeEventListener('popstate',cb)};
  function Current(){
    const url=useSyncExternalStore(subscribe,()=>location.pathname+location.search);
    const [data,setData]=useState(null),[error,setError]=useState(''),[epoch,setEpoch]=useState(0);
    useEffect(()=>{window.__refresh=()=>{window.__refreshes=(window.__refreshes||0)+1;setEpoch(v=>v+1)};return()=>delete window.__refresh},[]);
    useEffect(()=>{let active=true;setError('');fetch('/data?path='+encodeURIComponent(url)).then(async r=>{if(!r.ok)throw new Error(await r.text());return r.json()}).then(value=>{if(!active)return;if(value.redirect){history.replaceState({},'',value.redirect);dispatchEvent(new PopStateEvent('popstate'));return}setData(value)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[url,epoch]);
    if(error)return <p role="alert">{error}</p>;if(!data||data.path!==url)return <p>Cargando…</p>;
    return data.kind==='start'?<RapidStart {...data.props}/>:<RapidLocation key={data.props.current.id} {...data.props}/>;
  }
  createRoot(document.getElementById('root')).render(<AppShell><Current/></AppShell>);
`;
const fakes = {
  link: `import {createElement} from 'react';export default function Link({href,children,...props}){return createElement('a',{...props,href,onClick:e=>{e.preventDefault();history.pushState({},'',href);dispatchEvent(new PopStateEvent('popstate'))}},children)}`,
  navigation: `import {useSyncExternalStore} from 'react';const subscribe=cb=>{addEventListener('popstate',cb);return()=>removeEventListener('popstate',cb)};export function usePathname(){return useSyncExternalStore(subscribe,()=>location.pathname)};export function useRouter(){return {push(path){history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'))},replace(path){history.replaceState({},'',path);dispatchEvent(new PopStateEvent('popstate'))},refresh(){window.__refresh?.()}}}`,
  stock: `export async function submitStockOperation(input){window.__stockCalls=(window.__stockCalls||0)+1;const r=await fetch('/action',{method:'POST',body:JSON.stringify(input)});if(!r.ok)throw new Error('Synthetic action failure');return r.json()}`,
  rapid: `export async function resolveRapidCode(code){const r=await fetch('/resolve',{method:'POST',body:JSON.stringify(code)});if(!r.ok)throw new Error('Synthetic lookup failure');return r.json()}`,
  box: `export async function renameBoxCode(){throw new Error('Synthetic fixture only')}`,
  // Cliente Supabase del ProductForm: registra cada llamada; la inserción llega al fixture para que la entrada de stock la vea.
  supabase: `const wait=ms=>new Promise(r=>setTimeout(r,ms));
    function builder(table){const s={table,op:'select'};const api={select(){return api},insert(values){s.op='insert';s.values=values;return api},update(){s.op='update';return api},eq(){return api},order(){return api},range(from){s.from=from;return api},single(){return api},maybeSingle(){return api},then(res,rej){return run(s).then(res,rej)}};return api}
    async function run(s){const mode=window.__mode;window.__calls.push({table:s.table,op:s.op,values:s.values??null});if(mode.delay)await wait(mode.delay);
      if(s.table==='categorias'){if(s.op==='insert')return mode.category==='duplicate'?{data:null,error:{code:'23505'}}:{data:{id:'cat-new',nombre:s.values.nombre},error:null};return{data:window.__categories,error:null}}
      if(s.op==='select')return{data:s.from>0?[]:window.__existing,error:null};
      if(s.op==='insert'){if(mode.insert)return{data:null,error:{code:'500'}};await fetch('/product',{method:'POST',body:JSON.stringify(s.values)});return{data:null,error:null}}
      return{data:null,error:null}}
    export function createSupabaseClient(){return{from:builder,storage:{from(){return{async upload(){return{error:null}},async remove(){return{error:null}}}}}}}`,
};
const lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const flat = s => s.replace(/\s+/g, ' ').trim();

test('UI06: carga rápida, componentes reales y ProductForm quick real', async t => {
  const directory = process.env.RAPID_UI_ARTIFACTS ?? await mkdtemp(path.join(tmpdir(), 'ingeagro-rapid-ui-'));
  await mkdir(directory, { recursive: true }); t.diagnostic(`Capturas sintéticas: ${directory}`);
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: fixtureSource }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'offline-only', setup(b) {
    b.onResolve({ filter: /^(next\/(link|navigation)|@\/lib\/supabase\/client|@\/app\/\(workspace\)\/(stock-actions|rapid-actions|box-code-actions))$/ }, args => ({ path: args.path, namespace: 'fake' }));
    b.onLoad({ filter: /.*/, namespace: 'fake' }, args => ({ resolveDir: root, contents: args.path === 'next/link' ? fakes.link : args.path === 'next/navigation' ? fakes.navigation
      : args.path.endsWith('/supabase/client') ? fakes.supabase : args.path.endsWith('/stock-actions') ? fakes.stock : args.path.endsWith('/box-code-actions') ? fakes.box : fakes.rapid }));
  } }] });
  const css = (await Promise.all(['app/globals.css', 'app/theme.css', 'app/catalog.css', 'app/stock.css', 'app/rapid.css', 'app/shelves.css', 'components/tower-view.css'].map(file => readFile(path.join(root, file), 'utf8')))).join('\n').replace('@import "tailwindcss";', '');
  let f = createShelfFixture();
  const server = createServer(async (req, res) => {
    try {
      const target = new URL(req.url, 'http://fixture.test');
      const body = async () => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString() || 'null'); };
      if (target.pathname === '/data') {
        const raw = target.searchParams.get('path'), url = new URL(raw, 'http://fixture.test'); let page, kind;
        if (url.pathname === '/carga') { page = await f.rapidStartPage(); page = page.props.children[1]; kind = 'start'; }
        else { page = url.pathname.startsWith('/carga/ubicacion/') ? await f.rapidBoxPage({ params: Promise.resolve({ id: url.pathname.split('/')[3] }) }) : await f.rapidTowerPage({ params: Promise.resolve({ codigo: decodeURIComponent(url.pathname.split('/')[2]) }) }); kind = 'location'; }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ path: raw, kind, props: page.props }));
      } else if (target.pathname === '/action' || target.pathname === '/resolve') {
        const input = await body(); if (target.pathname === '/action') (f.state.actionInputs ??= []).push(input); if (target.pathname === '/action' && f.state.transportFails) { response.statusCode = 503; response.end('Bad gateway'); return; } const result = target.pathname === '/action' ? await f.submitStockOperation(input) : await f.resolveRapidCode(input);
        if (target.pathname === '/action' && f.state.responseDelay) await new Promise(resolve => setTimeout(resolve, f.state.responseDelay));
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
      } else if (target.pathname === '/product') {
        const input = await body(); f.state.tables.productos.push({ id: input.id, nombre: input.nombre, categoria_id: input.categoria_id, foto_ruta: null }); f.state.productInserts = (f.state.productInserts ?? 0) + 1;
        res.setHeader('Content-Type', 'application/json'); res.end('{}');
      } else if (target.pathname === '/fixture.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].text); }
      else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>window.__calls=[];window.__mode=Object.assign({},(window.__init||{}).mode);window.__existing=(window.__init||{}).existing||[];window.__categories=${JSON.stringify(f.state.tables.categorias)};</script><script src="/fixture.js"></script></html>`); }
    } catch (error) { if (error.message.startsWith('REDIRECT:')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ redirect: error.message.slice(9) })); } else { res.statusCode = 503; res.end(error.message); } }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch(); t.after(() => browser.close());
  const errorsOf = new WeakMap();
  async function open(route, { width = 390, height = 844, theme = 'light', init = {}, storage = {}, reduced = false } = {}) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 400, reducedMotion: reduced ? 'reduce' : 'no-preference' }); page.setDefaultTimeout(7000);
    const errors = []; errorsOf.set(page, errors); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', r => r.request().url().startsWith(url) ? r.continue() : r.abort());
    await page.addInitScript(({ init, storage }) => { window.__init = init; for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v); }, { init, storage });
    await page.goto(url + route); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await page.waitForFunction(() => !document.getAnimations().length);
    await page.waitForFunction(() => document.querySelector('.rapid-location-page, .rapid-start-layout')); return page;
  }
  const activeIs = (page, selector) => page.evaluate(selector => document.activeElement?.matches(selector), selector);
  const addProduct = (page, name = /Añadir (otro )?producto/) => page.getByRole('button', { name, exact: false }).first().click();
  async function pick(page, search, product) {
    await addProduct(page); await page.getByRole('searchbox', { name: 'Buscar producto existente' }).fill(search);
    await page.locator('.rapid-select-list').getByRole('button', { name: product }).click(); await page.getByLabel('Cantidad', { exact: true }).waitFor();
  }
  const submitText = page => page.getByRole('button', { name: /Guardar entrada/ });

  await t.test('entrada en torre: pasos, stock registrado, cantidades inválidas, doble envío y foco', async () => {
    f = createShelfFixture(); const page = await open('/carga/C111');
    assert.match(await page.locator('.rapid-location-header').innerText(), /TORRE C1 · PISO 1/);
    const primary = page.getByRole('button', { name: 'Añadir otro producto', exact: true }); await primary.click();
    assert.equal(await activeIs(page, 'input[type=search]'), true, 'la búsqueda recibe el foco al abrir el paso 1');
    assert.equal(flat(await page.locator('.rapid-step-label').textContent()), 'Paso 1 de 2 · Producto');
    assert.match(await page.locator('.rapid-result-count').innerText(), /^2 productos$/);
    await page.getByRole('searchbox', { name: 'Buscar producto existente' }).fill('modulo');
    assert.match(await page.locator('.rapid-result-count').innerText(), /^1 producto$/);
    await page.locator('.rapid-select-list').getByRole('button', { name: /Módulo térmico/ }).click();
    const quantity = page.getByLabel('Cantidad', { exact: true });
    assert.equal(flat(await page.locator('.rapid-step-label').textContent()), 'Paso 2 de 2 · Cantidad');
    assert.equal(flat(await page.locator('#rapid-registered').innerText()), 'Stock registrado en C111: 11 unidades');
    assert.equal(await activeIs(page, '#rapid-quantity'), true);
    assert.equal(flat(await page.locator('#rapid-quantity-unit').innerText()), 'unidades');
    assert.equal(await quantity.getAttribute('aria-describedby'), 'rapid-registered rapid-quantity-unit'); assert.equal(await quantity.getAttribute('aria-invalid'), null);
    for (const bad of ['', '0', 'abc', '1.5', '-2', '  ']) {
      await quantity.fill(bad); await submitText(page).click();
      const alert = page.getByRole('alert'); await alert.waitFor(); assert.equal(flat(await alert.innerText()), 'La cantidad debe ser un entero mayor que cero.');
      assert.equal(await quantity.getAttribute('aria-invalid'), 'true', `aria-invalid con «${bad}»`);
      assert.equal(await quantity.getAttribute('aria-describedby'), 'rapid-registered rapid-quantity-unit rapid-quantity-error');
      assert.equal(await activeIs(page, '#rapid-quantity'), true, 'el foco vuelve a la cantidad inválida');
      assert.equal(await page.evaluate(() => window.__stockCalls ?? 0), 0); assert.equal(f.state.writes.length, 0);
    }
    await quantity.fill('3'); assert.equal(await quantity.getAttribute('aria-invalid'), null, 'escribir limpia el error'); assert.equal(await page.getByRole('alert').count(), 0);
    f.state.responseDelay = 400;
    await page.locator('.rapid-step form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    assert.equal(await submitText(page).count(), 0, 'mientras guarda el botón cambia de texto'); assert.equal(await page.getByRole('button', { name: 'Guardando…' }).isDisabled(), true);
    const notice = page.getByRole('status').filter({ hasText: 'unidades registradas' }); await notice.waitFor();
    assert.equal(await notice.count(), 1, 'un solo aviso de éxito'); assert.match(await notice.innerText(), /Módulo térmico: \+3 unidades registradas en C111\./);
    assert.equal(f.state.writes.length, 1); assert.deepEqual([f.state.writes[0].tipo, f.state.writes[0].destino_compartimiento_id, f.state.writes[0].producto_id, f.state.writes[0].cantidad], ['entrada', 1, productId, 3]);
    await page.waitForFunction(() => [...document.querySelectorAll('.rapid-product')].some(row => row.querySelector(':scope > strong')?.textContent === '14'));
    assert.equal(await activeIs(page, '.rapid-primary'), true, 'tras completar, el foco queda en «Añadir otro producto»');
    assert.equal(await page.locator('.rapid-notice').getAttribute('role'), 'status');
    assert.deepEqual(errorsOf.get(page), []); await page.close();
  });

  await t.test('entrada en caja vacía: sin stock registrado, error de servidor conserva los datos y cancelar no escribe', async () => {
    f = createShelfFixture(); const page = await open('/carga/ubicacion/74');
    assert.equal(await page.locator('.rapid-code').innerText(), 'A2'); assert.match(await page.locator('.rapid-location-header').innerText(), /Estante 1 · Superior derecha/);
    assert.equal(await page.getByText('Sin productos. Puedes continuar sin registrar stock.').count(), 1);
    await addProduct(page, 'Añadir producto'); await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(await activeIs(page, '.rapid-primary'), true, 'cancelar devuelve el foco al botón principal'); assert.equal(f.state.writes.length, 0);
    await pick(page, 'esp32', /ESP32-S3/); assert.equal(await page.locator('#rapid-registered').count(), 0);
    const quantity = page.getByLabel('Cantidad', { exact: true }); await quantity.fill('2');
    f.state.entryError = '23514'; await submitText(page).click();
    await page.getByRole('alert').filter({ hasText: 'stock suficiente' }).waitFor();
    assert.equal(await quantity.inputValue(), '2', 'la cantidad se conserva'); assert.equal(await quantity.getAttribute('aria-invalid'), null, 'un error de servidor no se asocia al campo');
    assert.equal(await submitText(page).isEnabled(), true);
    f.state.entryError = null; await submitText(page).click(); await page.getByRole('status').filter({ hasText: 'unidades registradas en A2' }).waitFor();
    assert.equal(f.state.writes.filter(w => !w.error).length >= 1, true);
    assert.equal(f.state.tables.inventario.find(r => r.compartimiento_id === 74 && r.producto_id === secondProductId).cantidad, 2);
    assert.deepEqual(errorsOf.get(page), []); await page.close();
  });

  await t.test('ProductForm quick REAL dentro de RapidLocation: foco, cancelar, crear, onCreated → cantidad → confirmar', async () => {
    f = createShelfFixture(); const page = await open('/carga/ubicacion/74');
    await addProduct(page, 'Añadir producto'); await page.getByRole('button', { name: 'Crear nuevo producto' }).click();
    const step = page.getByRole('region', { name: 'Crear producto durante la carga' }); await step.waitFor();
    assert.equal(flat(await step.locator('.rapid-step-label').textContent()), 'Paso 1 de 2 · Producto');
    assert.equal(await activeIs(page, '.rapid-step h2'), true, 'el foco pasa al encabezado del paso al crear'); assert.equal(flat(await step.locator('h2').first().innerText()), 'Nuevo producto para A2');
    const form = step.locator('form.catalog-form'); assert.equal(await form.count(), 1, 'ProductForm real');
    const details = form.locator('details.quick-more-details.compact'); assert.equal(await details.evaluate(d => d.open), false, '<details> cerrado');
    assert.equal(flat(await form.locator('button[type=submit]').innerText()), 'Agregar producto');
    // Validación del formulario real: nombre vacío → mensaje exacto asociado al campo
    await form.locator('button[type=submit]').click(); assert.equal(flat(await page.locator('#product-name-error').innerText()), 'Escribe un nombre para el producto.');
    assert.equal(await page.locator('#product-name').getAttribute('aria-invalid'), 'true'); assert.equal(await activeIs(page, '#product-name'), true);
    // Cancelar → vuelve a la selección sin escrituras
    await step.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('region', { name: 'Seleccionar producto' }).waitFor(); assert.equal(await activeIs(page, 'input[type=search]'), true);
    assert.equal(f.state.writes.length, 0); assert.equal((await page.evaluate(() => window.__calls)).filter(c => c.op === 'insert').length, 0); assert.equal(f.state.productInserts ?? 0, 0);
    // Crear con categoría nueva
    await page.getByRole('button', { name: 'Crear nuevo producto' }).click(); await page.locator('#product-category').selectOption('__new__');
    await page.locator('#category-name').fill('Cables'); await page.getByRole('button', { name: 'Crear categoría' }).click();
    await page.waitForFunction(() => document.querySelector('#product-category')?.value === 'cat-new');
    assert.equal((await page.evaluate(() => window.__calls)).filter(c => c.table === 'categorias' && c.op === 'insert').length, 1);
    await page.locator('#product-name').fill('Cable USB-C 2 m'); await page.locator('form.catalog-form button[type=submit]').click();
    await page.getByLabel('Cantidad', { exact: true }).waitFor();
    assert.equal(flat(await page.locator('.rapid-step-label').textContent()), 'Paso 2 de 2 · Cantidad'); assert.equal(flat(await page.locator('.rapid-step h2').innerText()), 'Cable USB-C 2 m');
    assert.match(await page.locator('.rapid-step > p:not(.rapid-step-label):not(.rapid-registered)').first().innerText(), /Cables · Destino A2/);
    assert.equal(await page.locator('#rapid-registered').count(), 0); assert.equal(f.state.writes.length, 0, 'crear el producto no mueve stock');
    assert.equal(f.state.productInserts, 1); assert.equal(await activeIs(page, '#rapid-quantity'), true);
    assert.equal(await page.evaluate(() => window.__refreshes ?? 0) >= 1, true, 'onCreated conserva router.refresh()');
    await page.getByLabel('Cantidad', { exact: true }).fill('9'); await submitText(page).click();
    await page.getByRole('status').filter({ hasText: 'Cable USB-C 2 m: +9 unidades registradas en A2.' }).waitFor();
    assert.equal(f.state.writes.length, 1); const created = f.state.tables.productos.find(p => p.nombre === 'Cable USB-C 2 m');
    assert.deepEqual([f.state.writes[0].producto_id, f.state.writes[0].destino_compartimiento_id, f.state.writes[0].cantidad], [created.id, 74, 9]);
    await page.locator('.rapid-product').filter({ hasText: 'Cable USB-C 2 m' }).waitFor(); assert.deepEqual(errorsOf.get(page), []); await page.close();
  });

  await t.test('quick real: productos parecidos («Usar este producto» y «Crear de todos modos»)', async () => {
    f = createShelfFixture(); const existing = [{ id: productId, nombre: 'Módulo térmico', nombre_normalizado: 'modulotermico', categorias: { nombre: 'Electrónica' } }];
    let page = await open('/carga/ubicacion/73', { init: { existing } });
    const fill = async () => { await addProduct(page); await page.getByRole('button', { name: 'Crear nuevo producto' }).click(); await page.locator('#product-name').fill('modulo termico'); await page.locator('#product-category').selectOption('cat01'); await page.locator('form.catalog-form button[type=submit]').click(); };
    await fill(); const warning = page.locator('.similar-warning'); await warning.waitFor(); assert.match(await warning.innerText(), /Encontramos productos parecidos/);
    assert.equal(f.state.productInserts ?? 0, 0, 'avisar no escribe');
    await warning.getByRole('button', { name: 'Usar este producto' }).click(); await page.getByLabel('Cantidad', { exact: true }).waitFor();
    assert.equal(flat(await page.locator('.rapid-step h2').innerText()), 'Módulo térmico'); assert.equal(flat(await page.locator('#rapid-registered').innerText()), 'Stock registrado en A1: 7 unidades');
    assert.equal(f.state.productInserts ?? 0, 0); assert.equal(f.state.writes.length, 0); await page.close();
    page = await open('/carga/ubicacion/73', { init: { existing } }); await fill(); await page.locator('.similar-warning').getByRole('button', { name: 'Crear de todos modos' }).click();
    await page.getByLabel('Cantidad', { exact: true }).waitFor(); assert.equal(f.state.productInserts, 1); assert.equal(f.state.writes.length, 0);
    assert.equal(await page.locator('#rapid-registered').count(), 0, 'producto nuevo: sin stock registrado'); await page.close();
  });

  await t.test('C1-C: fallo de red en la entrada → «No pudimos confirmar el movimiento…»; errores específicos intactos', async () => {
    f = createShelfFixture(); const page = await open('/carga/ubicacion/74'); await pick(page, 'esp32', /ESP32-S3/);
    const quantity = page.getByLabel('Cantidad', { exact: true }); await quantity.fill('2'); f.state.transportFails = true; await submitText(page).click();
    const alert = page.getByRole('alert'); await alert.waitFor(); assert.equal(flat(await alert.innerText()), 'No pudimos confirmar el movimiento. Puedes reintentar: si ya se registró, no se duplicará. El resultado del movimiento anterior no se confirmó. Si sales ahora, revisa el Historial antes de volver a operar.');
    assert.equal(await quantity.inputValue(), '2', 'la cantidad se conserva'); assert.equal(await quantity.getAttribute('aria-invalid'), null, 'no es un error de campo');
    assert.equal(await submitText(page).isEnabled(), true); assert.equal(f.state.writes.length, 0);
    f.state.transportFails = false; f.state.entryError = '23514'; await submitText(page).click(); await page.getByRole('alert').filter({ hasText: 'stock suficiente' }).waitFor();
    assert.doesNotMatch(await page.getByRole('alert').innerText(), /No pudimos confirmar/); assert.deepEqual(errorsOf.get(page), []); await page.close();
  });

  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  await t.test('C2b Carga rápida: UUID en cada entrada, reintento incierto con el mismo UUID, respuesta perdida → «ya estaba registrado» y sin duplicar', async () => {
    f = createShelfFixture(); const page = await open('/carga/ubicacion/74'); await pick(page, 'esp32', /ESP32-S3/);
    const quantity = page.getByLabel('Cantidad', { exact: true }); await quantity.fill('2'); f.state.loseResponses = 1; await submitText(page).click();
    const alert = page.getByRole('alert'); await alert.waitFor(); assert.match(flat(await alert.innerText()), /^No pudimos confirmar el movimiento\. Puedes reintentar: si ya se registró, no se duplicará\./);
    assert.equal(await quantity.isDisabled(), true, 'la solicitud incierta no se puede editar'); assert.equal(await page.getByRole('button', { name: 'Cambiar producto' }).isDisabled(), true);
    assert.equal(f.state.tables.inventario.find(r => r.compartimiento_id === 74 && r.producto_id === secondProductId).cantidad, 2, 'la primera escritura sí se aplicó');
    await submitText(page).click(); await page.getByRole('status').filter({ hasText: 'Este movimiento ya estaba registrado; no se duplicó.' }).waitFor();
    const inputs = f.state.actionInputs; assert.equal(inputs.length, 2); assert.match(inputs[0].solicitudId, V4); assert.equal(inputs[0].solicitudId, inputs[1].solicitudId, 'el reintento reutiliza el UUID');
    assert.equal(f.state.tables.inventario.find(r => r.compartimiento_id === 74 && r.producto_id === secondProductId).cantidad, 2, 'una sola aplicación'); assert.equal(f.state.tables.movimientos.length, 1); assert.deepEqual(errorsOf.get(page), []); await page.close();
  });

  await t.test('C2b Carga rápida: fallo de red sin aplicar → reintento con el mismo UUID se registra una vez; dos entradas idénticas consecutivas usan UUID distintos', async () => {
    f = createShelfFixture(); const page = await open('/carga/ubicacion/74'); await pick(page, 'esp32', /ESP32-S3/);
    const quantity = page.getByLabel('Cantidad', { exact: true }); await quantity.fill('2'); f.state.transportFails = true; await submitText(page).click(); await page.getByRole('alert').waitFor();
    f.state.transportFails = false; await submitText(page).click(); await page.getByRole('status').filter({ hasText: 'ESP32-S3: +2 unidades registradas en A2.' }).waitFor();
    assert.equal(f.state.actionInputs[0].solicitudId, f.state.actionInputs[1].solicitudId); assert.equal(f.state.tables.movimientos.length, 1);
    await pick(page, 'esp32', /ESP32-S3/); await page.getByLabel('Cantidad', { exact: true }).fill('2'); await submitText(page).click(); await page.getByRole('status').filter({ hasText: 'ESP32-S3: +2 unidades registradas en A2.' }).waitFor();
    const ids = f.state.actionInputs.map(input => input.solicitudId); assert.notEqual(ids[2], ids[1], 'una segunda operación legítima idéntica recibe otro UUID');
    assert.equal(f.state.tables.movimientos.length, 2); assert.equal(f.state.tables.inventario.find(r => r.compartimiento_id === 74 && r.producto_id === secondProductId).cantidad, 4); await page.close();
  });

  await t.test('C2b Carga rápida: cantidad distinta tras un error definitivo → UUID nuevo; sin crypto.randomUUID se usa getRandomValues y sin fuentes seguras se bloquea', async () => {
    f = createShelfFixture(); let page = await open('/carga/ubicacion/74'); await pick(page, 'esp32', /ESP32-S3/);
    f.state.entryError = '23503'; await page.getByLabel('Cantidad', { exact: true }).fill('2'); await submitText(page).click(); await page.getByRole('alert').waitFor(); f.state.entryError = null;
    await page.getByLabel('Cantidad', { exact: true }).fill('3'); await submitText(page).click(); await page.getByRole('status').filter({ hasText: 'unidades registradas' }).waitFor();
    const ids = f.state.actionInputs.map(input => input.solicitudId); assert.notEqual(ids[0], ids[1], 'tras un rechazo definitivo no se reutiliza el UUID'); await page.close();
    f = createShelfFixture(); page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(7000); await page.route('**/*', r => r.request().url().startsWith(url) ? r.continue() : r.abort());
    await page.addInitScript(() => { Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }); }); await page.goto(url + '/carga/ubicacion/74'); await page.waitForFunction(() => document.querySelector('.rapid-location-page'));
    await pick(page, 'esp32', /ESP32-S3/); await page.getByLabel('Cantidad', { exact: true }).fill('1'); await submitText(page).click(); await page.getByRole('status').filter({ hasText: 'unidad registrada' }).waitFor(); assert.match(f.state.actionInputs[0].solicitudId, V4); await page.close();
    f = createShelfFixture(); page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(7000); await page.route('**/*', r => r.request().url().startsWith(url) ? r.continue() : r.abort());
    await page.addInitScript(() => { Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }); Object.defineProperty(crypto, 'getRandomValues', { value: undefined, configurable: true }); });
    await page.goto(url + '/carga/ubicacion/74'); await page.waitForFunction(() => document.querySelector('.rapid-location-page')); await pick(page, 'esp32', /ESP32-S3/);
    await page.getByLabel('Cantidad', { exact: true }).fill('1'); await submitText(page).click(); await page.getByRole('alert').waitFor(); assert.match(flat(await page.getByRole('alert').innerText()), /no puede generar identificadores seguros/);
    assert.equal(f.state.actionInputs ?? undefined, undefined, 'la acción no se llamó'); assert.equal(f.state.tables.movimientos.length, 0); await page.close();
  });

  await t.test('singular y plural de unidades: campo, aviso y stock registrado (V14)', async () => {
    f = createShelfFixture(); const page = await open('/carga/ubicacion/74');
    await pick(page, 'esp32', /ESP32-S3/); const quantity = page.getByLabel('Cantidad', { exact: true }); const unit = page.locator('#rapid-quantity-unit');
    assert.equal(flat(await unit.innerText()), 'unidades'); await quantity.fill('1'); assert.equal(flat(await unit.innerText()), 'unidad'); await quantity.fill('2'); assert.equal(flat(await unit.innerText()), 'unidades');
    await quantity.fill('1'); await submitText(page).click();
    await page.getByRole('status').filter({ hasText: 'ESP32-S3: +1 unidad registrada en A2.' }).waitFor();
    await pick(page, 'esp32', /ESP32-S3/); assert.equal(flat(await page.locator('#rapid-registered').innerText()), 'Stock registrado en A2: 1 unidad');
    await page.getByLabel('Cantidad', { exact: true }).fill('2'); await submitText(page).click();
    await page.getByRole('status').filter({ hasText: 'ESP32-S3: +2 unidades registradas en A2.' }).waitFor();
    assert.equal(f.state.tables.inventario.find(r => r.compartimiento_id === 74 && r.producto_id === secondProductId).cantidad, 3); assert.deepEqual(errorsOf.get(page), []); await page.close();
  });

  await t.test('«Ajustar»: nombre accesible, descripción por producto y diálogo UI02 sin regresiones', async () => {
    f = createShelfFixture(); const page = await open('/carga/ubicacion/73');
    const adjust = page.locator('.rapid-product').filter({ hasText: 'Módulo térmico' }).getByRole('button', { name: 'Ajustar', exact: true });
    assert.equal(await adjust.count(), 1); assert.equal(await page.getByRole('button', { name: 'Ajustar', exact: true }).count(), 2);
    const described = await adjust.getAttribute('aria-describedby'); assert.match(flat(await page.evaluate(id => document.getElementById(id).innerText, described)), /Módulo térmico/);
    await adjust.click(); const dialog = page.locator('.stock-dialog[open]'); await dialog.waitFor(); assert.equal(await dialog.locator('#stock-quantity').inputValue(), '7');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); assert.equal(await adjust.evaluate(button => document.activeElement === button), true);
    assert.equal(f.state.writes.length, 0); await page.close();
  });

  await t.test('Anterior/Siguiente: orden físico, orden DOM, textos y enlaces', async () => {
    f = createShelfFixture(); let page = await open('/carga/C264');
    let links = page.locator('.rapid-neighbors a'); assert.equal(await links.count(), 2);
    assert.deepEqual(await links.evaluateAll(a => a.map(x => x.getAttribute('href'))), ['/carga/C263', '/carga/C251']);
    assert.equal(flat(await links.first().innerText()), 'Anterior · C263'); assert.equal(flat(await links.last().innerText()), 'Siguiente · C251');
    await page.close(); page = await open('/carga/C161'); links = page.locator('.rapid-neighbors a'); assert.equal(await links.count(), 1, 'la primera ubicación no tiene «Anterior»');
    assert.equal(await links.first().getAttribute('href'), '/carga/C162');
    const box = await links.first().boundingBox(), host = await page.locator('.rapid-neighbors').boundingBox(); assert.ok(box.width >= host.width - 2, 'un solo enlace ocupa todo el ancho'); await page.close();
    page = await open('/carga/ubicacion/96'); links = page.locator('.rapid-neighbors a'); assert.deepEqual(await links.evaluateAll(a => a.map(x => x.getAttribute('href'))), ['/carga/ubicacion/95'], 'la última caja no tiene «Siguiente»'); await page.close();
    page = await open('/carga/ubicacion/76'); assert.equal(flat(await page.locator('.rapid-neighbors a').last().innerText()), 'Pasar a Estante 2 · A5'); await page.close();
  });

  await t.test('inicio: código actual, histórico e inexistente, error asociado, foco y persistencia', async () => {
    f = createShelfFixture(); const page = await open('/carga', { storage: { 'ingeagro-last-rapid-location': 'C264' } });
    await page.getByRole('link', { name: /Continuar desde C264/ }).waitFor();
    const toggle = page.getByRole('group', { name: 'Tipo de almacenamiento' }); assert.equal(await toggle.getByRole('button', { name: 'Torres', exact: true }).getAttribute('aria-pressed'), 'true');
    await toggle.getByRole('button', { name: 'Estantes', exact: true }).click(); assert.equal(await toggle.getByRole('button', { name: 'Estantes', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByLabel('Caja', { exact: true }).locator('option').count(), 4);
    const code = page.getByLabel('Código de ubicación'); await code.fill('A999'); await page.getByRole('button', { name: 'Ir a la caja' }).click();
    const alert = page.getByRole('alert'); await alert.waitFor(); assert.equal(flat(await alert.innerText()), 'No encontramos esa ubicación.');
    assert.equal(await code.getAttribute('aria-invalid'), 'true'); assert.equal(await code.getAttribute('aria-describedby'), 'rapid-start-error');
    assert.equal(await activeIs(page, 'input[placeholder="Código de caja"]'), true, 'el foco vuelve al código tras el error');
    await code.fill('A6'); assert.equal(await code.getAttribute('aria-invalid'), null);
    f.state.failTable = 'ubicacion_codigos'; await page.getByRole('button', { name: 'Ir a la caja' }).click(); await page.getByRole('alert').filter({ hasText: 'No pudimos consultar' }).waitFor(); f.state.failTable = null;
    assert.equal(await code.inputValue(), 'A6');
    // Histórico: A6 se renombra y el código antiguo sigue resolviendo a la misma caja
    assert.equal((await f.renameBoxCode({ ubicacionId: 78, codigoEsperado: 'A6', codigoNuevo: 'MOTORES' })).ok, true);
    await page.getByRole('button', { name: 'Ir a la caja' }).click(); await page.getByRole('heading', { name: 'MOTORES', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/carga/ubicacion/78');
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('ingeagro-last-rapid-location-v2')))).id, 78);
    await page.getByRole('link', { name: 'Elegir otra ubicación' }).click(); await page.getByRole('link', { name: /Continuar desde MOTORES/ }).waitFor();
    // Torres por selección física
    const selects = page.locator('.rapid-start-selects select'); await selects.nth(0).selectOption('2'); await selects.nth(1).selectOption('6'); await selects.nth(2).selectOption('4');
    await page.getByRole('button', { name: 'Ir al compartimiento' }).click(); await page.getByRole('heading', { name: 'C264', exact: true }).waitFor();
    await page.close();
  });

  await t.test('selección con más de 50 resultados: recuento, límite y scroll interno', async () => {
    f = createShelfFixture();
    for (let i = 0; i < 60; i++) f.state.tables.productos.push({ id: `10000000-0000-0000-0000-${String(i).padStart(12, '0')}`, nombre: `Sensor ${String(i).padStart(2, '0')}`, categoria_id: 'cat01', foto_ruta: null });
    const sizes = {};
    for (const width of [320, 390]) {
      const page = await open('/carga/ubicacion/74', { width, height: 844 }); await addProduct(page, 'Añadir producto');
      const input = page.getByRole('searchbox', { name: 'Buscar producto existente' }); await input.fill('sensor');
      assert.equal(await page.locator('.rapid-select-list button').count(), 50);
      assert.equal(flat(await page.locator('.rapid-result-count').innerText()), 'Mostrando los primeros 50 de 60 productos. Escribe más para acotar.');
      assert.equal(await page.getByRole('status').filter({ hasText: 'Mostrando los primeros 50' }).count(), 1);
      const list = page.locator('.rapid-select-list'); const m = await list.evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight, doc: document.documentElement.scrollHeight, hOverflow: document.documentElement.scrollWidth > innerWidth }));
      sizes[width] = m; assert.equal(m.hOverflow, false); assert.ok(m.client <= 420 && m.scroll > m.client, `scroll interno acotado (${m.client}/${m.scroll})`);
      assert.ok(m.doc < 2200, `la página no crece con la lista (${m.doc} px)`);
      // Teclado: Tab hasta el último botón visible hace scroll dentro de la lista
      await page.locator('.rapid-select-list button').last().focus();
      const visible = await page.evaluate(() => { const b = document.activeElement.getBoundingClientRect(), l = document.querySelector('.rapid-select-list').getBoundingClientRect(); return b.top >= l.top - 1 && b.bottom <= l.bottom + 1; });
      assert.equal(visible, true, 'el elemento enfocado es visible dentro de la lista');
      await input.fill('sensor 3'); assert.match(await page.locator('.rapid-result-count').innerText(), /^10 productos$/);
      await input.fill('zzz'); assert.equal(await page.getByText('No encontramos productos.').count(), 1); assert.match(await page.locator('.rapid-result-count').innerText(), /^0 productos$/);
      await page.close();
    }
    await writeFile(path.join(directory, 'lista-50.json'), JSON.stringify(sizes, null, 2));
  });

  const widths = [320, 360, 390, 768, 1024, 1280];
  for (const width of widths) for (const theme of ['light', 'dark']) await t.test(`responsive ${width}px ${theme}: inicio y ubicación`, async () => {
    f = createShelfFixture(); const long = 'ESTANTE-DOS-MOTORES-0001'; assert.equal(long.length, 24);
    await f.renameBoxCode({ ubicacionId: 78, codigoEsperado: 'A6', codigoNuevo: long });
    const reduced = width === 360;
    const routes = ['/carga', '/carga/C111', '/carga/ubicacion/73', '/carga/ubicacion/78', '/carga/ubicacion/74'];
    for (const route of routes) {
      const page = await open(route, { width, theme, reduced, storage: { 'ingeagro-last-rapid-location': 'C264' } });
      const shot = name => [320, 390, 768, 1280].includes(width) && page.screenshot({ path: path.join(directory, `${name}-${width}-${theme}.png`), fullPage: true });
      const overflow = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth, wide: [...document.querySelectorAll('.rapid-start-layout *, .rapid-location-page *')].filter(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow === 'visible' && el.clientWidth > 0 && !el.closest('.rapid-select-list')).map(el => el.className || el.tagName).slice(0, 5) }));
      assert.ok(overflow.doc <= 0, `${route}: sin scroll horizontal (${overflow.doc})`); assert.deepEqual(overflow.wide, [], `${route}: sin contenido desbordado`);
      if (route === '/carga') {
        await shot('inicio'); assert.equal(await page.locator('.rapid-start-section').count(), 2);
        const sel = await page.locator('.rapid-start-selects label').evaluateAll(l => l.map(x => Math.round(x.getBoundingClientRect().width))); assert.ok(sel.every(w => w >= 100), `selects legibles ${sel}`);
        if (width <= 520) assert.equal(await page.locator('.rapid-start-selects').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 2);
      } else {
        const header = await page.locator('.rapid-location-header').boundingBox(); assert.ok(header.width > 0);
        const code = page.locator('.rapid-code'); const c = await code.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, font: getComputedStyle(el).fontFamily, size: el.dataset.size, text: el.textContent }));
        assert.ok(c.sw <= c.cw, 'código completo, sin recorte'); assert.match(c.font, /Consolas|monospace|Cascadia|Courier/);
        if (route.endsWith('/78')) { assert.equal(c.text, long); assert.equal(c.size, 'long'); await shot('caja-larga'); } else await shot(route.endsWith('73') ? 'dos-productos' : route.endsWith('74') ? 'vacia' : 'torre');
        const links = await page.locator('.rapid-neighbors a').evaluateAll(a => a.map(x => { const r = x.getBoundingClientRect(); return { h: r.height, ok: x.scrollWidth <= x.clientWidth + 1 }; })); assert.ok(links.every(l => l.h >= 44 && l.ok), 'navegación legible con objetivos ≥ 44 px');
        if (width >= 360 && links.length === 2) { const r = await page.locator('.rapid-neighbors a').evaluateAll(a => a.map(x => x.getBoundingClientRect().top)); assert.ok(Math.abs(r[0] - r[1]) < 2, 'Anterior/Siguiente en dos columnas desde 360 px'); }
        if (route.endsWith('/73')) { const rows = await page.locator('.rapid-product').evaluateAll(r => r.map(x => ({ btn: x.querySelector('button').getBoundingClientRect().height, name: x.querySelector('.rapid-product-name').getBoundingClientRect().width }))); assert.ok(rows.every(r => r.btn >= 44 && r.name >= 90), `filas legibles ${JSON.stringify(rows)}`); }
      }
      // Objetivos táctiles y contraste de los textos principales
      const tiny = await page.evaluate(() => [...document.querySelectorAll('.rapid-start-layout :is(button,a,select,input), .rapid-location-page :is(button,a,select,input)')].filter(el => el.getClientRects().length && el.type !== 'hidden').map(el => ({ n: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 20), h: el.getBoundingClientRect().height })).filter(x => x.h < 44));
      assert.deepEqual(tiny, [], `${route}: objetivos ≥ 44 px`);
      const pairs = await page.evaluate(() => {
        const rgb = s => s.match(/[\d.]+/g).map(Number);
        const bg = el => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor, v = rgb(c); if (v.length < 4 || v[3] > 0.99) return v; } return [255, 255, 255, 1]; };
        return [...document.querySelectorAll('.rapid-location-header :is(.eyebrow,.rapid-code,.rapid-context,.rapid-tower-link,.rapid-status), .rapid-step-label, .rapid-registered, .rapid-unit, .rapid-result-count, .rapid-product-name small, .rapid-product > strong, .rapid-start-section h3, .rapid-start-section > p, .rapid-start-form > p, .rapid-content h2, .rapid-empty, .rapid-continue small, .rapid-segmented button, .catalog-field')]
          .filter(el => el.getClientRects().length && el.textContent.trim()).map(el => ({ n: el.className || el.tagName, fg: rgb(getComputedStyle(el).color), bg: bg(el) }));
      });
      const bad = pairs.filter(p => ratio(p.fg, p.bg) < 4.5).map(p => `${p.n}:${ratio(p.fg, p.bg).toFixed(2)}`); assert.deepEqual(bad, [], `${route} ${theme}: contraste ≥ 4,5:1`);
      if (route.startsWith('/carga/') && width === 390) { // foco visible sobre la cabecera oscura
        await page.locator('.rapid-tower-link').focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
        const ring = await page.evaluate(() => { const el = document.activeElement, s = getComputedStyle(el), rgb = x => x.match(/[\d.]+/g).map(Number); return { w: parseFloat(s.outlineWidth), color: rgb(s.outlineColor), cls: el.className, bg: rgb(getComputedStyle(document.querySelector('.rapid-location-header')).backgroundColor) }; });
        assert.match(ring.cls, /rapid-tower-link/); assert.ok(ring.w >= 2 && ratio(ring.color, ring.bg) >= 3, `foco del enlace sobre la cabecera (${ratio(ring.color, ring.bg).toFixed(2)})`);
      }
      if (reduced) { const d = await page.evaluate(() => [...document.querySelectorAll('.rapid-location-page *, .rapid-start-layout *')].map(el => parseFloat(getComputedStyle(el).transitionDuration)).filter(x => x > 0.001)); assert.deepEqual(d, [], 'movimiento reducido'); }
      assert.deepEqual(errorsOf.get(page), []); await page.close();
    }
  });

  await t.test('medición: altura de cabecera y posición del botón principal a 390×844', async () => {
    const results = {};
    for (const [label, route] of [['torre-0', '/carga/C161'], ['torre-1', '/carga/C111'], ['caja-0', '/carga/ubicacion/74'], ['caja-2', '/carga/ubicacion/73']]) {
      f = createShelfFixture(); const page = await open(route, { width: 390, height: 844 });
      results[label] = await page.evaluate(() => { const h = document.querySelector('.rapid-location-header').getBoundingClientRect(), p = document.querySelector('.rapid-primary').getBoundingClientRect(); return { header: Math.round(h.height), primaryTop: Math.round(p.top + scrollY), primaryBottom: Math.round(p.bottom + scrollY), doc: document.documentElement.scrollHeight }; });
      await page.close();
    }
    // Cabecera con código largo y en 320 px
    f = createShelfFixture(); await f.renameBoxCode({ ubicacionId: 74, codigoEsperado: 'A2', codigoNuevo: 'ESTANTE-DOS-MOTORES-0001' });
    for (const width of [320, 390]) { const page = await open('/carga/ubicacion/74', { width, height: 844 }); results[`larga-${width}`] = await page.evaluate(() => { const h = document.querySelector('.rapid-location-header').getBoundingClientRect(), p = document.querySelector('.rapid-primary').getBoundingClientRect(); return { header: Math.round(h.height), primaryBottom: Math.round(p.bottom + scrollY) }; }); await page.close(); }
    await writeFile(path.join(directory, baseline ? 'medicion-antes.json' : 'medicion-despues.json'), JSON.stringify(results, null, 2)); t.diagnostic(JSON.stringify(results));
    if (!baseline) for (const [label, m] of Object.entries(results)) if (!label.startsWith('larga')) { assert.ok(m.header <= 250, `${label}: cabecera ${m.header} px`); if (m.primaryBottom) assert.ok(m.primaryBottom <= 844, `${label}: el botón principal cabe en la primera pantalla (${m.primaryBottom})`); }
  });
});
