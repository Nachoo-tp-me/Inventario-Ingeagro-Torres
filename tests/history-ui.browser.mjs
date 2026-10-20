// UI07: presentación del Historial. Página y componentes reales dentro de AppShell; la DAL (getHistory) corre en el
// servidor del fixture sobre un Supabase simulado. Sin .env, sin red externa, sin Supabase real.
// Node >=22; esbuild y Playwright externos. SHELVES_TEST_TOOLS=<tools>; HISTORY_UI_ARTIFACTS=<ruta externa opcional>.
// HISTORY_UI_SRC=<copia del código a medir> y HISTORY_UI_BASELINE=1 solo miden un commit anterior (sin umbrales).
// node --test tests/history-ui.browser.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root as repoRoot, requireTools } from './helpers/shelves-fixture.mjs';
import { createHistoryFixture } from './helpers/history-fixture.mjs';
const { build } = requireTools('esbuild'); const { chromium } = requireTools('playwright');
const root = process.env.HISTORY_UI_SRC ?? repoRoot, baseline = process.env.HISTORY_UI_BASELINE === '1';

const fixtureSource = `
  import {useEffect,useState,useSyncExternalStore} from 'react';
  import {createRoot} from 'react-dom/client';
  import {AppShell} from './components/app-shell';
  import HistoryPage from './app/(workspace)/historial/page';
  import HistoryError from './app/(workspace)/historial/error';
  const subscribe=cb=>{addEventListener('popstate',cb);return()=>removeEventListener('popstate',cb)};
  function Current(){
    const url=useSyncExternalStore(subscribe,()=>location.pathname+location.search);
    const [data,setData]=useState(null),[failed,setFailed]=useState(false),[epoch,setEpoch]=useState(0);
    useEffect(()=>{let active=true;setFailed(false);
      HistoryPage({searchParams:Promise.resolve(Object.fromEntries(new URLSearchParams(location.search)))})
        .then(element=>{if(active)setData({url,element})}).catch(()=>{if(active)setFailed(true)});
      return()=>{active=false};
    },[url,epoch]);
    if(failed)return <HistoryError retry={()=>setEpoch(value=>value+1)}/>;
    return data?.url===url?data.element:<p>Cargando historial…</p>;
  }
  createRoot(document.getElementById('root')).render(<AppShell><Current/></AppShell>);
`;
const fakes = {
  link: `import {createElement} from 'react';export default function Link({href,children,...props}){return createElement('a',{...props,href,onClick:event=>{event.preventDefault();history.pushState({},'',href);dispatchEvent(new PopStateEvent('popstate'))}},children)}`,
  navigation: `import {useSyncExternalStore} from 'react';const subscribe=cb=>{addEventListener('popstate',cb);return()=>removeEventListener('popstate',cb)};export function usePathname(){return useSyncExternalStore(subscribe,()=>location.pathname)};export function useRouter(){return {refresh(){},replace(){throw new Error('Unexpected navigation')}}}`,
  data: `export async function getHistory(page){const response=await fetch('/data?pagina='+page);if(!response.ok)throw new Error('Offline query failure');return response.json()}`,
};
const lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const flat = s => s.replace(/\s+/g, ' ').trim();

test('UI07: historial, campos separados, códigos históricos y enlaces por ID', async t => {
  const directory = process.env.HISTORY_UI_ARTIFACTS ?? await mkdtemp(path.join(tmpdir(), 'ingeagro-history-ui-'));
  await mkdir(directory, { recursive: true }); t.diagnostic(`Capturas sintéticas: ${directory}`);
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: fixtureSource }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'offline-only', setup(b) {
    b.onResolve({ filter: /^(next\/(navigation|link)|@\/lib\/(supabase\/client|stock-data))$/ }, args => ({ path: args.path, namespace: 'fake' }));
    b.onLoad({ filter: /.*/, namespace: 'fake' }, args => ({ resolveDir: root, contents: args.path === 'next/link' ? fakes.link : args.path === 'next/navigation' ? fakes.navigation
      : args.path.endsWith('/stock-data') ? fakes.data : "export function createSupabaseClient(){throw new Error('Real authentication disabled')}" }));
  } }] });
  const css = (await Promise.all(['app/globals.css', 'components/tower-view.css', 'app/theme.css', 'app/catalog.css', 'app/stock.css', 'app/shelves.css'].map(file => readFile(path.join(root, file), 'utf8')))).join('\n').replace('@import "tailwindcss";', '');
  let f = createHistoryFixture(); const payloadSizes = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/data') { const data = await f.getHistory(Number(url.searchParams.get('pagina'))); payloadSizes.push(data.entries.length); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(data)); }
      else if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bundle.outputFiles[0].text); }
      else { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`); }
    } catch { response.statusCode = 503; response.end('Simulated query failure'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch(); t.after(() => browser.close());
  const errorsOf = new WeakMap();
  async function open(route, { width = 390, height = 844, theme = 'light', reduced = false } = {}) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 400, reducedMotion: reduced ? 'reduce' : 'no-preference' }); page.setDefaultTimeout(7000);
    const errors = []; errorsOf.set(page, errors); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    await page.goto(base + route); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.waitForFunction(() => !document.getAnimations().length); return page;
  }
  const card = (page, id) => page.locator(`[data-movement-id="${id}"]`);
  const fields = (page, id) => card(page, id).locator('.history-places > div').evaluateAll(rows => rows.map(row => ({ label: row.querySelector('dt').textContent, code: row.querySelector('.history-code')?.textContent ?? null, note: row.querySelector('.history-note')?.textContent ?? null, href: row.querySelector('a')?.getAttribute('href') ?? null, name: (row.querySelector('a') ?? row.querySelector('dd')).textContent.trim() })));
  const summary = async (page, id) => ({ type: await card(page, id).locator('.history-type').textContent(), product: await card(page, id).locator('.history-product').textContent(), quantity: flat(await card(page, id).locator('.history-quantity').textContent()).replace(/ unidad(es)?$/, ''), time: await card(page, id).locator('time').getAttribute('datetime') });
  const measure = async (page, ids) => page.evaluate(ids => { const out = { doc: document.documentElement.scrollHeight, cards: {} }; for (const id of ids) out.cards[id] = Math.round(document.querySelector(`[data-movement-id="${id}"]`).getBoundingClientRect().height); return out; }, ids);

  if (!baseline) {
    await t.test('tipos, cuatro sentidos, ajustes ± y semántica ul/li con time', async () => {
      f = createHistoryFixture(); await f.renameBoxCode({ ubicacionId: 73, codigoEsperado: 'A1', codigoNuevo: 'MOTORES' }); await f.renameBoxCode({ ubicacionId: 73, codigoEsperado: 'MOTORES', codigoNuevo: 'Z20' });
      const page = await open('/historial'); await card(page, 1).waitFor();
      const list = page.locator('ul.history-list'); assert.equal(await list.count(), 1); assert.equal(await list.locator(':scope > li.history-card').count(), 13);
      assert.equal(await page.locator('div.history-list, article.history-card').count(), 0, 'sin la estructura antigua');
      const T = (type, product, quantity) => ({ type, product, quantity, time: '2026-01-02T12:30:00.000Z' });
      // Cuatro sentidos: torre→torre (1), torre→caja (2), caja→torre (3), caja→caja (4)
      assert.deepEqual(await summary(page, 1), T('Traslado', 'Módulo térmico', '1'));
      assert.equal(flat(await card(page, 1).locator('.history-quantity').innerText()), '1 unidad', 'singular accesible: «1 unidad»');
      assert.equal(flat(await card(page, 2).locator('.history-quantity').innerText()), '2 unidades', 'plural: «2 unidades»');
      assert.deepEqual(await fields(page, 1), [{ label: 'Desde', code: 'C111', note: null, href: '/torres/C1?compartimiento=C111', name: 'C111' }, { label: 'Hacia', code: 'C211', note: null, href: '/torres/C2?compartimiento=C211', name: 'C211' }]);
      assert.deepEqual((await fields(page, 2)).map(x => [x.label, x.code, x.href]), [['Desde', 'C111', '/torres/C1?compartimiento=C111'], ['Hacia', 'A1', '/estantes/1?caja=73']]);
      assert.deepEqual((await fields(page, 3)).map(x => [x.label, x.code, x.href]), [['Desde', 'A1', '/estantes/1?caja=73'], ['Hacia', 'C211', '/torres/C2?compartimiento=C211']]);
      assert.deepEqual((await fields(page, 4)).map(x => [x.label, x.code, x.href]), [['Desde', 'A1', '/estantes/1?caja=73'], ['Hacia', 'B12', '/estantes/6?caja=96']]);
      // Entrada, retiro y ajustes: etiqueta, signo exacto y unidad accesible
      for (const [id, type, quantity, label] of [[5, 'Entrada', '+5', 'Hacia'], [6, 'Retiro', '−6', 'Desde'], [7, 'Ajuste', '+7', 'En'], [8, 'Ajuste', '−8', 'En'], [10, 'Entrada', '+10', 'Hacia'], [11, 'Retiro', '−11', 'Desde'], [12, 'Ajuste', '+12', 'En'], [13, 'Ajuste', '−13', 'En']]) {
        const s = await summary(page, id); assert.deepEqual([s.type, s.quantity], [type, quantity], `movimiento ${id}`);
        assert.deepEqual((await fields(page, id)).map(x => x.label), [label]); assert.match(await card(page, id).locator('.history-quantity').innerText(), /unidades$/, `plural ${id}`);
      }
      assert.equal(await card(page, 8).locator('.history-type').evaluate(el => el.classList.contains('ajuste-negative')), true);
      assert.equal(await card(page, 7).locator('.history-type').evaluate(el => el.classList.contains('ajuste-negative')), false);
      // Sin decoración antigua y con <time datetime> intacto; cantidades con signo no dependen del color
      const text = await page.locator('.history-list').innerText(); assert.ok(!/[→←]/.test(text) && !text.includes(' · '), 'sin → ← ·');
      assert.equal(await page.locator('.history-list time[datetime="2026-01-02T12:30:00.000Z"]').count(), 13);
      assert.match(await card(page, 8).locator('time').innerText(), /2026/); assert.equal(await page.locator('.history-type svg[aria-hidden="true"]').count(), 13);
      // Tono neutro: los tipos no usan rojo/verde de ocupación
      const tones = await page.locator('.history-type').evaluateAll(els => [...new Set(els.map(el => getComputedStyle(el).backgroundColor))]); assert.equal(tones.length, 1, 'un único tono neutro para todos los tipos');
      assert.equal(f.state.writes.length, 0); assert.deepEqual(errorsOf.get(page), []); await page.close();
    });

    await t.test('códigos históricos: renombrado, NULL antiguo, ubicación inexistente y enlaces por ID', async () => {
      f = createHistoryFixture(); const page = await open('/historial'); await card(page, 2).waitFor();
      assert.deepEqual((await fields(page, 2))[1], { label: 'Hacia', code: 'A1', note: null, href: '/estantes/1?caja=73', name: 'A1' }, 'sin renombrado: sin nota');
      await f.renameBoxCode({ ubicacionId: 73, codigoEsperado: 'A1', codigoNuevo: 'MOTORES' }); await f.renameBoxCode({ ubicacionId: 73, codigoEsperado: 'MOTORES', codigoNuevo: 'Z20' });
      await page.reload(); await card(page, 2).waitFor();
      for (const id of [2, 4, 5, 6, 7, 8]) { const x = (await fields(page, id)).find(y => y.code === 'A1'); assert.deepEqual([x.code, x.note, x.href, x.name], ['A1', '(actualmente Z20)', '/estantes/1?caja=73', 'A1 (actualmente Z20)'], `movimiento ${id}`); }
      const principal = await card(page, 2).locator('.history-places > div:nth-child(2) .history-code').evaluate(el => ({ font: getComputedStyle(el).fontFamily, weight: getComputedStyle(el).fontWeight })); assert.match(principal.font, /Consolas|monospace|Cascadia|Courier/);
      // El enlace (por ID) apunta a la caja actual aunque el código del movimiento sea antiguo
      await card(page, 2).getByRole('link', { name: 'A1 (actualmente Z20)', exact: true }).click(); assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, '/estantes/1?caja=73');
      // NULL antiguo: código actual con la indicación, nunca un código pasado inventado
      await page.goto(base + '/historial'); await card(page, 9).waitFor();
      assert.deepEqual(await fields(page, 9), [{ label: 'Hacia', code: 'C111', note: '(código actual; sin instantánea histórica)', href: '/torres/C1?compartimiento=C111', name: 'C111 (código actual; sin instantánea histórica)' }]);
      // Ubicación actual inexistente: se conserva el código del movimiento, sin enlace; NULL + inexistente no inventa nada
      f.state.tables.compartimientos = []; await page.reload(); await card(page, 8).waitFor();
      assert.deepEqual(await fields(page, 8), [{ label: 'En', code: 'A1', note: '(ubicación actual no disponible)', href: null, name: 'A1 (ubicación actual no disponible)' }]);
      assert.deepEqual(await fields(page, 9), [{ label: 'Hacia', code: 'Ubicación no disponible', note: '(sin instantánea histórica)', href: null, name: 'Ubicación no disponible (sin instantánea histórica)' }]);
      assert.equal(await page.locator('.history-places a').count(), 0, 'sin enlaces inventados'); assert.equal(f.state.writes.length, 0);
      assert.deepEqual(errorsOf.get(page), []); await page.close();
    });

    await t.test('teclado: orden de Tab = orden visual y Enter sigue el enlace por ID', async () => {
      f = createHistoryFixture(); const page = await open('/historial', { width: 1280, height: 900 }); await card(page, 1).waitFor();
      const dom = await page.locator('.history-places a').evaluateAll(links => links.map(a => a.getAttribute('href')));
      await page.locator('.history-places a').first().focus(); const seen = [await page.evaluate(() => document.activeElement.getAttribute('href'))];
      for (let i = 1; i < dom.length; i++) { await page.keyboard.press('Tab'); seen.push(await page.evaluate(() => document.activeElement.getAttribute('href'))); }
      assert.deepEqual(seen, dom, 'Tab recorre los enlaces en el orden del DOM');
      const tops = await page.locator('.history-places a').evaluateAll(links => links.map(a => a.getBoundingClientRect().top + scrollY)); assert.deepEqual(tops, [...tops].sort((a, b) => a - b), 'orden visual = orden DOM');
      const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; }); assert.ok(ring.style !== 'none' && ring.width >= 2, 'foco visible');
      await page.locator('[data-movement-id="2"] a').last().focus(); await page.keyboard.press('Enter'); assert.equal(new URL(page.url()).pathname, '/estantes/1'); await page.close();
    });

    await t.test('paginación de 105 movimientos (50/50/5), vacío y error con reintento', async () => {
      f = createHistoryFixture(); const template = f.state.tables.movimientos[0]; f.state.tables.movimientos = Array.from({ length: 105 }, (_, i) => ({ ...template, id: i + 1 }));
      const page = await open('/historial'); const cards = page.locator('.history-card'); await card(page, 105).waitFor(); assert.equal(await cards.count(), 50);
      const nav = page.locator('nav.history-pagination'); assert.equal(await nav.getAttribute('aria-label'), 'Páginas de historial');
      assert.equal(flat(await nav.locator('.history-page').innerText()), 'Página 1'); assert.equal(await nav.locator('.history-page').getAttribute('aria-current'), 'page');
      assert.equal(await nav.getByRole('link', { name: 'Anterior', exact: true }).count(), 0); const next = nav.getByRole('link', { name: 'Siguiente', exact: true }); assert.equal(await next.getAttribute('href'), '/historial?pagina=2');
      assert.ok((await next.boundingBox()).height >= 48, 'objetivo ≥ 48 px'); await next.click(); await card(page, 55).waitFor(); assert.equal(await cards.count(), 50);
      assert.equal(new URL(page.url()).searchParams.get('pagina'), '2'); assert.equal(await nav.getByRole('link', { name: 'Anterior', exact: true }).getAttribute('href'), '/historial');
      await nav.getByRole('link', { name: 'Siguiente', exact: true }).click(); await card(page, 5).waitFor(); assert.equal(await cards.count(), 5); assert.equal(await nav.getByRole('link', { name: 'Siguiente', exact: true }).count(), 0);
      assert.equal(await nav.getByRole('link', { name: 'Anterior', exact: true }).getAttribute('href'), '/historial?pagina=2'); assert.equal(flat(await nav.locator('.history-page').innerText()), 'Página 3');
      f.state.tables.movimientos = []; await page.goto(base + '/historial'); await page.getByRole('heading', { name: 'Aún no hay movimientos', exact: true }).waitFor();
      f.state.failTable = 'movimientos'; await page.reload(); await page.getByRole('alert').waitFor(); assert.match(await page.getByRole('alert').innerText(), /No se pudo cargar el historial/); assert.equal(await cards.count(), 0);
      f.state.failTable = null; await page.getByRole('button', { name: 'Reintentar', exact: true }).click(); await page.getByRole('heading', { name: 'Aún no hay movimientos', exact: true }).waitFor();
      assert.ok(payloadSizes.every(size => size <= 50)); assert.deepEqual(errorsOf.get(page), []); await page.close();
    });

    await t.test('nombres largos y códigos de 24 caracteres: sin recorte ni scroll horizontal', async () => {
      for (const width of [320, 390, 1280]) {
        f = createHistoryFixture(); const longName = 'Controlador industrial de temperatura con salida a relé y comunicación serial RS-485 modelo ' + 'X'.repeat(30); f.state.tables.productos[0].nombre = longName;
        const code = 'ESTANTE-DOS-MOTORES-0001'; assert.equal(code.length, 24); await f.renameBoxCode({ ubicacionId: 73, codigoEsperado: 'A1', codigoNuevo: code }); f.state.tables.movimientos.find(row => row.id === 4).codigo_origen = code;
        const page = await open('/historial', { width }); await card(page, 4).waitFor();
        const m = await page.evaluate(code => ({ doc: document.documentElement.scrollWidth - innerWidth, clipped: [...document.querySelectorAll('.history-card *')].filter(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow === 'visible' && el.clientWidth > 0).map(el => el.className).slice(0, 4), names: [...document.querySelectorAll('.history-product')].every(el => el.textContent.length > 100), code: [...document.querySelectorAll('.history-code')].filter(el => el.textContent === code).length }), code);
        assert.ok(m.doc <= 0, `${width}px: sin scroll horizontal`); assert.deepEqual(m.clipped, []); assert.equal(m.names, true); assert.ok(m.code >= 1, 'el código completo siempre visible');
        assert.deepEqual((await fields(page, 4))[0].note, null, 'snapshot igual al código actual: sin nota'); assert.equal((await fields(page, 5))[0].name, `A1 (actualmente ${code})`);
        await page.screenshot({ path: path.join(directory, `largos-${width}.png`), fullPage: false }); await page.close();
      }
    });

    for (const width of [320, 360, 390, 768, 1024, 1280]) for (const theme of ['light', 'dark']) await t.test(`responsive ${width}px ${theme}`, async () => {
      f = createHistoryFixture(); await f.renameBoxCode({ ubicacionId: 73, codigoEsperado: 'A1', codigoNuevo: 'MOTORES' }); await f.renameBoxCode({ ubicacionId: 73, codigoEsperado: 'MOTORES', codigoNuevo: 'Z20' });
      const template = f.state.tables.movimientos[0]; f.state.tables.movimientos.push(...Array.from({ length: 38 }, (_, i) => ({ ...template, id: 100 + i, tipo: 'traslado', origen_compartimiento_id: 73, destino_compartimiento_id: 1, codigo_origen: 'A1', codigo_destino: 'C111' })));
      const page = await open('/historial', { width, theme, reduced: width === 360 }); await card(page, 137).waitFor();
      const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth })); assert.ok(o.doc <= 0, 'sin scroll horizontal');
      if ([320, 390, 768, 1280].includes(width)) await page.screenshot({ path: path.join(directory, `historial-${width}-${theme}.png`), fullPage: false });
      const pos = await card(page, 2).locator('.history-places > div').evaluateAll(rows => rows.map(r => { const b = r.getBoundingClientRect(); return { top: Math.round(b.top), left: Math.round(b.left) }; }));
      if (width >= 360) assert.ok(pos[0].top === pos[1].top && pos[1].left > pos[0].left, 'traslado en dos columnas desde 360 px'); else assert.ok(pos[1].top > pos[0].top && pos[0].left === pos[1].left, 'traslado apilado a 320 px');
      const pairs = await page.evaluate(() => {
        const rgb = s => s.match(/[\d.]+/g).map(Number); const bg = el => { for (let n = el; n; n = n.parentElement) { const v = rgb(getComputedStyle(n).backgroundColor); if (v.length < 4 || v[3] > 0.99) return v; } return [255, 255, 255]; };
        return [...document.querySelectorAll('.history-type, .history-date, .history-product, .history-quantity, .history-places dt, .history-code, .history-note, .history-page, .history-location-link')].filter(el => el.getClientRects().length && el.textContent.trim()).map(el => ({ n: el.className, fg: rgb(getComputedStyle(el).color), bg: bg(el), size: parseFloat(getComputedStyle(el).fontSize) }));
      });
      assert.deepEqual(pairs.filter(p => ratio(p.fg, p.bg) < 4.5).map(p => `${p.n}:${ratio(p.fg, p.bg).toFixed(2)}`), [], 'contraste ≥ 4,5:1'); assert.deepEqual(pairs.filter(p => p.size < 12).map(p => p.n), [], 'texto ≥ 12 px');
      const small = await page.evaluate(() => [...document.querySelectorAll('.history-places a, .history-pagination a')].filter(a => a.getBoundingClientRect().height < 44).length); assert.equal(small, 0, 'objetivos ≥ 44 px');
      await page.locator('.history-places a').first().focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => { const el = document.activeElement, s = getComputedStyle(el), rgb = x => x.match(/[\d.]+/g).map(Number); let bg = [255, 255, 255]; for (let n = el; n; n = n.parentElement) { const v = rgb(getComputedStyle(n).backgroundColor); if (v.length < 4 || v[3] > 0.99) { bg = v; break; } } return { w: parseFloat(s.outlineWidth), style: s.outlineStyle, color: rgb(s.outlineColor), bg }; });
      assert.ok(ring.style !== 'none' && ring.w >= 2 && ratio(ring.color, ring.bg) >= 3, `foco ≥ 3:1 (${ratio(ring.color, ring.bg).toFixed(2)})`);
      if (width === 360) { const d = await page.evaluate(() => [...document.querySelectorAll('.history-list *, .history-pagination *')].map(el => parseFloat(getComputedStyle(el).transitionDuration)).filter(x => x > 0.001)); assert.deepEqual(d, [], 'movimiento reducido'); }
      assert.deepEqual(errorsOf.get(page), []); await page.close();
    });
  }

  await t.test('medición a 390×844: altura de tarjetas y del documento con 13 y 50 entradas', async () => {
    f = createHistoryFixture(); await f.renameBoxCode({ ubicacionId: 73, codigoEsperado: 'A1', codigoNuevo: 'MOTORES' }); await f.renameBoxCode({ ubicacionId: 73, codigoEsperado: 'MOTORES', codigoNuevo: 'Z20' });
    const results = {}; let page = await open('/historial', { width: 390, height: 844 }); await card(page, 13).waitFor();
    results.trece = await measure(page, [1, 2, 5, 6, 7, 8, 9]); await page.close();
    const template = f.state.tables.movimientos[1]; f.state.tables.movimientos = Array.from({ length: 80 }, (_, i) => ({ ...template, id: i + 1 }));
    page = await open('/historial', { width: 390, height: 844 }); await card(page, 80).waitFor(); results.cincuenta = await measure(page, [80, 79]); results.cincuenta.cards = await page.locator('.history-card').count(); await page.close();
    await writeFile(path.join(directory, baseline ? 'medicion-antes.json' : 'medicion-despues.json'), JSON.stringify(results, null, 2)); t.diagnostic(JSON.stringify(results));
  });
});
