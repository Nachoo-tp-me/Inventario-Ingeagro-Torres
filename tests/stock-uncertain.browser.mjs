// C1-C: operación incierta. Si la llamada para registrar una entrada, un retiro o un traslado falla a nivel de red, el
// resultado es incierto: la interfaz pide revisar el Historial antes de reintentar. Los errores específicos (stock,
// conflicto, permisos) y los ajustes conservan su tratamiento. Componentes reales (detalle de caja + StockOperationDialog)
// con el fixture en memoria; nunca Supabase, JWT reales ni producción.
// Node >=22; esbuild y Playwright externos. SHELVES_TEST_TOOLS=<tools> node --test tests/stock-uncertain.browser.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createShelfFixture, productId, root, requireTools } from "./helpers/shelves-fixture.mjs";

const { build } = requireTools("esbuild");
const { chromium } = requireTools("playwright");
const UNCERTAIN = "No pudimos confirmar el movimiento. Revisa el Historial antes de reintentar.";
const fixture = `
  import { useEffect,useState,useSyncExternalStore } from 'react';
  import { createRoot } from 'react-dom/client';
  import { AppShell } from './components/app-shell';
  import { ShelfView } from './components/shelf-view';
  const subscribe=cb=>{window.addEventListener('popstate',cb);return()=>window.removeEventListener('popstate',cb)};
  function Current(){
    const url=useSyncExternalStore(subscribe,()=>location.pathname+location.search);
    const [data,setData]=useState(null);const [epoch,setEpoch]=useState(0);
    useEffect(()=>{window.__refresh=()=>setEpoch(v=>v+1);return()=>{delete window.__refresh}},[]);
    useEffect(()=>{let active=true;fetch('/data?path='+encodeURIComponent(url)).then(r=>r.json()).then(r=>{if(active)setData(r)});return()=>{active=false}},[url,epoch]);
    if(!data)return null;
    const selected=new URLSearchParams(location.search).get('caja');
    return <ShelfView shelf={data.shelf} locations={data.locations} products={data.products} selectedId={selected?Number(selected):null}/>;
  }
  createRoot(document.getElementById('root')).render(<AppShell><Current/></AppShell>);
`;

test("C1-C: operación incierta por fallo de red (entrada, retiro, traslado) y errores específicos intactos", async t => {
  const bundle = await build({ stdin: { resolveDir: root, loader: "tsx", contents: fixture }, bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "offline", setup(b) {
      b.onResolve({ filter: /^(next\/navigation|next\/link|@\/lib\/supabase\/client|@\/app\/\(workspace\)\/(stock-actions|box-code-actions))$/ }, args => ({ path: args.path, namespace: "fake" }));
      b.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ resolveDir: root, contents:
        args.path === "next/link" ? "import {createElement} from 'react';export default function Link({href,children,...props}){return createElement('a',{...props,href,onClick:e=>{e.preventDefault();history.pushState({},'',href);dispatchEvent(new PopStateEvent('popstate'))}},children)}"
        : args.path === "next/navigation" ? "import {useSyncExternalStore} from 'react';const subscribe=cb=>{addEventListener('popstate',cb);return()=>removeEventListener('popstate',cb)};export function usePathname(){return useSyncExternalStore(subscribe,()=>location.pathname)};export function useRouter(){return {replace(p){history.replaceState({},'',p);dispatchEvent(new PopStateEvent('popstate'))},refresh(){window.__refresh?.()}}}"
        : args.path.endsWith("/supabase/client") ? "export function createSupabaseClient(){throw new Error('Real authentication disabled')}"
        : args.path.endsWith("/box-code-actions") ? "export async function renameBoxCode(){return {ok:false,message:'Disabled'}}"
        : "export async function submitStockOperation(input){const response=await fetch('/action',{method:'POST',body:JSON.stringify(input)});return response.json()}" }));
    } }] });
  const css = (await Promise.all(["app/globals.css", "components/tower-view.css", "app/theme.css", "app/catalog.css", "app/stock.css", "app/shelves.css"].map(file => readFile(path.join(root, file), "utf8")))).join("\n").replace('@import "tailwindcss";', "");
  let active = createShelfFixture(); let transportFails = false; const actionCalls = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://fixture.test");
      if (url.pathname === "/data") {
        const target = new URL(url.searchParams.get("path"), "http://fixture.test");
        const element = await active.shelfPage({ params: Promise.resolve({ id: target.pathname.split("/")[2] }), searchParams: Promise.resolve({ caja: target.searchParams.get("caja") ?? undefined }) });
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(element.props));
      } else if (url.pathname === "/action") {
        const chunks = []; for await (const chunk of request) chunks.push(chunk); const input = JSON.parse(Buffer.concat(chunks).toString()); actionCalls.push(input);
        if (transportFails) { response.statusCode = 503; response.end("Bad gateway"); return; } // respuesta que no es JSON: el resultado queda incierto
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(await active.submitStockOperation(input)));
      } else if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); response.end(bundle.outputFiles[0].text); }
      else { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`); }
    } catch (error) { response.statusCode = 503; response.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch(); t.after(() => browser.close());
  async function open() {
    active = createShelfFixture(); transportFails = false; actionCalls.length = 0;
    const page = await browser.newPage({ viewport: { width: 390, height: 850 }, hasTouch: true }); page.setDefaultTimeout(8000);
    const errors = []; page.on("pageerror", e => errors.push(e.message)); page.errors = errors;
    await page.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.goto(base + "/estantes/1?caja=73"); await page.locator(".compartment-dialog[open]").waitFor(); return page;
  }
  async function openAction(page, name) {
    const row = page.locator(".compartment-dialog[open] .sheet-product").filter({ hasText: "Módulo térmico" });
    await row.getByRole("button", { name: "Acciones", exact: true }).click();
    await page.locator(".stock-action-options:popover-open").getByRole("button", { name, exact: true }).click();
    const dialog = page.locator(".stock-dialog[open]"); await dialog.waitFor(); return dialog;
  }
  const alertText = async dialog => (await dialog.getByRole("alert").innerText()).replace(/\s+/g, " ").trim();
  const stockOf = () => active.state.tables.inventario.find(row => row.compartimiento_id === 73 && row.producto_id === productId).cantidad;

  await t.test("entrada: fallo de red → mensaje de precaución; sin cerrar el diálogo ni perder la cantidad", async () => {
    const page = await open(); const dialog = await openAction(page, "Agregar"); await dialog.locator("#stock-quantity").fill("3");
    transportFails = true; await dialog.getByRole("button", { name: "Registrar entrada", exact: true }).click(); await dialog.getByRole("alert").waitFor();
    assert.equal(await alertText(dialog), UNCERTAIN); assert.equal(await dialog.locator("#stock-quantity").inputValue(), "3"); assert.equal(actionCalls.length, 1);
    assert.equal(await dialog.getByRole("button", { name: "Registrar entrada", exact: true }).isEnabled(), true, "el usuario decide; no se reintenta solo"); await page.close();
  });

  await t.test("retiro y traslado: fallo de red tras confirmar → mensaje de precaución", async () => {
    let page = await open(); let dialog = await openAction(page, "Retirar"); await dialog.locator("#stock-quantity").fill("2");
    await dialog.getByRole("button", { name: "Continuar", exact: true }).click(); await dialog.locator(".stock-confirmation").waitFor();
    transportFails = true; await dialog.getByRole("button", { name: "Confirmar movimiento", exact: true }).click(); await dialog.getByRole("alert").waitFor();
    assert.equal(await alertText(dialog), UNCERTAIN); assert.equal(actionCalls.length, 1); assert.equal(actionCalls[0].tipo, "retiro"); await page.close();
    page = await open(); dialog = await openAction(page, "Mover"); await dialog.locator(".stock-option-list.locations button").first().click(); await dialog.locator("#stock-quantity").fill("1");
    await dialog.getByRole("button", { name: "Continuar", exact: true }).click(); await dialog.locator(".stock-confirmation").waitFor();
    transportFails = true; await dialog.getByRole("button", { name: "Confirmar movimiento", exact: true }).click(); await dialog.getByRole("alert").waitFor();
    assert.equal(await alertText(dialog), UNCERTAIN); assert.equal(actionCalls[0].tipo, "traslado"); assert.deepEqual(page.errors, []); await page.close();
  });

  await t.test("ajuste físico: el fallo de red conserva su mensaje anterior (no se duplica: cantidadEsperada protege el reintento)", async () => {
    const page = await open(); const dialog = await openAction(page, "Ajustar"); await dialog.locator("#stock-quantity").fill("4");
    await dialog.getByRole("button", { name: "Continuar", exact: true }).click(); await dialog.locator(".stock-adjustment").waitFor();
    transportFails = true; await dialog.getByRole("button", { name: "Confirmar movimiento", exact: true }).click(); await dialog.getByRole("alert").waitFor();
    assert.equal(await alertText(dialog), "No fue posible completar el movimiento. Inténtalo nuevamente."); assert.notEqual(await alertText(dialog), UNCERTAIN); await page.close();
  });

  await t.test("errores conocidos conservan su tratamiento específico (stock, conflicto, registro inexistente)", async () => {
    const page = await open(); let dialog = await openAction(page, "Retirar"); await dialog.locator("#stock-quantity").fill("2");
    await dialog.getByRole("button", { name: "Continuar", exact: true }).click(); await dialog.locator(".stock-confirmation").waitFor();
    for (const [code, expected] of [["23514", "No hay stock suficiente."], ["40001", "El stock cambió."], ["23503", "El producto o la ubicación ya no existe."]]) {
      active.state.entryError = code; await dialog.getByRole("button", { name: "Confirmar movimiento", exact: true }).click(); await dialog.getByRole("alert").waitFor();
      const text = await alertText(dialog); assert.ok(text.startsWith(expected), `${code}: ${text}`); assert.notEqual(text, UNCERTAIN);
      await dialog.getByRole("button", { name: "Continuar", exact: true }).click(); await dialog.locator(".stock-confirmation").waitFor();
    }
    active.state.entryError = null; assert.equal(stockOf(), 7, "ninguna escritura en los casos de error conocido"); assert.deepEqual(page.errors, []); await page.close();
  });
});
