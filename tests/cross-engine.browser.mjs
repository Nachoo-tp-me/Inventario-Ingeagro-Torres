// UI09b: humo multi-motor (Chromium, Firefox y WebKit de escritorio de Playwright) para Inicio, Catálogo, Carga rápida,
// Historial y Exportaciones a 390 y 1280 px, en claro y oscuro. Componentes reales con datos sintéticos y servicios
// simulados; el tráfico externo se bloquea; sin Supabase ni .env. Comprueba solo lo que no depende del motor: sin
// errores de página, sin desbordamiento horizontal, contraste calculado, foco visible, controles alcanzables, regiones
// accesibles y movimiento reducido. NO equivale a un iPhone real ni a un lector de pantalla.
// Node >=22; esbuild y Playwright externos con los tres navegadores instalados.
// SHELVES_TEST_TOOLS=<tools> node --test tests/cross-engine.browser.mjs   (CROSS_ENGINES=chromium,firefox,webkit)
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, requireTools } from './helpers/shelves-fixture.mjs';
const { build } = requireTools('esbuild'); const playwright = requireTools('playwright');
const ENGINES = (process.env.CROSS_ENGINES ?? 'chromium,firefox,webkit').split(',');

const fixtureSource = `
  import {useEffect,useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {AppShell} from './components/app-shell';
  import {PageHeading} from './components/dashboard';
  import {GlobalSearch} from './components/global-search';
  import {TowersCard,ShelvesCard} from './components/home-summary';
  import {ProductCatalogList} from './components/product-catalog-list';
  import {RapidLocation} from './components/rapid-location';
  import {MovementHistory} from './components/movement-history';
  import {ExportPanel} from './components/export-panel';
  const product=(id,nombre,stock,ubicaciones)=>({id,nombre,categoria_id:'c',categoria:'Electrónica',descripcion:'Descripción de prueba',fotoUrl:null,foto_ruta:null,stock,ubicaciones});
  const products=[product('p1','Módulo térmico',23,2),product('p2','Relé industrial 24 V',1,1),product('p3','Controlador de temperatura con salida a relé y comunicación serial RS-485',0,0)];
  const box=(id,codigo,estante_id,posicion)=>({tipo:'caja',id,codigo,estante_id,posicion});
  const current={...box(73,'A1',1,1),ocupado:true,productos:[{id:'p1',nombre:'Módulo térmico',categoria:'Electrónica',cantidad:7,fotoUrl:null},{id:'p2',nombre:'Relé industrial 24 V',categoria:'Electrónica',cantidad:1,fotoUrl:null}]};
  const adjacent={current:box(73,'A1',1,1),previous:null,next:box(74,'A2',1,2)};
  const loc=(id,codigo)=>({id,codigoMovimiento:codigo,ubicacionActual:{tipo:'caja',id,codigo,estante_id:1,posicion:1}});
  const entries=[
    {id:4,fecha:'2026-01-02T12:30:00.000Z',tipo:'traslado',cantidad:1,producto:'Módulo térmico',origen:loc(73,'A1'),destino:{id:1,codigoMovimiento:'C111',ubicacionActual:{tipo:'compartimiento',id:1,codigo:'C111',torre_id:1,piso:1,posicion:1}}},
    {id:3,fecha:'2026-01-02T12:20:00.000Z',tipo:'entrada',cantidad:5,producto:'Relé industrial 24 V',origen:null,destino:loc(73,'A1')},
    {id:2,fecha:'2026-01-02T12:10:00.000Z',tipo:'retiro',cantidad:2,producto:'Módulo térmico',origen:loc(73,'A1'),destino:null},
    {id:1,fecha:'2026-01-02T12:00:00.000Z',tipo:'ajuste',cantidad:3,producto:'Módulo térmico',origen:loc(73,'A1'),destino:null}];
  function Home(){const [cards,setCards]=useState(null);
    useEffect(()=>{Promise.all([TowersCard({result:Promise.resolve({status:'ready',data:{torres:3,compartimientos:72,ocupados:12,disponibles:60,productos:9}})}),ShelvesCard({result:Promise.resolve({status:'ready',data:{estantes:6,cajas:24,ocupadas:6,disponibles:18,grupos:['A','B']}})})]).then(setCards)},[]);
    return <div className="page-stack"><PageHeading eyebrow="PANEL GENERAL" title="Inventario Ingeagro" description="Una vista clara de lo que hay y dónde se encuentra."/><GlobalSearch/><div className="home-summary">{cards}</div></div>}
  const pages={'/':<Home/>,'/productos':<div className="page-stack"><PageHeading eyebrow="CATÁLOGO" title="Productos" description="Productos registrados y sus existencias actuales."/><ProductCatalogList products={products}/></div>,
    '/carga':<RapidLocation current={current} adjacent={adjacent} products={products} categories={[]} compartments={[current]}/>,
    '/historial':<div className="page-stack"><PageHeading eyebrow="ACTIVIDAD" title="Historial" description="Cada entrada, retiro, traslado y ajuste registrado."/><MovementHistory entries={entries}/></div>,
    '/exportaciones':<div className="page-stack"><PageHeading eyebrow="ARCHIVOS" title="Exportar inventario" description="Descarga una copia actual del inventario."/><ExportPanel/></div>};
  createRoot(document.getElementById('root')).render(<AppShell>{pages[location.pathname]}</AppShell>);
`;
const fakes = {
  link: "import {createElement} from 'react';export default function Link({href,children,replace,prefetch,scroll,...props}){return createElement('a',{...props,href,onClick:e=>e.preventDefault()},children)}",
  navigation: "export function usePathname(){return location.pathname}export function useRouter(){return {refresh(){},push(){},replace(){}}}",
  search: "export async function searchInventory(){return {products:[],location:null,locationAttempt:false}}",
  stock: "export async function submitStockOperation(){return {ok:true}}",
  rapid: "export async function resolveRapidCode(){return {ok:false}}",
  box: "export async function renameBoxCode(){throw new Error('disabled')}",
  exportActions: "export async function getExportSnapshot(){return {generadoEn:'2026-01-02T12:00:00.000Z',rows:[],resumen:{productos:0,unidades:0,compartimientos:0,ocupados:0,disponibles:0,cajas:0,ubicaciones:0},torres:[],estantes:[]}}",
  form: "export function ProductForm(){return null}",
  supabase: "export function createSupabaseClient(){throw new Error('Production access disabled')}",
};
const lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const flat = s => s.replace(/\s+/g, ' ').trim();
const PAGES = [['/', 'Inicio'], ['/productos', 'Catálogo'], ['/carga', 'Carga rápida'], ['/historial', 'Historial'], ['/exportaciones', 'Exportaciones']];

test('UI09b: humo multi-motor (Chromium, Firefox, WebKit)', async t => {
  const directory = process.env.CROSS_ENGINE_ARTIFACTS ?? await mkdtemp(path.join(tmpdir(), 'ingeagro-cross-engine-'));
  await mkdir(directory, { recursive: true }); t.diagnostic(`Evidencias sintéticas: ${directory}`);
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: fixtureSource }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'offline-only', setup(b) {
    b.onResolve({ filter: /^(next\/(link|navigation)|@\/lib\/supabase\/client|@\/components\/product-form|@\/app\/\(workspace\)\/(stock-actions|search-actions|rapid-actions|box-code-actions|export-actions))$/ }, args => ({ path: args.path, namespace: 'fake' }));
    b.onLoad({ filter: /.*/, namespace: 'fake' }, args => ({ resolveDir: root, loader: 'ts', contents: args.path === 'next/link' ? fakes.link : args.path === 'next/navigation' ? fakes.navigation : args.path.endsWith('/supabase/client') ? fakes.supabase
      : args.path.endsWith('/product-form') ? fakes.form : args.path.endsWith('/search-actions') ? fakes.search : args.path.endsWith('/stock-actions') ? fakes.stock : args.path.endsWith('/rapid-actions') ? fakes.rapid
      : args.path.endsWith('/export-actions') ? fakes.exportActions : fakes.box }));
  } }] });
  const css = (await Promise.all(['app/globals.css', 'components/tower-view.css', 'app/theme.css', 'app/catalog.css', 'app/stock.css', 'app/rapid.css', 'app/home.css', 'app/shelves.css', 'app/exports.css'].map(file => readFile(path.join(root, file), 'utf8')))).join('\n').replace('@import "tailwindcss";', '');
  const server = createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bundle.outputFiles[0].text); }
    else { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, summary = {};

  for (const engine of ENGINES) await t.test(`motor ${engine}`, async t2 => {
    const browser = await playwright[engine].launch(); t2.after(() => browser.close());
    summary[engine] = { version: browser.version(), pages: 0, contrastSkipped: 0 };
    for (const width of [390, 1280]) for (const theme of ['light', 'dark']) for (const [route, name] of PAGES) await t2.test(`${name} ${width}px ${theme}`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 500, acceptDownloads: true }); const page = await context.newPage(); page.setDefaultTimeout(9000);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', r => r.request().url().startsWith(base) || r.request().url().startsWith('blob:') ? r.continue() : r.abort());
      await page.goto(base + route); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.locator('h1').first().waitFor(); if (route === '/') await page.locator('[data-section="torres"]').waitFor();
      await page.waitForFunction(() => !document.getAnimations().length);
      // Estados accesibles por página
      if (route === '/carga') {
        assert.equal(await page.locator('.rapid-notice[role="status"]').count(), 1);
        await page.getByRole('button', { name: 'Añadir otro producto', exact: true }).click(); await page.locator('.rapid-step-label').waitFor();
        assert.equal(flat(await page.locator('.rapid-step-label').textContent()), 'Paso 1 de 2 · Producto'); assert.equal(await page.locator('.rapid-result-count[role="status"]').count(), 1);
        await page.locator('.rapid-select-list button').first().click(); await page.getByLabel('Cantidad', { exact: true }).waitFor();
        assert.equal(flat(await page.locator('#rapid-registered').innerText()), 'Stock registrado en A1: 7 unidades'); await page.getByLabel('Cantidad', { exact: true }).fill('1'); assert.equal(flat(await page.locator('#rapid-quantity-unit').innerText()), 'unidad');
        await page.waitForFunction(() => !document.getAnimations().length);
      }
      if (route === '/historial') { assert.equal(await page.locator('ul.history-list > li').count(), 4); assert.equal(await page.locator('time[datetime]').count(), 4); assert.equal(flat(await page.locator('[data-movement-id="4"] .history-quantity').innerText()), '1 unidad'); }
      if (route === '/exportaciones') {
        assert.equal(await page.locator('.export-status[role="status"]').count(), 3); assert.equal(await page.locator('details.export-details').count(), 3);
        await page.getByRole('button', { name: 'Exportar CSV', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.export-card[data-format="csv"]').dataset.state === 'success');
        assert.match(flat(await page.locator('.export-card[data-format="csv"] .export-status').innerText()), /^Descarga de CSV iniciada a las \d{2}:\d{2}\.$/); assert.equal(await page.getByRole('alert').count(), 0);
      }
      if (route === '/productos') { assert.equal(await page.locator('.catalog-card').count(), 3); assert.match(flat(await page.locator('.catalog-card').nth(1).innerText()), /1 unidad · 1 ubicación|1 unidad 1 ubicación/); }
      if (route === '/') { assert.equal(await page.locator('[data-section]').count(), 2); assert.ok(await page.getByRole('searchbox').or(page.locator('.global-search input')).first().isVisible()); }
      // Sin desbordamiento, sin errores de página
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin desbordamiento horizontal');
      // Contraste calculado sobre fondos efectivos (se omiten los fondos con imagen/gradiente y se cuentan)
      const contrast = await page.evaluate(() => {
        const rgb = s => s.match(/[\d.]+/g).map(Number); const bad = []; let skipped = 0;
        const bgOf = el => { for (let n = el; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.backgroundImage !== 'none') return null; const v = rgb(s.backgroundColor); if (v.length < 4 || v[3] > 0.99) return v; } return [255, 255, 255]; };
        const lumi = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        for (const el of document.querySelectorAll('main *, .app-content *, aside *, nav *, header *')) {
          if (el.closest('svg,script,style,[aria-hidden="true"],.skip-link') || !el.getClientRects().length || el.closest(':disabled')) continue;
          if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
          const s = getComputedStyle(el); if (s.visibility !== 'visible' || Number(s.opacity) < 1) continue;
          const bg = bgOf(el); if (!bg) { skipped++; continue; } const fg = rgb(s.color); if (fg.length === 4 && fg[3] < 1) { skipped++; continue; }
          const large = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700), l1 = lumi(fg), l2 = lumi(bg), r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (r < (large ? 3 : 4.5)) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}:${r.toFixed(2)}`);
        }
        return { bad: [...new Set(bad)], skipped };
      });
      summary[engine].contrastSkipped += contrast.skipped; assert.deepEqual(contrast.bad, [], 'contraste ≥ 4,5:1 (3:1 en texto grande)');
      // Elementos interactivos alcanzables (el centro recibe el clic del propio elemento)
      const unreachable = await page.evaluate(() => {
        const out = []; for (const el of document.querySelectorAll('a[href], button:not([disabled]), input:not([type=hidden]), select, summary')) {
          if (!el.getClientRects().length || el.closest('.skip-link') || getComputedStyle(el).visibility !== 'visible') continue;
          el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (!hit || !(el === hit || el.contains(hit) || hit.contains(el) || el.closest('label') === hit.closest('label') && hit.closest('label'))) out.push(`${el.tagName.toLowerCase()}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}`);
        } window.scrollTo(0, 0); return out;
      });
      assert.deepEqual(unreachable, [], 'controles alcanzables');
      // Foco visible con el teclado
      await page.evaluate(() => window.scrollTo(0, 0)); let ring = null;
      for (let i = 0; i < 8 && !ring; i++) { await page.keyboard.press('Tab'); ring = await page.evaluate(() => { const el = document.activeElement; if (!el || el === document.body || el.closest('.skip-link')) return null; const r = el.getBoundingClientRect(); if (r.width < 1) return null; const s = getComputedStyle(el); return { tag: el.tagName, style: s.outlineStyle, width: parseFloat(s.outlineWidth), shadow: s.boxShadow }; }); }
      assert.ok(ring && ((ring.style !== 'none' && ring.width >= 2) || ring.shadow !== 'none'), `foco visible (${JSON.stringify(ring)})`);
      assert.deepEqual(errors, [], 'sin errores de página'); summary[engine].pages++; await context.close();
    });
    // Movimiento reducido: ninguna transición/animación apreciable
    await t2.test('movimiento reducido', async () => {
      for (const [route, name] of PAGES) {
        const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' }); const page = await context.newPage(); page.setDefaultTimeout(9000);
        await page.route('**/*', r => r.request().url().startsWith(base) || r.request().url().startsWith('blob:') ? r.continue() : r.abort()); await page.goto(base + route); await page.locator('h1').first().waitFor();
        const long = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getClientRects().length).map(el => { const s = getComputedStyle(el); return Math.max(parseFloat(s.transitionDuration), parseFloat(s.animationDuration) || 0); }).filter(x => x > 0.001).length);
        assert.equal(long, 0, `${name}: movimiento reducido`); await context.close();
      }
    });
  });
  await writeFile(path.join(directory, 'resumen-multimotor.json'), JSON.stringify({ nota: 'Escritorio simulado: no equivale a iPhone real ni a lector de pantalla.', ...summary }, null, 2)); t.diagnostic(JSON.stringify(summary));
});
