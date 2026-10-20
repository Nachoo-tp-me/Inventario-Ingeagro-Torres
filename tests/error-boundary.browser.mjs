// C1-A: «Reintentar» del límite de error del espacio de trabajo debe recuperar un fallo transitorio del servidor.
// Se monta el ErrorBoundaryHandler REAL de la versión de Next instalada (con un contexto de router simulado cuyo
// `refresh()` representa la nueva consulta al servidor) y el componente real app/(workspace)/error.tsx.
// Control negativo: `reset` solo limpia el estado y vuelve a renderizar los hijos sin consultar de nuevo, por lo que un
// fallo del servidor persiste (el comportamiento anterior). Sin Supabase, sin red, sin .env.
// Node >=22; esbuild y Playwright externos. SHELVES_TEST_TOOLS=<tools> node --test tests/error-boundary.browser.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root, requireTools } from './helpers/shelves-fixture.mjs';
const { build } = requireTools('esbuild'); const { chromium } = requireTools('playwright');

const fixtureSource = `
  import {createRoot} from 'react-dom/client';
  import {ErrorBoundaryHandler} from 'next/dist/client/components/error-boundary';
  import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
  import WorkspaceError from './app/(workspace)/error';
  window.__serverOk = false; window.__refreshes = 0; window.__resets = 0;
  function Page() { if (!window.__serverOk) throw new Error('Simulated transient server failure'); return <main><h1>Inventario cargado</h1></main>; }
  // Comportamiento anterior a C1-A: solo reset (limpia el estado; no vuelve a consultar al servidor).
  function LegacyError({reset}) { return <div role="alert"><h2>No pudimos cargar el inventario</h2><button type="button" onClick={()=>{window.__resets++;reset()}}>Reintentar</button></div>; }
  const router = { refresh() { window.__refreshes++; window.__serverOk = true; }, push(){}, replace(){}, back(){}, forward(){}, prefetch(){} };
  const legacy = location.search === '?legacy';
  createRoot(document.getElementById('root')).render(
    <AppRouterContext.Provider value={router}><ErrorBoundaryHandler pathname="/" errorComponent={legacy ? LegacyError : WorkspaceError}><Page/></ErrorBoundaryHandler></AppRouterContext.Provider>);
`;

test('C1-A: «Reintentar» (retry) recupera un error transitorio del servidor; reset no lo hacía', async t => {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: fixtureSource }, bundle: true, write: false, jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env.__NEXT_APP_NAV_FAIL_HANDLING': '""' }, logLevel: 'silent' });
  const css = (await Promise.all(['app/globals.css', 'app/theme.css', 'app/catalog.css'].map(file => readFile(path.join(root, file), 'utf8')))).join('\n').replace('@import "tailwindcss";', '');
  const server = createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bundle.outputFiles[0].text); }
    else { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch(); t.after(() => browser.close());
  async function open(query = '') {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } }); page.setDefaultTimeout(7000);
    const errors = [], logged = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', message => { if (message.type() === 'error') logged.push(message.text()); });
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort()); await page.goto(base + query); page.errors = errors; page.logged = logged; return page;
  }

  await t.test('con retry: error transitorio → Reintentar → vuelve a consultar y muestra el inventario', async () => {
    const page = await open(); const alert = page.getByRole('alert'); await alert.waitFor();
    assert.match(await alert.innerText(), /No pudimos cargar el inventario/); assert.equal(await page.evaluate(() => window.__refreshes), 0);
    const button = alert.getByRole('button', { name: 'Reintentar', exact: true }); assert.match(await button.getAttribute('class'), /catalog-button primary/);
    await button.click(); await page.getByRole('heading', { name: 'Inventario cargado', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__refreshes), 1, 'retry vuelve a consultar al servidor (router.refresh) una vez'); assert.equal(await page.getByRole('alert').count(), 0);
    assert.ok(page.logged.some(text => text.includes('Error al cargar el inventario')), 'el error se registra'); assert.deepEqual(page.errors, []); await page.close();
  });

  await t.test('control negativo (comportamiento anterior): reset no consulta de nuevo y el fallo persiste', async () => {
    const page = await open('?legacy'); const alert = page.getByRole('alert'); await alert.waitFor();
    await alert.getByRole('button', { name: 'Reintentar', exact: true }).click(); await page.waitForFunction(() => window.__resets === 1);
    assert.equal(await page.evaluate(() => window.__refreshes), 0, 'reset no llama a router.refresh'); await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Inventario cargado' }).count(), 0, 'el servidor sigue fallando y el panel de error permanece'); await page.close();
  });
});
