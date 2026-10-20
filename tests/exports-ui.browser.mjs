// UI08: presentación y estados de Exportaciones. Página y componente reales dentro de AppShell; getExportSnapshot corre
// contra el Supabase simulado del fixture (con retardo y fallos a demanda). Sin .env, sin red externa, sin Supabase real.
// Node >=22; esbuild y Playwright externos. SHELVES_TEST_TOOLS=<tools>; EXPORTS_UI_ARTIFACTS=<ruta externa opcional>.
// EXPORTS_UI_SRC=<copia del código a medir> y EXPORTS_UI_BASELINE=1 solo miden un commit anterior (sin umbrales).
// node --test tests/exports-ui.browser.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate'; // Ya forma parte de write-excel-file.
import { createShelfFixture, root as repoRoot, requireTools } from './helpers/shelves-fixture.mjs';
import { inventoryCsv, INVENTORY_HEADERS } from '../lib/export-model.ts';
const { build } = requireTools('esbuild'); const { chromium } = requireTools('playwright');
const root = process.env.EXPORTS_UI_SRC ?? repoRoot, baseline = process.env.EXPORTS_UI_BASELINE === '1';

const fixtureSource = `
  import {createRoot} from 'react-dom/client';
  import {AppShell} from './components/app-shell';
  import ExportsPage from './app/(workspace)/exportaciones/page';
  createRoot(document.getElementById('root')).render(<AppShell><ExportsPage/></AppShell>);
`;
const lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const flat = s => s.replace(/\s+/g, ' ').trim();
const FORMATS = [['csv', 'CSV', 'Exportar CSV'], ['xlsx', 'Excel', 'Exportar Excel'], ['png', 'Mapa PNG', 'Exportar Mapa PNG']];

test('UI08: exportaciones, estados por formato, bloqueo global y archivos sin cambios', async t => {
  const directory = process.env.EXPORTS_UI_ARTIFACTS ?? await mkdtemp(path.join(tmpdir(), 'ingeagro-exports-ui-'));
  await mkdir(directory, { recursive: true }); t.diagnostic(`Archivos sintéticos: ${directory}`);
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: fixtureSource }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'offline-exports', setup(b) {
    b.onResolve({ filter: /^(next\/(link|navigation)|@\/lib\/supabase\/client|@\/app\/\(workspace\)\/export-actions)$/ }, args => ({ path: args.path, namespace: 'fake' }));
    b.onLoad({ filter: /.*/, namespace: 'fake' }, args => ({ resolveDir: root, loader: 'ts', contents: args.path === 'next/link' ? "import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)}"
      : args.path === 'next/navigation' ? "export function usePathname(){return '/exportaciones'}export function useRouter(){return {refresh(){},replace(){throw new Error('Unexpected navigation')}}}"
      : args.path.endsWith('/export-actions') ? "export async function getExportSnapshot(){window.__snapshotCalls=(window.__snapshotCalls||0)+1;const response=await fetch('/snapshot');if(!response.ok)throw new Error('Offline query failure');return response.json()}"
      : "export function createSupabaseClient(){throw new Error('Real authentication disabled')}" }));
  } }] });
  const css = (await Promise.all(['app/globals.css', 'components/tower-view.css', 'app/theme.css', 'app/catalog.css', 'app/stock.css', 'app/rapid.css', 'app/exports.css'].map(file => readFile(path.join(root, file), 'utf8')))).join('\n').replace('@import "tailwindcss";', '');
  const f = createShelfFixture();
  f.state.tables.productos.push({ id: 'empty', nombre: 'Sin stock Ω', descripcion: '½', categoria_id: 'cat01' }, { id: 'formula', nombre: '=SUM(1+1)', descripcion: 'C++ C# ñ "sí"\nsegunda línea', categoria_id: 'cat01' });
  await f.renameBoxCode({ ubicacionId: 73, codigoEsperado: 'A1', codigoNuevo: 'MOTORES' });
  const expected = await f.getExportSnapshot(), unchanged = structuredClone(f.state.tables); let delay = 0, requests = 0;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/snapshot') { requests++; if (delay) await new Promise(resolve => setTimeout(resolve, delay)); const data = await f.getExportSnapshot(); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(data)); }
      else if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bundle.outputFiles[0].text); }
      else { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`); }
    } catch { response.statusCode = 503; response.end('Synthetic query failure'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch(); t.after(() => browser.close());
  const errorsOf = new WeakMap();
  async function open({ width = 1280, height = 900, theme = 'light', reduced = false } = {}) {
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' }); page.setDefaultTimeout(10000);
    const errors = []; errorsOf.set(page, errors); page.on('pageerror', error => errors.push(error.message));
    const downloads = []; page.on('download', download => downloads.push(download.suggestedFilename())); page.downloads = downloads;
    await page.route('**/*', route => route.request().url().startsWith(base) || route.request().url().startsWith('blob:') ? route.continue() : route.abort());
    await page.goto(base + '/exportaciones'); await page.getByRole('button', { name: 'Exportar CSV', exact: true }).waitFor();
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await page.waitForFunction(() => !document.getAnimations().length); return page;
  }
  const card = (page, format) => page.locator(`.export-card[data-format="${format}"]`);
  const idle = page => page.waitForFunction(() => ![...document.querySelectorAll('.export-card button')].some(button => button.disabled));
  const run = async (page, format, label) => { const done = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click(); const d = await done; await idle(page); return d; };

  if (!baseline) {
    await t.test('cuatro estados por formato, mensaje de descarga iniciada y etiquetas estables', async () => {
      const page = await open(); delay = 500;
      for (const [format, title, label] of FORMATS) {
        const c = card(page, format), button = c.getByRole('button', { name: label, exact: true });
        assert.equal(await c.getAttribute('data-state'), 'idle'); assert.equal(await c.locator('.export-status').innerText(), ''); assert.equal(await c.getAttribute('aria-busy'), 'false');
        const before = await button.boundingBox(); const pendingDownload = page.waitForEvent('download'); await button.click();
        assert.equal(await c.getAttribute('data-state'), 'loading'); assert.equal(await c.getAttribute('aria-busy'), 'true');
        await page.waitForFunction(fmt => document.querySelector(`.export-card[data-format="${fmt}"] .export-status`).textContent === 'Consultando inventario…', format);
        assert.equal(flat(await button.innerText()), label, 'la etiqueta no cambia durante la operación'); const during = await button.boundingBox(); assert.deepEqual([during.width, during.height], [before.width, before.height]);
        const download = await pendingDownload; assert.match(download.suggestedFilename(), new RegExp(`^inventario-ingeagro-\\d{4}-\\d{2}-\\d{2}\\.${format}$`)); await idle(page);
        assert.equal(await c.getAttribute('data-state'), 'success'); assert.match(flat(await c.locator('.export-status').innerText()), new RegExp(`^Descarga de ${title} iniciada a las \\d{1,2}:\\d{2}\\.$`));
        assert.doesNotMatch(await page.locator('.export-grid').innerText(), /preparado para descargar|guardad|descargado correctamente/i);
      }
      delay = 0; assert.equal(f.state.writes.length, 0); assert.deepEqual(errorsOf.get(page), []); await page.close();
    });

    await t.test('un solo intento: doble clic, bloqueo de los otros botones y una sola consulta por exportación', async () => {
      const page = await open(); delay = 600; const start = requests;
      const pendingDownload = page.waitForEvent('download');
      await page.evaluate(() => { const b = [...document.querySelectorAll('.export-card button')][0]; b.click(); b.click(); });
      await page.waitForFunction(() => [...document.querySelectorAll('.export-card button')].every(b => b.disabled));
      for (const [format, , label] of FORMATS) assert.equal(await page.getByRole('button', { name: label, exact: true }).isDisabled(), true);
      assert.equal(await card(page, 'xlsx').locator('.export-lock').innerText(), 'Disponible cuando termine la exportación en curso.');
      assert.equal(await card(page, 'xlsx').getByRole('button').getAttribute('aria-describedby'), 'export-lock-xlsx'); assert.equal(await card(page, 'csv').locator('.export-lock').count(), 0);
      await page.evaluate(() => document.querySelectorAll('.export-card button')[1].click()); // sobre un botón deshabilitado: sin efecto
      await pendingDownload; await idle(page); assert.equal(requests - start, 1, 'una sola llamada a getExportSnapshot'); assert.equal(page.downloads.length, 1);
      assert.equal(await page.evaluate(() => window.__snapshotCalls), 1); assert.equal(await page.locator('.export-lock').count(), 0);
      delay = 0; await page.close();
    });

    await t.test('resultados independientes: el éxito persiste, los errores se limpian al reintentar', async () => {
      const page = await open(); await run(page, 'csv', 'Exportar CSV');
      const csvStatus = flat(await card(page, 'csv').locator('.export-status').innerText()); assert.match(csvStatus, /^Descarga de CSV iniciada/);
      await page.evaluate(() => { window.__getContext = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = () => null; });
      await page.getByRole('button', { name: 'Exportar Mapa PNG', exact: true }).click(); await page.getByRole('alert').waitFor(); await idle(page);
      assert.match(flat(await page.getByRole('alert').innerText()), /^No pudimos exportar el Mapa PNG\./); assert.equal(await page.getByRole('alert').count(), 1);
      assert.equal(await card(page, 'png').getAttribute('data-state'), 'error'); assert.equal(await card(page, 'csv').getAttribute('data-state'), 'success'); assert.equal(flat(await card(page, 'csv').locator('.export-status').innerText()), csvStatus, 'el éxito de CSV permanece');
      await page.evaluate(() => { HTMLCanvasElement.prototype.getContext = window.__getContext; });
      await run(page, 'xlsx', 'Exportar Excel'); assert.equal(await page.getByRole('alert').count(), 0, 'el error anterior se limpia al iniciar otro intento');
      assert.equal(await card(page, 'png').getAttribute('data-state'), 'idle'); assert.equal(await card(page, 'csv').getAttribute('data-state'), 'success'); assert.equal(await card(page, 'xlsx').getAttribute('data-state'), 'success');
      assert.equal(await page.locator('.export-status:not(:empty)').count(), 2, 'dos éxitos independientes visibles');
      await run(page, 'png', 'Exportar Mapa PNG'); assert.equal(await card(page, 'png').getAttribute('data-state'), 'success'); assert.equal(await page.getByRole('alert').count(), 0);
      assert.deepEqual(errorsOf.get(page), []); await page.close();
    });

    await t.test('errores sin descarga parcial: consulta, generación y lienzo', async () => {
      const page = await open();
      f.state.failTable = 'inventario';
      for (const [format, title, label] of FORMATS) { await page.getByRole('button', { name: label, exact: true }).click(); await card(page, format).getByRole('alert').waitFor(); await idle(page); assert.match(flat(await card(page, format).getByRole('alert').innerText()), new RegExp(`^No pudimos exportar el ${title}\\.`)); assert.equal(await page.getByRole('alert').count(), 1, 'un solo error visible'); }
      f.state.failTable = null; assert.equal(page.downloads.length, 0, 'ninguna descarga tras fallos de consulta');
      await page.evaluate(() => { window.__create = URL.createObjectURL; URL.createObjectURL = () => { throw new Error('blob'); }; });
      for (const [format, , label] of FORMATS.slice(0, 2)) { await page.getByRole('button', { name: label, exact: true }).click(); await card(page, format).getByRole('alert').waitFor(); await idle(page); assert.equal(await page.getByRole('alert').count(), 1); }
      assert.equal(page.downloads.length, 0, 'ninguna descarga parcial tras fallos de generación');
      await page.evaluate(() => { URL.createObjectURL = window.__create; });
      await run(page, 'csv', 'Exportar CSV'); assert.equal(await page.getByRole('alert').count(), 0); assert.equal(page.downloads.length, 1);
      assert.equal(f.state.writes.length, 0); assert.deepEqual(f.state.tables, unchanged); assert.deepEqual(errorsOf.get(page), []); await page.close();
    });

    await t.test('archivos sin modificaciones: CSV idéntico, XLSX con dos hojas sin fórmulas y PNG válido', async () => {
      const page = await open();
      for (const [format, , label] of FORMATS) { const d = await run(page, format, label); await d.saveAs(path.join(directory, `inventario.${format}`)); }
      assert.equal(await readFile(path.join(directory, 'inventario.csv'), 'utf8'), inventoryCsv(expected)); assert.equal((await readFile(path.join(directory, 'inventario.csv')))[0], 0xEF, 'BOM UTF-8');
      const zip = unzipSync(await readFile(path.join(directory, 'inventario.xlsx'))); const workbook = Buffer.from(zip['xl/workbook.xml']).toString('utf8');
      assert.match(workbook, /name="Inventario"/); assert.match(workbook, /name="Resumen"/); assert.doesNotMatch(Buffer.from(zip['xl/worksheets/sheet1.xml']).toString('utf8'), /<f[\s>]/);
      const png = await readFile(path.join(directory, 'inventario.png')); assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.ok(png.readUInt32BE(16) >= 1200, 'ancho ≥ 1200 px');
      assert.equal(requests > 0, true); assert.equal(f.state.writes.length, 0); await page.close();
    });

    await t.test('foco: se restaura al botón de origen solo si se perdió; no se roba si el usuario lo movió', async () => {
      const page = await open(); delay = 400;
      await page.getByRole('button', { name: 'Exportar CSV', exact: true }).focus(); await page.keyboard.press('Enter'); await page.waitForEvent('download'); await idle(page);
      await page.waitForFunction(() => document.activeElement?.textContent === 'Exportar CSV'); assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Exportar CSV', 'foco restaurado');
      await page.getByRole('button', { name: 'Exportar Excel', exact: true }).focus(); await page.keyboard.press('Space');
      await page.waitForFunction(() => document.querySelector('.export-card[data-format="xlsx"]').dataset.state === 'loading');
      await page.locator('.export-card[data-format="png"] summary').focus(); await page.waitForEvent('download'); await idle(page);
      assert.equal(await page.evaluate(() => document.activeElement.tagName + ':' + document.activeElement.closest('.export-card').dataset.format), 'SUMMARY:png', 'el foco movido por el usuario se respeta');
      delay = 0; await page.close();
    });

    await t.test('regiones accesibles persistentes sin anuncios duplicados', async () => {
      const page = await open(); const statuses = page.locator('.export-status'); assert.equal(await statuses.count(), 3);
      assert.deepEqual(await statuses.evaluateAll(els => els.map(el => [el.getAttribute('role'), el.getAttribute('aria-live')])), [['status', 'polite'], ['status', 'polite'], ['status', 'polite']]);
      delay = 400; await page.getByRole('button', { name: 'Exportar Excel', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.export-card[data-format="xlsx"] .export-status').textContent !== '');
      assert.equal(await page.locator('.export-status:not(:empty)').count(), 1, 'solo la tarjeta activa anuncia'); delay = 0; await page.waitForEvent('download'); await idle(page);
      assert.equal(await page.locator('.export-status:not(:empty)').count(), 1); assert.equal(await page.getByRole('alert').count(), 0); await page.close();
    });

    await t.test('detalles de compatibilidad: cerrados, correctos y operables por teclado', async () => {
      const page = await open(); const details = page.locator('.export-details'); assert.equal(await details.count(), 3);
      assert.deepEqual(await details.evaluateAll(els => els.map(el => el.open)), [false, false, false]);
      const csv = card(page, 'csv').locator('.export-details'); await csv.locator('summary').focus(); await page.keyboard.press('Enter'); assert.equal(await csv.evaluate(el => el.open), true);
      const csvText = flat(await csv.innerText()); assert.match(csvText, /punto y coma \(;\)/); assert.match(csvText, /UTF-8 con BOM/); assert.ok(csvText.includes('Columnas: ' + INVENTORY_HEADERS.join(', ') + '.'), 'columnas = INVENTORY_HEADERS');
      assert.equal(await csv.locator('summary').evaluate(el => el.getBoundingClientRect().height >= 44), true);
      const xlsx = flat(await card(page, 'xlsx').locator('.export-details').evaluate(el => { el.open = true; return el.innerText; })); assert.match(xlsx, /«Inventario» y «Resumen»/); assert.match(xlsx, /sin fórmulas/);
      const png = flat(await card(page, 'png').locator('.export-details').evaluate(el => { el.open = true; return el.innerText; })); assert.match(png, /Rojo = ocupado · Verde = disponible/); assert.match(png, /1200 px/);
      for (const text of [csvText, xlsx, png]) assert.match(text, /instantánea del momento de exportar/);
      assert.doesNotMatch(await page.locator('.export-grid, .export-note').allInnerTexts().then(x => x.join(' ')), /\bV2\b|ocho columnas/);
      assert.equal(await page.locator('.export-ext').allInnerTexts().then(x => x.join(' ')), '.csv .xlsx .png'); assert.equal(await page.locator('.export-filename code').allInnerTexts().then(x => x.join(' ')), 'inventario-ingeagro-AAAA-MM-DD.csv inventario-ingeagro-AAAA-MM-DD.xlsx inventario-ingeagro-AAAA-MM-DD.png');
      await page.close();
    });

    for (const width of [320, 360, 390, 768, 1024, 1280]) for (const theme of ['light', 'dark']) await t.test(`responsive ${width}px ${theme}`, async () => {
      const page = await open({ width, height: 850, theme, reduced: width === 360 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin scroll horizontal');
      const tops = await page.locator('.export-card').evaluateAll(cards => cards.map(c => Math.round(c.getBoundingClientRect().top)));
      if (width >= 1024) assert.equal(new Set(tops).size, 1, 'tres columnas'); else assert.equal(new Set(tops).size, 3, 'una columna');
      const button = card(page, 'csv').getByRole('button'); delay = 300; const done = page.waitForEvent('download'); await button.click();
      await page.waitForFunction(() => document.querySelector('.export-card[data-format="csv"] .export-status').textContent !== ''); await done; await idle(page); delay = 0;
      const gap = await card(page, 'csv').evaluate(c => { const b = c.querySelector('button').getBoundingClientRect(), s = c.querySelector('.export-status').getBoundingClientRect(); return { gap: s.top - b.bottom, inView: s.bottom <= innerHeight && b.top >= 0 }; });
      assert.ok(gap.gap >= 0 && gap.gap <= 40 && gap.inView, `estado junto al botón y a la vista (${JSON.stringify(gap)})`);
      if ([320, 390, 768, 1280].includes(width)) await page.screenshot({ path: path.join(directory, `exportaciones-${width}-${theme}.png`), fullPage: true });
      const pairs = await page.evaluate(() => {
        const rgb = s => s.match(/[\d.]+/g).map(Number); const bg = el => { for (let n = el; n; n = n.parentElement) { const v = rgb(getComputedStyle(n).backgroundColor); if (v.length < 4 || v[3] > 0.99) return v; } return [255, 255, 255]; };
        return [...document.querySelectorAll('.export-card h2, .export-ext, .export-desc, .export-filename, .export-filename code, .export-status.success, .export-details summary, .export-card .catalog-button, .export-note, .export-icon')].filter(el => el.getClientRects().length && (el.textContent.trim() || el.classList.contains('export-icon'))).map(el => ({ n: el.className || el.tagName, fg: rgb(getComputedStyle(el).color), bg: bg(el) }));
      });
      assert.deepEqual(pairs.filter(p => ratio(p.fg, p.bg) < (p.n === 'export-icon' ? 3 : 4.5)).map(p => `${p.n}:${ratio(p.fg, p.bg).toFixed(2)}`), [], 'contraste');
      const small = await page.evaluate(() => [...document.querySelectorAll('.export-card button, .export-details summary')].filter(el => el.getBoundingClientRect().height < 44).length); assert.equal(small, 0, 'objetivos ≥ 44 px');
      await page.keyboard.press('Tab'); await page.locator('.export-card button').first().focus(); await page.waitForFunction(() => !document.getAnimations().length);
      const ring = await page.evaluate(() => { const el = document.activeElement, s = getComputedStyle(el), rgb = x => x.match(/[\d.]+/g).map(Number); let bg = [255, 255, 255]; for (let n = el.parentElement; n; n = n.parentElement) { const v = rgb(getComputedStyle(n).backgroundColor); if (v.length < 4 || v[3] > 0.99) { bg = v; break; } } return { w: parseFloat(s.outlineWidth), style: s.outlineStyle, color: rgb(s.outlineColor), bg }; });
      assert.ok(ring.style !== 'none' && ring.w >= 2 && ratio(ring.color, ring.bg) >= 3, `foco ≥ 3:1 (${ratio(ring.color, ring.bg).toFixed(2)})`);
      if (width === 360) assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.export-grid *')].map(el => parseFloat(getComputedStyle(el).transitionDuration)).filter(x => x > 0.001)), [], 'movimiento reducido');
      assert.deepEqual(errorsOf.get(page), []); await page.close();
    });
  }

  await t.test('medición a 390×844: altura de la página y posición del primer botón', async () => {
    const page = await open({ width: 390, height: 844 });
    const m = await page.evaluate(() => { const b = document.querySelector('.export-card button').getBoundingClientRect(); return { doc: document.documentElement.scrollHeight, firstButtonTop: Math.round(b.top + scrollY), firstButtonBottom: Math.round(b.bottom + scrollY), cards: [...document.querySelectorAll('.export-card')].map(c => Math.round(c.getBoundingClientRect().height)) }; });
    await writeFile(path.join(directory, baseline ? 'medicion-antes.json' : 'medicion-despues.json'), JSON.stringify(m, null, 2)); t.diagnostic(JSON.stringify(m)); await page.close();
  });
});
