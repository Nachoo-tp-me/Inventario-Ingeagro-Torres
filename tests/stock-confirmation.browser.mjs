// UI02: confirmación del ajuste y diálogos anidados. Componentes reales (detalle de caja +
// StockOperationDialog) con el fixture en memoria; nunca Supabase, JWT reales ni producción.
// Aditivo e independiente de B4: invariantes semánticas, sin snapshots ni baselines.
// Node >=22; esbuild 0.28.2 y playwright 1.64.0 externos (npm install --prefix <tools> ...).
// SHELVES_TEST_TOOLS=<tools>; STOCK_CONFIRMATION_ARTIFACTS=<ruta externa opcional para capturas>.
// node --test tests/stock-confirmation.browser.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createShelfFixture, productId, root, requireTools } from "./helpers/shelves-fixture.mjs";

const { build } = requireTools("esbuild");
const playwright = requireTools("playwright");
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
    useEffect(()=>{let active=true;
      fetch('/data?path='+encodeURIComponent(url)).then(r=>r.json()).then(r=>{if(active)setData(r)});
      return()=>{active=false}},[url,epoch]);
    if(!data)return null;
    const selected=new URLSearchParams(location.search).get('caja');
    return <ShelfView shelf={data.shelf} locations={data.locations} products={data.products} selectedId={selected?Number(selected):null}/>;
  }
  createRoot(document.getElementById('root')).render(<AppShell><Current/></AppShell>);
`;

const lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

test("UI02: ajuste claro (10→4, 10→16, 10→10), diálogos anidados, concurrencia y antirrepetición", async t => {
  const directory = process.env.STOCK_CONFIRMATION_ARTIFACTS ?? await mkdtemp(path.join(tmpdir(), "ingeagro-ui02-"));
  await mkdir(directory, { recursive: true });
  t.diagnostic(`Capturas sintéticas: ${directory}`);
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: fixture },
    bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "offline-browser-services", setup(build) {
      build.onResolve({ filter: /^(next\/navigation|next\/link|@\/lib\/supabase\/client|@\/app\/\(workspace\)\/(stock-actions|box-code-actions))$/ }, args => ({ path: args.path, namespace: "fake" }));
      build.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ resolveDir: root, contents:
        args.path === "next/link" ? `import {createElement} from 'react'; export default function Link({href,children,...props}){
          return createElement('a',{...props,href,onClick:event=>{event.preventDefault();history.pushState({},'',href);dispatchEvent(new PopStateEvent('popstate'))}},children)}`
        : args.path === "next/navigation" ? `import {useSyncExternalStore} from 'react';
          const subscribe=cb=>{addEventListener('popstate',cb);return()=>removeEventListener('popstate',cb)};
          export function usePathname(){return useSyncExternalStore(subscribe,()=>location.pathname)};
          export function useRouter(){return {replace(path){history.replaceState({},'',path);dispatchEvent(new PopStateEvent('popstate'))},refresh(){window.__refresh?.()}}}`
        : args.path.endsWith("/supabase/client") ? "export function createSupabaseClient(){throw new Error('Real authentication disabled')}"
        : args.path.endsWith("/box-code-actions") ? "export async function renameBoxCode(){return {ok:false,message:'Disabled in UI02 test'}}"
        : "export async function submitStockOperation(input){const response=await fetch('/action',{method:'POST',body:JSON.stringify(input)});return response.json()}" }));
    } }],
  });
  const css = (await Promise.all(["app/globals.css", "components/tower-view.css", "app/theme.css", "app/catalog.css", "app/stock.css", "app/shelves.css"]
    .map(file => readFile(path.join(root, file), "utf8")))).join("\n").replace('@import "tailwindcss";', "");
  let active = createShelfFixture();
  let actionDelay = 0;
  const actionCalls = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://fixture.test");
      if (url.pathname === "/data") {
        const target = new URL(url.searchParams.get("path"), "http://fixture.test");
        const element = await active.shelfPage({ params: Promise.resolve({ id: target.pathname.split("/")[2] }), searchParams: Promise.resolve({ caja: target.searchParams.get("caja") ?? undefined }) });
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(element.props));
      } else if (url.pathname === "/action") {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const input = JSON.parse(Buffer.concat(chunks).toString());
        actionCalls.push(input);
        if (actionDelay) await new Promise(resolve => setTimeout(resolve, actionDelay));
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(await active.submitStockOperation(input)));
      } else if (url.pathname === "/fixture.js") {
        response.setHeader("Content-Type", "application/javascript"); response.end(bundle.outputFiles[0].text);
      } else {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`);
      }
    } catch (error) { response.statusCode = 503; response.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const chromium = await playwright.chromium.launch(); t.after(() => chromium.close());

  function freshFixture() {
    active = createShelfFixture(); actionDelay = 0; actionCalls.length = 0;
    active.state.tables.inventario.find(row => row.compartimiento_id === 73 && row.producto_id === productId).cantidad = 10;
  }
  async function openAdjust(page, current = "10") {
    const detail = page.locator(".compartment-dialog[open]"); await detail.waitFor();
    const row = detail.locator(".sheet-product").filter({ hasText: "Módulo térmico" });
    await row.getByRole("button", { name: "Acciones", exact: true }).click();
    await page.locator(".stock-action-options:popover-open").getByRole("button", { name: "Ajustar", exact: true }).click();
    const dialog = page.locator(".stock-dialog[open]"); await dialog.waitFor();
    assert.equal(await dialog.locator("#stock-quantity").inputValue(), current);
    return { detail, row, dialog };
  }
  async function toConfirm(dialog, quantity) {
    await dialog.locator("#stock-quantity").fill(String(quantity));
    await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
    await dialog.locator(".stock-adjustment").waitFor();
  }
  const paint = (page, selector) => page.evaluate(sel => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rgba = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    const element = document.querySelector(sel); let node = element, bg;
    while (node) { bg = rgba(getComputedStyle(node).backgroundColor); if (bg[3] === 255) break; node = node.parentElement; }
    return { fg: rgba(getComputedStyle(element).color), bg, size: parseFloat(getComputedStyle(element).fontSize) };
  }, selector);

  for (const width of [320, 360, 390, 720, 768, 1280]) for (const theme of ["light", "dark"]) {
    await t.test(`${width}px ${theme}`, async () => {
      freshFixture();
      const page = await chromium.newPage({ viewport: { width, height: width < 400 ? 700 : 850 }, hasTouch: width < 800 });
      page.setDefaultTimeout(7000);
      const errors = []; page.on("pageerror", e => errors.push(e.message));
      await page.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
      await page.goto(url + "/estantes/1?caja=73");
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      let { detail, row, dialog } = await openAdjust(page);

      // Paso 1: etiquetas de ajuste y previsualización con texto, signo e icono.
      assert.match(await dialog.locator(".stock-current").innerText(), /Stock mostrado/);
      assert.match(await dialog.locator("label[for=stock-quantity]").innerText(), /Conteo físico/);
      await dialog.locator("#stock-quantity").fill("4");
      assert.match(await dialog.locator(".stock-delta").innerText(), /Disminuye 6 unidades · −6/);
      assert.equal(await dialog.locator(".stock-delta svg").count(), 1);

      // 10 → 4: disminución informativa, no alerta.
      await toConfirm(dialog, 4);
      const result = dialog.locator(".stock-adjustment-result");
      assert.equal((await result.innerText()).trim(), "Disminuye 6 unidades · −6");
      assert.equal(await result.evaluate(el => el.classList.contains("decrease") && !el.closest("[role=alert],[role=alertdialog]") && !el.matches(".catalog-message") && el.querySelectorAll("svg").length === 1), true);
      assert.equal(await dialog.locator("[role=alert]").count(), 0);
      const counts = (await dialog.locator(".stock-adjustment-counts").innerText()).replace(/\s+/g, " ");
      assert.match(counts, /Stock mostrado 10 unidades.*Conteo físico 4 unidades/);
      assert.match(await dialog.locator(".stock-adjustment-context").innerText(), /Módulo térmico[\s\S]*A1/);
      assert.equal(await dialog.getByRole("button", { name: "Confirmar movimiento", exact: true }).count(), 1);
      for (const selector of [".stock-dialog .stock-adjustment-result", ".stock-dialog .stock-adjustment-counts strong", ".stock-dialog .stock-adjustment-context small"]) {
        const p = await paint(page, selector); const r = ratio(p.fg, p.bg);
        assert.ok(r >= 4.5, `${selector} contraste ${r.toFixed(2)} (${theme} ${width})`);
      }
      // Geometría: sin desbordes, acciones alcanzables y no tapadas.
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "scroll horizontal de página");
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, "scroll horizontal del diálogo");
      assert.equal(await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5; }), true, "diálogo dentro del viewport");
      const confirmButton = dialog.getByRole("button", { name: "Confirmar movimiento", exact: true });
      await confirmButton.scrollIntoViewIfNeeded();
      assert.equal(await confirmButton.evaluate(b => { const r = b.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b && r.height >= 44; }), true, "confirmar visible y ≥44px");
      // Bottom sheet exactamente hasta 760 px (misma familia que el detalle).
      const sheetInfo = await dialog.evaluate(el => ({ bottom: getComputedStyle(el).bottom, w: el.getBoundingClientRect().width, iw: innerWidth, b: el.getBoundingClientRect().bottom, ih: innerHeight })); const isSheet = sheetInfo.bottom === "0px" && sheetInfo.w === sheetInfo.iw;
      assert.equal(isSheet, width <= 760, `hoja inferior ${width}px ${JSON.stringify(sheetInfo)}`);
      assert.equal(await detail.evaluate(el => el.getBoundingClientRect().width === innerWidth), width <= 760, "detalle padre coherente");
      await page.screenshot({ path: path.join(directory, `ajuste-10-4-${width}-${theme}.png`) });

      // «Volver» conserva el valor; cancelar no escribe.
      await dialog.getByRole("button", { name: "Volver", exact: true }).click();
      assert.equal(await dialog.locator("#stock-quantity").inputValue(), "4");

      // 10 → 16 y 10 → 10.
      await toConfirm(dialog, 16);
      assert.equal((await dialog.locator(".stock-adjustment-result").innerText()).trim(), "Aumenta 6 unidades · +6");
      assert.equal(await dialog.locator(".stock-adjustment-result").evaluate(el => el.classList.contains("increase")), true);
      { const p = await paint(page, ".stock-dialog .stock-adjustment-result"); assert.ok(ratio(p.fg, p.bg) >= 4.5, "contraste aumento"); }
      await page.screenshot({ path: path.join(directory, `ajuste-10-16-${width}-${theme}.png`) });
      await dialog.getByRole("button", { name: "Volver", exact: true }).click();
      await toConfirm(dialog, 10);
      assert.equal((await dialog.locator(".stock-adjustment-result").innerText()).trim(), "Sin diferencia · 0");
      assert.equal(await dialog.locator(".stock-adjustment-result").evaluate(el => el.classList.contains("none")), true);
      { const p = await paint(page, ".stock-dialog .stock-adjustment-result"); assert.ok(ratio(p.fg, p.bg) >= 4.5, "contraste sin diferencia"); }
      await page.screenshot({ path: path.join(directory, `ajuste-10-10-${width}-${theme}.png`) });
      assert.equal(active.state.writes.length + active.state.rpcs.length, 0, "ninguna escritura antes de confirmar");

      // Cancelar con Escape: cierra la operación, conserva el detalle y devuelve el foco a «Acciones».
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
      assert.equal(await detail.count(), 1);
      assert.equal(await row.getByRole("button", { name: "Acciones", exact: true }).evaluate(b => document.activeElement === b), true);
      assert.equal(actionCalls.length, 0, "cancelar no llama al servidor");

      // 10 → 10 confirmado: pasa por el control (una llamada, sin movimiento registrado).
      ({ dialog } = await openAdjust(page)); await toConfirm(dialog, 10);
      await dialog.getByRole("button", { name: "Confirmar movimiento", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      assert.equal(actionCalls.length, 1);
      assert.deepEqual([actionCalls[0].cantidadFisica, actionCalls[0].cantidadEsperada, actionCalls[0].origenId], [10, 10, 73]);
      assert.equal(active.state.writes.length, 0);

      // Error de concurrencia: cambio externo tras abrir; mensaje, valor conservado, sin escritura.
      ({ dialog } = await openAdjust(page)); await toConfirm(dialog, 4);
      active.state.tables.inventario.find(r => r.compartimiento_id === 73 && r.producto_id === productId).cantidad = 12;
      await dialog.getByRole("button", { name: "Confirmar movimiento", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "El stock cambió" }).waitFor();
      assert.equal(await dialog.locator("#stock-quantity").inputValue(), "4");
      assert.equal(await dialog.locator(".stock-adjustment").count(), 0, "vuelve al formulario");
      assert.equal(active.state.writes.length, 0);
      await page.screenshot({ path: path.join(directory, `ajuste-concurrencia-${width}-${theme}.png`) });
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      active.state.tables.inventario.find(r => r.compartimiento_id === 73 && r.producto_id === productId).cantidad = 10;
      await page.evaluate(() => window.__refresh?.());

      // Doble clic / doble submit: una sola escritura, Escape bloqueado mientras pende.
      actionDelay = 400; actionCalls.length = 0;
      ({ dialog } = await openAdjust(page)); await toConfirm(dialog, 4);
      await dialog.locator("form").evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
      await page.waitForFunction(() => document.querySelector('.stock-dialog[open] button[type="submit"]')?.disabled);
      await page.keyboard.press("Escape");
      assert.equal(await dialog.count(), 1, "Escape ignorado durante el envío");
      await dialog.waitFor({ state: "hidden" });
      assert.equal(actionCalls.length, 1, "una sola llamada");
      assert.deepEqual([active.state.writes.length, active.state.writes[0].tipo, active.state.writes[0].cantidad, active.state.writes[0].origen_compartimiento_id], [1, "ajuste", 6, 73]);
      assert.deepEqual([active.state.rpcs.at(-1).input.p_cantidad_fisica, active.state.rpcs.at(-1).input.p_cantidad_esperada], [4, 10]);
      actionDelay = 0;
      await page.waitForFunction(() => [...document.querySelectorAll(".sheet-product")].find(r => r.textContent.includes("Módulo térmico"))?.querySelector(".product-quantity strong")?.textContent.trim() === "4");

      // Segundo Escape cierra el detalle (orden: operación primero, detalle después).
      await page.keyboard.press("Escape"); await detail.waitFor({ state: "hidden" });

      // Movimiento reducido: ninguna transición/animación del diálogo supera el umbral.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(url + "/estantes/1?caja=73");
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      ({ dialog } = await openAdjust(page, "4"));
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".stock-dialog, .stock-dialog *, .compartment-dialog, .compartment-dialog *")]
        .filter(e => [getComputedStyle(e).transitionDuration, getComputedStyle(e).animationDuration].some(v => v.split(",").some(x => parseFloat(x) > 0.001))).map(e => e.className)), []);
      assert.deepEqual(errors, []);
      await page.close();
    });
  }

  // Velo anidado en los tres motores: la regla :has() debe aclarar el velo del diálogo hijo.
  for (const name of ["chromium", "firefox", "webkit"]) {
    await t.test(`velo anidado ${name}`, async () => {
      const browser = name === "chromium" ? chromium : await playwright[name].launch();
      try {
        for (const theme of ["light", "dark"]) for (const width of [390, 1280]) {
          freshFixture();
          const page = await browser.newPage({ viewport: { width, height: 800 } });
          page.setDefaultTimeout(8000);
          await page.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
          await page.goto(url + "/estantes/1?caja=73");
          await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
          const { detail, dialog, row } = await openAdjust(page);
          // Muestra de un píxel fuera de ambos paneles (esquina superior izquierda visible).
          const sample = async () => { const png = await page.screenshot({ clip: { x: 2, y: 2, width: 1, height: 1 } }); return png.toString("base64"); };
          const rgbOf = async () => page.evaluate(async b64 => {
            const image = new Image(); image.src = "data:image/png;base64," + b64; await image.decode();
            const c = document.createElement("canvas"); c.width = c.height = 1; const x = c.getContext("2d"); x.drawImage(image, 0, 0);
            return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3);
          }, await sample());
          const nested = await rgbOf();
          // Referencia: sin velo propio del hijo (solo el del detalle) y con el velo completo anterior.
          const none = await page.addStyleTag({ content: ".stock-dialog::backdrop { background: transparent !important; }" });
          const base = await rgbOf(); await none.evaluate(el => el.remove());
          const full = await page.addStyleTag({ content: ".stock-dialog::backdrop, body:has(.compartment-dialog[open]) .stock-dialog::backdrop { background: #0b272ac9 !important; }" });
          const strong = await rgbOf(); await full.evaluate(el => el.remove());
          const distance = rgb => rgb.reduce((sum, v, i) => sum + Math.abs(v - base[i]), 0);
          assert.ok(distance(strong) > 0, `${name} ${theme} ${width}: el velo completo no se nota (${base} → ${strong})`);
          assert.ok(distance(nested) > 0 && distance(nested) < distance(strong), `${name} ${theme} ${width}: el velo anidado (${nested}) no atenúa menos que el completo (${strong}) sobre ${base}`);
          // Foco/Escape intactos con el ajuste del velo.
          await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
          assert.equal(await detail.count(), 1);
          assert.equal(await row.getByRole("button", { name: "Acciones", exact: true }).evaluate(b => document.activeElement === b), true);
          await page.close();
        }
      } finally { if (name !== "chromium") await browser.close(); }
    });
  }
});
