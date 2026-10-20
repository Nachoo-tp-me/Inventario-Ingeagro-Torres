// UI09a: legibilidad. Ningún texto visible por debajo de 12 px en Inicio, Torres (con la ficha de compartimiento
// abierta) e inicio de sesión, sin desbordamiento ni recorte en 320/360/390/768 px y en ambos temas. Además registra el
// tamaño de los compartimientos para comprobar que la geometría física no cambia (READABILITY_ARTIFACTS).
// Componentes reales con datos sintéticos; sin red externa, sin Supabase. Node >=22; esbuild y Playwright externos.
// READABILITY_SRC=<copia del código a medir> mide un commit anterior (solo registra tamaños).
// SHELVES_TEST_TOOLS=<tools> node --test tests/readability.browser.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root as repoRoot, requireTools } from './helpers/shelves-fixture.mjs';
const { build } = requireTools('esbuild'); const { chromium } = requireTools('playwright');
const root = process.env.READABILITY_SRC ?? repoRoot, baseline = !!process.env.READABILITY_SRC;

const fixtureSource = `
  import {createRoot} from 'react-dom/client';
  import {AppShell} from './components/app-shell';
  import {PageHeading, Metrics} from './components/dashboard';
  import {GlobalSearch} from './components/global-search';
  import {TowerView} from './components/tower-view';
  import {LoginForm} from './components/login-form';
  import {ThemeToggle} from './components/theme-toggle';
  const product={id:'p1',nombre:'Módulo térmico',categoria_id:'c',categoria:'Electrónica',descripcion:'',fotoUrl:null,foto_ruta:null,stock:23,ubicaciones:1};
  const locations=[6,5,4,3,2,1].flatMap(piso=>[1,2,3,4].map(posicion=>({id:piso*10+posicion,tipo:'compartimiento',codigo:'C1'+piso+posicion,torre_id:1,piso,posicion,ocupado:posicion%2===1,productos:posicion%2===1?[{...product,cantidad:23}]:[]})));
  const tower={id:1,codigo:'C1',total:24,ocupados:12,disponibles:12,pisos:[6,5,4,3,2,1].map(numero=>({numero,compartimientos:locations.filter(p=>p.piso===numero)}))};
  const route=location.pathname;
  const home=<div className="page-stack"><PageHeading eyebrow="PANEL GENERAL" title="Inventario Ingeagro" description="Una vista clara de lo que hay y dónde se encuentra."/><div className="hero-panel"><div className="hero-copy"><span className="hero-badge">CONTROL DE INVENTARIO</span><h2>Todo el espacio, de un vistazo.</h2></div></div><GlobalSearch/><Metrics data={{total:24,ocupados:12,disponibles:12,productos:1}}/></div>;
  const login=<main className="login-page"><div className="login-side"><div className="login-side-inner"><div className="login-brand"><strong>INGEAGRO</strong><small>INVENTARIO</small></div><div className="login-side-copy"><h1>El inventario, bajo control.</h1></div><p className="login-side-footer">INVENTARIO INGEAGRO</p></div></div><div className="login-form-side"><div className="login-theme-control"><ThemeToggle/></div><div className="login-card"><p className="eyebrow">ACCESO AL INVENTARIO</p><h2>Bienvenido</h2><LoginForm/></div></div></main>;
  createRoot(document.getElementById('root')).render(route==='/login'?login:<AppShell>{route==='/torres/C1'?<TowerView tower={tower} compartments={locations} products={[product]}/>:home}</AppShell>);
`;

test('UI09a: sin texto por debajo de 12 px, sin recortes y con la geometría de torres intacta', async t => {
  const directory = process.env.READABILITY_ARTIFACTS ?? await mkdtemp(path.join(tmpdir(), 'ingeagro-readability-'));
  await mkdir(directory, { recursive: true }); t.diagnostic(`Evidencias sintéticas: ${directory}`);
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: fixtureSource }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'offline-only', setup(b) {
    b.onResolve({ filter: /^(next\/(link|navigation)|@\/lib\/supabase\/client|@\/app\/\(workspace\)\/(stock-actions|search-actions|box-code-actions))$/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ resolveDir: root, contents: args.path === 'next/link' ? "import {createElement} from 'react';export default function Link(props){return createElement('a',props)}"
      : args.path === 'next/navigation' ? "export function usePathname(){return location.pathname}export function useRouter(){return {refresh(){},push(){},replace(){}}}"
      : args.path.includes('search-actions') ? 'export async function searchInventory(){return {products:[],location:null,locationAttempt:false}}'
      : args.path.includes('box-code-actions') ? 'export async function renameBoxCode(){throw new Error("disabled")}'
      : 'export function createSupabaseClient(){throw new Error("Production access disabled")}export async function submitStockOperation(){throw new Error("disabled")}' }));
  } }] });
  const css = (await Promise.all(['app/globals.css', 'components/tower-view.css', 'app/theme.css', 'app/catalog.css', 'app/stock.css', 'app/rapid.css', 'app/home.css', 'app/shelves.css', 'app/exports.css'].map(file => readFile(path.join(root, file), 'utf8')))).join('\n').replace('@import "tailwindcss";', '');
  const server = createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bundle.outputFiles[0].text); }
    else { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch(); t.after(() => browser.close());
  const tiles = {};
  for (const theme of ['light', 'dark']) for (const width of [320, 360, 390, 768]) await t.test(`${width}px ${theme}`, async () => {
    for (const route of ['/', '/torres/C1', '/login']) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 400 }); page.setDefaultTimeout(8000);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
      await page.goto(base + route); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await page.waitForFunction(() => !document.getAnimations().length);
      if (route === '/torres/C1') {
        tiles[`${theme}-${width}`] = await page.locator('.compartment-button').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [e.textContent.trim().slice(0, 12), Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }));
        await page.locator('.compartment-button').first().click(); await page.waitForFunction(() => !document.getAnimations().length);
      }
      const scan = await page.evaluate(() => {
        const small = [], clipped = [];
        for (const el of document.querySelectorAll('body *')) {
          if (el.closest('svg,script,style,[aria-hidden="true"]') || !el.getClientRects().length) continue;
          const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
          const s = getComputedStyle(el); if (s.visibility !== 'visible' || s.display === 'none') continue;
          if (own && parseFloat(s.fontSize) < 12) small.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}:${s.fontSize}`);
          if (own && el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(s.overflowX) ) clipped.push(`${el.className}`);
        }
        return { small: [...new Set(small)], clipped: [...new Set(clipped)], overflow: document.documentElement.scrollWidth - innerWidth };
      });
      if (baseline) { await page.close(); continue; }
      assert.deepEqual(scan.small, [], `${route}: texto < 12 px`); assert.deepEqual(scan.clipped, [], `${route}: texto recortado`); assert.ok(scan.overflow <= 0, `${route}: sin scroll horizontal (${scan.overflow})`);
      assert.deepEqual(errors, []); await page.close();
    }
  });
  await writeFile(path.join(directory, baseline ? 'tiles-antes.json' : 'tiles-despues.json'), JSON.stringify(tiles));
  if (baseline) t.diagnostic('modo medición: sin umbrales');
});
