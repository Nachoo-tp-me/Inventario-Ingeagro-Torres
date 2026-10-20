// UI04b: Inicio. Compone la página real (app/(workspace)/page.tsx) con componentes reales, lib/home-data
// y GlobalSearch reales; solo los lectores de datos (getDashboardSummary / getShelfSummaries / searchInventory)
// se sustituyen por un servidor local con el fixture en memoria. Sin Supabase, sin JWT, sin red externa.
// Node >=22; esbuild 0.28.2 y playwright 1.64.0 externos (npm install --prefix <tools> ...).
// HOME_TEST_TOOLS=<tools> (o SHELVES_TEST_TOOLS); HOME_ARTIFACTS=<ruta externa opcional para capturas>.
// node --test tests/home.browser.mjs
// LIMITACIÓN: los límites Suspense se emulan resolviendo cada hijo asíncrono de forma independiente en el
// cliente; el streaming real de Next y los errores reales de PostgREST/JWT requieren un entorno aislado.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createShelfFixture, productId, root, requireTools } from "./helpers/shelves-fixture.mjs";

const { build } = requireTools("esbuild");
const { chromium } = requireTools("playwright");

const fixture = `
  import { Suspense, Fragment, createElement, useEffect, useState, isValidElement, cloneElement } from 'react';
  import { createRoot } from 'react-dom/client';
  import { AppShell } from './components/app-shell';
  import HomePage from './app/(workspace)/page';
  import WorkspaceError from './app/(workspace)/error';
  const isAsync = type => typeof type === 'function' && type.constructor.name === 'AsyncFunction';
  // Emula un hijo de servidor dentro de <Suspense>: se resuelve por separado y muestra su fallback entretanto.
  async function realize(element) {
    if (Array.isArray(element)) return Promise.all(element.map(realize));
    if (!isValidElement(element)) return element;
    if (isAsync(element.type)) return realize(await element.type(element.props));
    if (element.props.children !== undefined) return withChildren(element, await realize(element.props.children));
    return element;
  }
  // Hijos estáticos como argumentos variádicos (igual que el JSX), para no generar avisos de «key».
  const withChildren = (element, children) => Array.isArray(children) ? cloneElement(element, undefined, ...children) : cloneElement(element, undefined, children);
  const fragment = node => Array.isArray(node) ? createElement(Fragment, null, ...node) : node;
  function Resolve({ fallback, element }) {
    const [node, setNode] = useState(null); const [done, setDone] = useState(false);
    useEffect(() => { let on = true; realize(element).then(value => { if (on) { setNode(value); setDone(true); } }, error => { if (on) window.__fatal(error); }); return () => { on = false; }; }, [element]);
    return done ? fragment(node) : fallback;
  }
  function transform(element) {
    if (Array.isArray(element)) return element.map(transform);
    if (!isValidElement(element)) return element;
    if (element.type === Suspense) return <Resolve fallback={element.props.fallback} element={element.props.children} />;
    if (element.props.children !== undefined) return withChildren(element, transform(element.props.children));
    return element;
  }
  function Current() {
    const [fatal, setFatal] = useState(null);
    const [tree] = useState(() => { try { return transform(HomePage()); } catch (error) { return { thrown: error }; } });
    useEffect(() => { window.__fatal = error => setFatal({ error }); }, []);
    const failure = fatal ?? (tree && tree.thrown ? { error: tree.thrown } : null);
    if (failure) { window.__fatalSeen = String(failure.error?.message ?? failure.error?.digest ?? 'error'); return <WorkspaceError error={failure.error instanceof Error ? failure.error : new Error('error de datos')} reset={() => location.reload()} />; }
    return tree;
  }
  createRoot(document.getElementById('root')).render(<AppShell><Current /></AppShell>);
`;

const fakes = {
  "next/link": `import {createElement} from 'react'; export default function Link({href,children,replace,prefetch,scroll,...props}){
    return createElement('a',{...props,href,onClick:event=>{event.preventDefault()}},children)}`,
  "next/navigation": `export function usePathname(){return location.pathname}
    export function useRouter(){return {replace(){},push(){},refresh(){}}}
    export function unstable_rethrow(error){ if (error && typeof error === 'object' && typeof error.digest === 'string' && error.digest.startsWith('NEXT_')) throw error; }`,
  supabase: "export function createSupabaseClient(){return {auth:{async signOut(){return {error:null}}}}}",
  towers: `async function call(name){const r=await fetch('/rpc?m='+name);const j=await r.json();
    if(j.error){const e=j.error.cls?Object.assign(new (self[j.error.cls]||Error)(j.error.message),j.error.props||{}):j.error.value;throw e;}return j.value}
    export const getDashboardSummary=()=>call('towers');`,
  shelves: `async function call(name){const r=await fetch('/rpc?m='+name);const j=await r.json();
    if(j.error){const e=j.error.cls?Object.assign(new (self[j.error.cls]||Error)(j.error.message),j.error.props||{}):j.error.value;throw e;}return j.value}
    export const getShelfSummaries=()=>call('shelves');`,
  search: "export async function searchInventory(query){const r=await fetch('/search?q='+encodeURIComponent(query));if(!r.ok)throw new Error('search unavailable');return r.json()}",
};

const lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const SECRET = "SECRET-VALUE-XYZ";
const FAILURES = {
  recoverable: { value: { message: `TypeError: fetch failed ${SECRET}`, details: SECRET, hint: "", code: "" } },
  database: { value: { message: `Could not query the database ${SECRET}`, details: "", hint: "", code: "PGRST002" } },
  access: { value: { message: "JWT expired", details: "", hint: "", code: "PGRST301" } },
  forbidden: { value: { message: "permission denied for table inventario", details: "", hint: "", code: "42501" } },
  bug: { cls: "Error", message: "El estante no tiene sus cuatro posiciones físicas disponibles." },
  redirect: { cls: "Error", message: "NEXT_REDIRECT", props: { digest: "NEXT_REDIRECT;replace;/login;307;" } },
};

test("UI04b: Inicio con resúmenes independientes de Torres y Estantes", async t => {
  const directory = process.env.HOME_ARTIFACTS ?? await mkdtemp(path.join(tmpdir(), "ingeagro-ui04b-"));
  await mkdir(directory, { recursive: true });
  t.diagnostic(`Capturas sintéticas: ${directory}`);
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: fixture }, bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "offline-data", setup(b) {
      b.onResolve({ filter: /^(next\/link|next\/navigation|@\/lib\/supabase\/client|@\/lib\/inventory|@\/lib\/shelf-data|@\/app\/\(workspace\)\/search-actions)$/ }, args => ({ path: args.path, namespace: "fake" }));
      b.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ resolveDir: root, contents:
        fakes[args.path === "next/link" ? "next/link" : args.path === "next/navigation" ? "next/navigation" : args.path.endsWith("/client") ? "supabase"
          : args.path.endsWith("/inventory") ? "towers" : args.path.endsWith("/shelf-data") ? "shelves" : "search"] }));
    } }],
  });
  const css = (await Promise.all(["app/globals.css", "components/tower-view.css", "app/theme.css", "app/catalog.css", "app/stock.css", "app/rapid.css", "app/exports.css", "app/shelves.css", "app/home.css"]
    .map(file => readFile(path.join(root, file), "utf8")))).join("\n").replace('@import "tailwindcss";', "");

  const active = createShelfFixture();
  // Código largo actual con alias histórico B10 (misma caja, mismo ID y posición).
  const LONG = "CONTROL_MOTORES_24V_ZONA";
  active.state.tables.compartimientos.find(row => row.id === 94).codigo = LONG;
  active.state.codeOwners.set(LONG, 94); active.state.codeOwners.set("B10", 94);
  const baseSummary = await active.getDashboardSummary();
  const baseShelves = (await active.shelvesPage()).props.shelves;
  const expectedBoxes = baseShelves.flatMap(shelf => shelf.cajas);
  const expected = { compartimientos: baseSummary.total, ocupados: baseSummary.ocupados, disponibles: baseSummary.disponibles, productos: baseSummary.productos,
    torres: baseSummary.torres.length, cajas: expectedBoxes.length, ocupadas: expectedBoxes.filter(box => box.ocupado).length, estantes: baseShelves.length };
  assert.equal(expected.compartimientos, 72); assert.equal(expected.cajas, 24); assert.equal(expected.estantes, 6);

  const state = { towers: "ok", shelves: "ok", delay: { towers: 0, shelves: 0 }, searchFails: false, counts: { towers: 0, shelves: 0, search: 0 } };
  const emptySummary = { torres: [], total: 0, ocupados: 0, disponibles: 0, productos: 0 };
  const zeroSummary = { ...baseSummary, torres: baseSummary.torres.map(tower => ({ ...tower, ocupados: 0, disponibles: tower.total })), ocupados: 0, disponibles: baseSummary.total };
  const zeroShelves = baseShelves.map(shelf => ({ ...shelf, cajas: shelf.cajas.map(box => ({ ...box, ocupado: false, referencias: 0, unidades: 0 })) }));
  const search = async query => {
    const needle = query.trim().toUpperCase();
    const locations = active.state.tables.compartimientos;
    const ownerId = active.state.codeOwners.get(needle);
    const place = locations.find(row => row.id === ownerId);
    const products = active.state.tables.productos.filter(product => product.nombre.toUpperCase().includes(query.trim().toUpperCase())).slice(0, 8).map(product => {
      const rows = active.state.tables.inventario.filter(row => row.producto_id === product.id && row.cantidad > 0);
      return { id: product.id, nombre: product.nombre, categoria: "Electrónica", descripcion: "", fotoUrl: null, stock: rows.reduce((sum, row) => sum + row.cantidad, 0), ubicaciones: rows.length, principales: [] };
    });
    return { products, locationAttempt: /^[A-Z0-9][A-Z0-9_-]{0,23}$/.test(needle),
      location: place ? { id: place.id, codigo: place.codigo, context: `Estante ${place.estante_id} · Posición ${place.posicion}`, href: `/estantes/${place.estante_id}?caja=${place.id}`,
        historical: place.codigo !== needle, matchedCode: needle, productos: [] } : null };
  };
  const rpc = async (name) => {
    const mode = state[name]; state.counts[name]++;
    if (state.delay[name]) await new Promise(resolve => setTimeout(resolve, state.delay[name]));
    if (FAILURES[mode]) return { error: FAILURES[mode] };
    if (name === "towers") return { value: mode === "empty" ? emptySummary : mode === "zeros" ? zeroSummary : baseSummary };
    return { value: mode === "empty" ? [] : mode === "zeros" ? zeroShelves : baseShelves };
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://fixture.test");
      if (url.pathname === "/rpc") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(await rpc(url.searchParams.get("m")))); }
      else if (url.pathname === "/search") {
        state.counts.search++;
        if (state.searchFails) { response.statusCode = 503; response.end("down"); return; }
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(await search(url.searchParams.get("q") ?? "")));
      } else if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); response.end(bundle.outputFiles[0].text); }
      else { response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`); }
    } catch (error) { response.statusCode = 503; response.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(); t.after(() => browser.close());

  async function open(width, theme, mode = {}, { delay, height = 900, reducedMotion } = {}) {
    Object.assign(state, { towers: "ok", shelves: "ok", searchFails: false, counts: { towers: 0, shelves: 0, search: 0 }, delay: { towers: 0, shelves: 0, ...delay } }, mode);
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 800, reducedMotion });
    page.setDefaultTimeout(8000);
    page.errors = []; page.logs = [];
    page.on("pageerror", error => page.errors.push(error.message));
    page.on("console", async message => { if (message.type() === "error") page.logs.push({ text: message.text(), args: await Promise.all(message.args().map(arg => arg.jsonValue().catch(() => null))) }); });
    await page.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
    await page.addInitScript(theme => { addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.theme = theme; }, { once: true }); }, theme);
    await page.goto(url + "/");
    return page;
  }
  const card = (page, kind) => page.locator(`.home-card[data-section="${kind}"]`);
  const settled = page => page.waitForFunction(() => document.querySelector(".home-card") && ![...document.querySelectorAll(".home-card")].some(c => c.dataset.state === "loading") && !document.querySelector(".home-products[aria-busy]"));
  const text = async locator => (await locator.innerText()).replace(/\s+/g, " ").trim();

  // ── Escenarios de datos (390 px, claro) ──
  await t.test("datos válidos: Torres y Estantes separados, con sus unidades y totales derivados de los datos", async () => {
    const page = await open(390, "light"); await settled(page);
    const towers = await text(card(page, "torres")), shelves = await text(card(page, "estantes"));
    assert.match(towers, new RegExp(`${expected.compartimientos} compartimientos`));
    assert.match(towers, new RegExp(`${expected.ocupados} ${expected.ocupados === 1 ? "ocupado" : "ocupados"}`));
    assert.match(towers, new RegExp(`${expected.disponibles} ${expected.disponibles === 1 ? "disponible" : "disponibles"}`));
    assert.match(shelves, new RegExp(`${expected.cajas} cajas`));
    assert.match(shelves, new RegExp(`${expected.ocupadas} ${expected.ocupadas === 1 ? "ocupada" : "ocupadas"}`));
    assert.match(shelves, new RegExp(`${expected.cajas - expected.ocupadas} disponibles`));
    assert.doesNotMatch(towers, /cajas?\b/); assert.doesNotMatch(shelves, /compartimientos?\b/);
    assert.equal(await text(page.locator(".home-products")), `${expected.productos} ${expected.productos === 1 ? "producto" : "productos"} en el catálogo`);
    assert.match(await text(page.locator(".home-explore-link").nth(0)), new RegExp(`Torres ${expected.torres} torres`));
    assert.match(await text(page.locator(".home-explore-link").nth(1)), new RegExp(`Estantes ${expected.estantes} estantes · grupos A y B`));
    assert.equal(await page.locator(".home-legend").innerText(), "Ocupado: con stock positivo. Disponible: sin stock positivo.");
    assert.deepEqual(await page.locator(".home-actions a").evaluateAll(links => links.map(link => [link.getAttribute("href"), link.textContent.trim()])), [["/carga", "Carga rápida"], ["/productos/nuevo", "Crear producto"]]);
    assert.equal(await page.locator("h1").innerText(), "Inventario");
    assert.equal(await page.locator(".page-description").innerText(), "Busca, localiza y registra existencias.");
    assert.equal(await page.locator(".hero-panel, .metrics-grid, .tower-card, .export-home-link, .rapid-home-link").count(), 0, "sin hero, métricas globales, tarjetas C1–C3 ni enlace de Exportaciones en el cuerpo");
    // La búsqueda va antes que los resúmenes.
    assert.equal(await page.evaluate(() => { const s = document.querySelector(".global-search").getBoundingClientRect().top; const o = document.querySelector(".home-overview").getBoundingClientRect().top; return s < o; }), true);
    assert.deepEqual([state.counts.towers, state.counts.shelves], [1, 1], "cada helper se invoca una sola vez");
    assert.deepEqual(page.errors, []); assert.deepEqual(page.logs, []);
    await page.close();
  });

  await t.test("ambas secciones vacías con lecturas correctas: ausencia confirmada, sin error", async () => {
    const page = await open(390, "light", { towers: "empty", shelves: "empty" }); await settled(page);
    assert.match(await text(card(page, "torres")), /No hay torres registradas/);
    assert.match(await text(card(page, "estantes")), /No hay estantes registrados/);
    assert.equal(await page.locator('[role="alert"]').count(), 0);
    assert.equal(await card(page, "torres").getAttribute("data-state"), "empty");
    assert.equal(await text(page.locator(".home-products")), "0 productos en el catálogo");
    assert.match(await text(page.locator(".home-explore-link").nth(0)), /Ver compartimientos/); assert.match(await text(page.locator(".home-explore-link").nth(1)), /Ver cajas/);
    assert.deepEqual(page.logs, []); await page.close();
  });

  await t.test("ceros válidos: 0 ocupados es un dato confirmado, distinto de un error", async () => {
    const page = await open(390, "light", { towers: "zeros", shelves: "zeros" }); await settled(page);
    assert.match(await text(card(page, "torres")), new RegExp(`${expected.compartimientos} compartimientos 0 ocupados ${expected.compartimientos} disponibles`));
    assert.match(await text(card(page, "estantes")), new RegExp(`${expected.cajas} cajas 0 ocupadas ${expected.cajas} disponibles`));
    assert.equal(await card(page, "torres").getAttribute("data-state"), "ready"); assert.equal(await page.locator('[role="alert"]').count(), 0);
    await page.close();
  });

  for (const [failure, label] of [["recoverable", "conexión"], ["database", "base de datos (PGRST002)"]]) {
    await t.test(`falla solo Torres (${label}): Estantes y la búsqueda siguen; ningún cero inventado`, async () => {
      const page = await open(390, "light", { towers: failure }); await settled(page);
      const towers = card(page, "torres");
      assert.equal(await towers.getAttribute("data-state"), "error");
      assert.match(await text(towers), /No se pudo consultar Datos no disponibles/);
      assert.equal(await towers.locator('[role="alert"]').count(), 1);
      assert.doesNotMatch(await text(towers), /\d/, "la sección fallida no muestra cifras");
      assert.equal(await text(page.locator(".home-products")), "Productos: no disponible");
      assert.equal(await card(page, "estantes").getAttribute("data-state"), "ready");
      assert.match(await text(card(page, "estantes")), new RegExp(`${expected.cajas} cajas`));
      assert.match(await text(page.locator(".home-explore-link").nth(0)), /Ver compartimientos/);
      assert.deepEqual(await page.locator(".home-explore-link").evaluateAll(links => links.map(link => link.getAttribute("href"))), ["/torres", "/estantes"]);
      assert.equal(await page.locator(".global-search input").isVisible(), true);
      // Registro mínimo: solo código; nada del mensaje, detalles ni token.
      assert.equal(page.logs.length, 1);
      assert.match(page.logs[0].text, /Inicio: no se pudo consultar Torres/);
      assert.ok(!JSON.stringify(page.logs).includes(SECRET), "el registro no contiene datos sensibles");
      assert.deepEqual(page.logs[0].args[1], { code: failure === "database" ? "PGRST002" : "connection" });
      assert.deepEqual([state.counts.towers, state.counts.shelves], [1, 1]);
      assert.equal(await page.evaluate(() => document.body.innerText.includes("SECRET")), false);
      await page.close();
    });
  }

  await t.test("falla solo Estantes: Torres y el contador global siguen; Estantes sin cifras", async () => {
    const page = await open(390, "light", { shelves: "recoverable" }); await settled(page);
    assert.equal(await card(page, "estantes").getAttribute("data-state"), "error");
    assert.doesNotMatch(await text(card(page, "estantes")), /\d/);
    assert.match(await text(card(page, "torres")), new RegExp(`${expected.compartimientos} compartimientos`));
    assert.equal(await text(page.locator(".home-products")), `${expected.productos} ${expected.productos === 1 ? "producto" : "productos"} en el catálogo`);
    assert.match(await text(page.locator(".home-explore-link").nth(1)), /Ver cajas/);
    assert.equal(page.logs.length, 1); assert.match(page.logs[0].text, /Estantes/); assert.ok(!JSON.stringify(page.logs).includes(SECRET));
    await page.close();
  });

  await t.test("fallan ambas lecturas: dos errores por sección, contador desconocido y navegación disponible", async () => {
    const page = await open(390, "dark", { towers: "recoverable", shelves: "database" }); await settled(page);
    assert.equal(await page.locator('.home-card[data-state="error"]').count(), 2);
    assert.equal(await page.locator('.home-card [role="alert"]').count(), 2);
    assert.equal(await text(page.locator(".home-products")), "Productos: no disponible");
    assert.doesNotMatch(await page.locator(".home-cards").innerText(), /\b\d+\b/);
    assert.deepEqual(await page.locator(".home-explore-link, .home-actions a").evaluateAll(links => links.map(link => link.getAttribute("href"))), ["/carga", "/productos/nuevo", "/torres", "/estantes"]);
    assert.equal(await page.locator(".side-navigation, .mobile-navigation").count(), 2);
    assert.equal(await page.locator(".global-search input").isVisible(), true);
    await page.close();
  });

  // Errores de acceso, internos de Next y de programación nunca se degradan a «sección»: llegan al límite de error.
  for (const [section, failure, label] of [["towers", "access", "autenticación (PGRST301)"], ["shelves", "forbidden", "autorización (42501)"],
    ["towers", "bug", "invariante / error de programación"], ["shelves", "bug", "invariante de estantes"], ["shelves", "redirect", "redirección interna de Next"]]) {
    await t.test(`se propaga y no se degrada: ${label} en ${section}`, async () => {
      const page = await open(390, "light", { [section]: failure });
      await page.getByRole("heading", { name: "No pudimos cargar el inventario" }).waitFor();
      assert.equal(await page.locator(".home-card").count(), 0, "ninguna tarjeta de sección en un fallo propagado");
      assert.equal(await page.locator('[data-state="error"]').count(), 0);
      assert.deepEqual(page.logs.filter(log => /Inicio: no se pudo consultar/.test(log.text)), [], "no se registra como fallo de sección");
      await page.close();
    });
  }

  // ── Independencia y estado de carga ──
  await t.test("independencia: Estantes se muestra mientras Torres sigue consultando, y viceversa", async () => {
    let page = await open(390, "light", {}, { delay: { towers: 1500 } });
    await card(page, "estantes").and(page.locator('[data-state="ready"]')).waitFor();
    const loadingTowers = card(page, "torres");
    assert.equal(await loadingTowers.getAttribute("data-state"), "loading");
    assert.equal(await text(loadingTowers), "Torres Consultando…");
    assert.equal(await loadingTowers.locator('[aria-busy="true"]').count(), 1);
    assert.doesNotMatch(await text(loadingTowers), /\d/);
    assert.equal(await text(page.locator(".home-products")), "Consultando…");
    assert.match(await text(card(page, "estantes")), new RegExp(`${expected.cajas} cajas`));
    assert.deepEqual(await page.locator(".home-explore-link").evaluateAll(links => links.map(link => link.getAttribute("href"))), ["/torres", "/estantes"], "enlaces disponibles durante la carga");
    await page.screenshot({ path: path.join(directory, "inicio-carga-parcial-390-light.png"), fullPage: true });
    await settled(page);
    assert.match(await text(card(page, "torres")), new RegExp(`${expected.compartimientos} compartimientos`));
    await page.close();
    page = await open(390, "light", {}, { delay: { shelves: 1500 } });
    await card(page, "torres").and(page.locator('[data-state="ready"]')).waitFor();
    assert.equal(await card(page, "estantes").getAttribute("data-state"), "loading");
    await settled(page); await page.close();
    // Un fallo lento de una sección no bloquea a la otra.
    page = await open(390, "light", { towers: "recoverable" }, { delay: { towers: 1200 } });
    await card(page, "estantes").and(page.locator('[data-state="ready"]')).waitFor();
    assert.equal(await card(page, "torres").getAttribute("data-state"), "loading");
    await card(page, "torres").and(page.locator('[data-state="error"]')).waitFor(); await page.close();
  });

  // ── Búsqueda existente (GlobalSearch real) ──
  await t.test("búsqueda: producto, código actual e histórico, vacío y error; sin releer los resúmenes", async () => {
    const page = await open(390, "light"); await settled(page);
    const input = page.locator(".global-search input");
    await input.fill("Módulo");
    await page.locator(".search-product-result").first().waitFor();
    assert.equal(await page.locator(".search-product-result").first().getAttribute("href"), `/productos/${productId}`);
    // V14: singular/plural de unidades en los resultados (1 unidad, no «1 unidades»)
    active.state.tables.productos.push({ id: "unico", nombre: "Pieza única", categoria_id: "cat01", foto_ruta: null }); active.state.tables.inventario.push({ compartimiento_id: 1, producto_id: "unico", cantidad: 1 });
    await input.fill("Pieza única"); await page.locator(".search-product-result").first().waitFor();
    assert.match(await text(page.locator(".search-product-result").first()), /1 unidad · 1 ubicación/); assert.doesNotMatch(await text(page.locator(".search-product-result").first()), /1 unidades/);
    await input.fill("Módulo"); await page.locator(".search-product-result").first().waitFor();
    await input.fill("B10");
    const place = page.locator(".global-location-result"); await place.waitFor();
    assert.match(await text(place), new RegExp(`Código histórico: B10 · Código actual: ${LONG}`));
    assert.equal(await place.getAttribute("href"), "/estantes/6?caja=94");
    await input.fill(LONG);
    await page.waitForFunction(code => document.querySelector(".global-location-result strong")?.textContent === code, LONG);
    assert.equal(await page.locator(".global-location-result").innerText().then(value => value.includes("Código histórico")), false);
    await input.fill("zzzzzzq");
    await page.locator(".search-empty").waitFor();
    assert.match(await text(page.locator(".search-empty")), /No encontramos/);
    state.searchFails = true; await input.fill("falla");
    await page.getByRole("alert").filter({ hasText: "No pudimos buscar" }).waitFor();
    assert.deepEqual([state.counts.towers, state.counts.shelves], [1, 1], "buscar no repite las lecturas de Inicio");
    // Con una sección fallida la búsqueda sigue funcionando.
    await page.close();
    const partial = await open(390, "light", { towers: "recoverable" }); await settled(partial);
    await partial.locator(".global-search input").fill("B10");
    await partial.locator(".global-location-result").waitFor();
    await partial.close();
  });

  // ── Matriz responsive, ambos temas ──
  const RED = { light: "rgb(209, 94, 98)", dark: "rgb(242, 138, 145)" }, GREEN = { light: "rgb(22, 131, 101)", dark: "rgb(105, 213, 165)" };
  const paints = (page, selector, fromParent) => page.locator(selector).evaluateAll((elements, fromParent) => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rgba = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    return elements.filter(element => element.getClientRects().length).map(element => { let node = fromParent ? element.parentElement : element, bg; while (node) { bg = rgba(getComputedStyle(node).backgroundColor); if (bg[3] === 255) break; node = node.parentElement; }
      const style = getComputedStyle(element); return { text: element.textContent.trim().slice(0, 40), fg: rgba(style.color), bg, ring: rgba(style.outlineColor), outlineWidth: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle }; });
  }, fromParent);
  for (const theme of ["light", "dark"]) for (const width of [320, 360, 390, 768, 1024, 1280]) for (const scenario of ["ok", "error"]) {
    await t.test(`responsive ${width}px ${theme} · ${scenario === "ok" ? "datos válidos" : "falla Torres"}`, async () => {
      const page = await open(width, theme, scenario === "ok" ? {} : { towers: "recoverable" }); await settled(page);
      await page.waitForTimeout(300); // fin de transiciones de color tras aplicar el tema
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "sin scroll horizontal");
      const geometry = await page.evaluate(() => ({ vw: innerWidth, items: [...document.querySelectorAll(".home-page .home-card, .home-page .home-actions a, .home-page .home-explore-link, .home-page .global-search .search-preview")]
        .map(element => { const r = element.getBoundingClientRect(); return { cls: element.className.split(" ")[0], left: r.left, right: r.right, h: Math.round(r.height), clipped: element.scrollWidth > element.clientWidth + 1 }; }) }));
      for (const item of geometry.items) { assert.ok(item.left >= -0.5 && item.right <= geometry.vw + 0.5, `${item.cls} fuera de pantalla`); assert.equal(item.clipped, false, `${item.cls} recortado`); }
      for (const item of geometry.items.filter(item => item.cls !== "home-card")) assert.ok(item.h >= 44, `${item.cls} ${item.h}px`);
      // Dos tarjetas lado a lado desde 340 px; apiladas por debajo (320 px).
      const cards = await page.locator(".home-card").evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }));
      if (width >= 340) assert.equal(cards[0][1], cards[1][1], "tarjetas en una fila"); else assert.ok(cards[1][1] > cards[0][1], "tarjetas apiladas a 320 px");
      for (const selector of [".home-overview-heading h2", ".home-explore h2", ".home-card h3", ".home-card-total", ".home-card-split li", ".home-card-error p", ".home-card-error span", ".home-legend", ".home-products", ".home-explore-link strong", ".home-explore-link small", ".home-actions a", ".page-heading h1", ".page-description"])
        for (const sample of await paints(page, selector, false)) assert.ok(ratio(sample.fg, sample.bg) >= 4.5, `${selector} «${sample.text}» ${ratio(sample.fg, sample.bg).toFixed(2)}`);
      // Opción A: rojo = ocupado, verde = disponible (misma pintura que en torres y estantes).
      if (scenario === "ok") {
        const dots = await page.evaluate(() => ({ occupied: [...document.querySelectorAll(".occupancy-dot")].map(e => getComputedStyle(e).backgroundColor), available: [...document.querySelectorAll(".availability-dot")].map(e => getComputedStyle(e).backgroundColor) }));
        assert.deepEqual([...new Set(dots.occupied)], [RED[theme]]); assert.deepEqual([...new Set(dots.available)], [GREEN[theme]]); assert.equal(dots.occupied.length, 2);
      }
      // Navegación aprobada en UI04a: «Inicio» activo, etiqueta contextual, un solo cierre de sesión visible.
      const nav = page.locator(width <= 760 ? ".mobile-navigation" : ".side-navigation");
      assert.deepEqual(await nav.locator('a[aria-current="page"]').evaluateAll(links => links.map(link => link.getAttribute("href"))), ["/"]);
      if (width > 760) assert.equal((await page.locator(".topbar-section").innerText()).trim(), "Inicio");
      assert.equal(await page.locator(".signout").filter({ visible: true }).count(), 1);
      if ([320, 390, 768, 1280].includes(width)) await page.screenshot({ path: path.join(directory, `inicio-${scenario}-${width}-${theme}.png`), fullPage: true });
      assert.deepEqual(page.errors, []);
      await page.close();
    });
  }

  // ── Teclado, foco y movimiento reducido ──
  for (const theme of ["light", "dark"]) for (const width of [390, 1280]) {
    await t.test(`teclado y foco ${width}px ${theme}`, async () => {
      const page = await open(width, theme); await settled(page);
      await page.keyboard.press("Tab"); await page.keyboard.press("Enter"); // «Saltar al contenido»
      assert.equal(await page.evaluate(() => document.activeElement?.id), "contenido");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.matches(".global-search input")), true, "el primer control del contenido es la búsqueda");
      const focusRing = async () => (await paints(page, ":focus-visible", true))[0];
      const names = [];
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Tab");
        names.push(await page.evaluate(() => document.activeElement.innerText.trim().replace(/\s+/g, " ")));
        const ring = await focusRing(); assert.ok(ring.outlineStyle === "solid" && ring.outlineWidth >= 3 && ratio(ring.ring, ring.bg) >= 3, `foco en «${names.at(-1)}»`);
      }
      assert.deepEqual(names, ["Carga rápida", "Crear producto", `Torres ${expected.torres} torres`, `Estantes ${expected.estantes} estantes · grupos A y B`]);
      const searchRing = await page.locator(".global-search input").focus().then(() => paints(page, ".global-search .search-preview", true));
      assert.ok(searchRing.length === 1);
      await page.close();
    });
  }
  await t.test("prefers-reduced-motion: sin transiciones en los accesos de Inicio", async () => {
    const page = await open(1280, "light", {}, { reducedMotion: "reduce" }); await settled(page);
    assert.ok(await page.locator(".home-explore-link, .nav-link").evaluateAll(els => els.every(el => getComputedStyle(el).transitionDuration.split(",").every(value => parseFloat(value) <= 0.001))));
    await page.close();
    const normal = await open(1280, "light"); await settled(normal);
    assert.ok(await normal.locator(".home-explore-link").first().evaluate(el => parseFloat(getComputedStyle(el).transitionDuration) > 0.1));
    await normal.close();
  });
});
