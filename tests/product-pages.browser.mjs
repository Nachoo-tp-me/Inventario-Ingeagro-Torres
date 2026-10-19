// UI05a: catálogo de productos (filas compactas) y ficha stock-primero. Componentes y páginas reales
// (app/(workspace)/productos/page.tsx y [id]/page.tsx) con AppShell; solo los lectores de datos
// (@/lib/product-catalog, @/lib/stock-data) y submitStockOperation se sustituyen por un servidor local con
// datos sintéticos. Sin Supabase, sin JWT, sin red externa. Aditivo e independiente de B4: invariantes
// semánticas y geométricas, sin snapshots ni baselines.
// Node >=22; esbuild 0.28.2 y playwright 1.64.0 externos (npm install --prefix <tools> ...).
// PRODUCT_TEST_TOOLS=<tools> (o SHELVES_TEST_TOOLS); PRODUCT_ARTIFACTS=<ruta externa opcional para capturas>.
// PRODUCT_BASE_REF = commit del catálogo/ficha anteriores para las medidas antes/después (por defecto 6c10bfc…).
// node --test tests/product-pages.browser.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFile, mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireTools = createRequire(path.join(process.env.PRODUCT_TEST_TOOLS ?? process.env.SHELVES_TEST_TOOLS ?? root, "package.json"));
const { build } = requireTools("esbuild");
const { chromium } = requireTools("playwright");
const BASE_REF = process.env.PRODUCT_BASE_REF ?? "6c10bfc90f92aff4c8c2435a7ea9db2bc86940e7";
const cssFiles = ["app/globals.css", "components/tower-view.css", "app/theme.css", "app/catalog.css", "app/stock.css", "app/rapid.css", "app/exports.css", "app/shelves.css"];
// Archivos de UI05a: la variante «antes» los lee del commit fijo, sin tocar el árbol de trabajo.
const PINNED = ["components/product-catalog-list.tsx", "components/product-stock-controls.tsx", "app/(workspace)/productos/[id]/page.tsx", "app/(workspace)/productos/page.tsx"];

const fixture = `
  import { Fragment, createElement, useEffect, useState, isValidElement, cloneElement } from 'react';
  import { createRoot } from 'react-dom/client';
  import { AppShell } from './components/app-shell';
  import ProductsPage from './app/(workspace)/productos/page';
  import ProductDetailPage from './app/(workspace)/productos/[id]/page';
  const isAsync = type => typeof type === 'function' && type.constructor.name === 'AsyncFunction';
  async function realize(element) {
    if (Array.isArray(element)) return Promise.all(element.map(realize));
    if (!isValidElement(element)) return element;
    if (isAsync(element.type)) return realize(await element.type(element.props));
    if (element.props.children !== undefined) { const children = await realize(element.props.children); return Array.isArray(children) ? cloneElement(element, undefined, ...children) : cloneElement(element, undefined, children); }
    return element;
  }
  function Current() {
    const [node, setNode] = useState(null);
    useEffect(() => {
      const parts = location.pathname.split('/').filter(Boolean);
      const page = parts.length === 1 ? ProductsPage() : ProductDetailPage({ params: Promise.resolve({ id: parts[1] }), searchParams: Promise.resolve({}) });
      realize(page).then(setNode, error => setNode(<p data-not-found>{String(error?.digest ?? error?.message ?? error)}</p>));
    }, []);
    return node ? (Array.isArray(node) ? createElement(Fragment, null, ...node) : node) : null;
  }
  createRoot(document.getElementById('root')).render(<AppShell><div data-ready><Current /></div></AppShell>);
`;
const fakes = {
  "next/link": `import {createElement} from 'react'; export default function Link({href,children,replace,prefetch,scroll,...props}){
    return createElement('a',{...props,href,onClick:event=>{event.preventDefault();window.__navigated=href}},children)}`,
  "next/navigation": `export function usePathname(){return location.pathname}
    export function useRouter(){return {replace(){},push(){},refresh(){window.__refreshed=(window.__refreshed||0)+1}}}
    export function notFound(){throw Object.assign(new Error('NEXT_NOT_FOUND'),{digest:'NEXT_HTTP_ERROR_FALLBACK;404'})}`,
  supabase: "export function createSupabaseClient(){return {auth:{async signOut(){return {error:null}}}}}",
  catalog: `async function call(name,id){const r=await fetch('/rpc?m='+name+(id?'&id='+encodeURIComponent(id):''));if(!r.ok)throw new Error('rpc');return r.json()}
    export const getProducts=()=>call('products'); export const getProduct=id=>call('product',id);`,
  stockData: `export async function getPhysicalLocations(){const r=await fetch('/rpc?m=locations');return r.json()}`,
  stockActions: `export async function submitStockOperation(input){const r=await fetch('/action',{method:'POST',body:JSON.stringify(input)});return r.json()}`,
};

async function bundleFor(before) {
  const old = file => execFileSync("git", ["show", `${BASE_REF}:${file}`], { cwd: root, encoding: "utf8" });
  const normalized = PINNED.map(file => path.join(root, file).replace(/\\/g, "/"));
  const result = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: fixture }, bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "offline-and-rev", setup(b) {
      b.onResolve({ filter: /^(next\/link|next\/navigation|@\/lib\/supabase\/client|@\/lib\/product-catalog|@\/lib\/stock-data|@\/app\/\(workspace\)\/(stock-actions|box-code-actions))$/ }, args => ({ path: args.path, namespace: "fake" }));
      b.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ resolveDir: root, contents: fakes[
        args.path === "next/link" ? "next/link" : args.path === "next/navigation" ? "next/navigation" : args.path.endsWith("/supabase/client") ? "supabase"
          : args.path.endsWith("/product-catalog") ? "catalog" : args.path.endsWith("/stock-data") ? "stockData" : "stockActions"]
        ?? "export async function renameBoxCode(){return {ok:false}}" }));
      if (before) b.onLoad({ filter: /\.tsx$/ }, args => {
        const normal = args.path.replace(/\\/g, "/"); const index = normalized.indexOf(normal);
        return index < 0 ? undefined : { resolveDir: root, loader: "tsx", contents: old(PINNED[index]) };
      });
    } }],
  });
  return result.outputFiles[0].text;
}

// ── Datos sintéticos ──
const LONG_CODE = "CONTROL_MOTORES_24V_ZONA", W24 = "W".repeat(24);
const physical = [
  ...Array.from({ length: 72 }, (_, i) => ({ tipo: "compartimiento", id: i + 1, codigo: `C${Math.floor(i / 24) + 1}${Math.floor((i % 24) / 4) + 1}${(i % 4) + 1}`, torre_id: Math.floor(i / 24) + 1, piso: Math.floor((i % 24) / 4) + 1, posicion: (i % 4) + 1 })),
  ...Array.from({ length: 24 }, (_, i) => ({ tipo: "caja", id: i + 73, codigo: (i < 12 ? "A" : "B") + ((i % 12) + 1), estante_id: Math.floor(i / 4) + 1, posicion: (i % 4) + 1 })),
];
physical.find(row => row.id === 78).codigo = "MOTORES_1"; physical.find(row => row.id === 94).codigo = LONG_CODE; physical.find(row => row.id === 95).codigo = W24;
const codeOf = id => physical.find(row => row.id === id).codigo;
const LONG_NAME = "Controlador lógico programable modular con módulo de expansión analógica y comunicación industrial redundante serie XL-9000";
const LONG_CATEGORY = "Automatización industrial, instrumentación y control de procesos de alta disponibilidad";
function makeProduct(index, nombre, categoria, descripcion, photo, placed) {
  const locations = placed.map(([id, cantidad]) => ({ id, codigo: codeOf(id), cantidad })).sort((a, b) => a.codigo.localeCompare(b.codigo, "es"));
  return { product: { id: `p-${index}`, nombre, categoria_id: "cat", categoria, descripcion, foto_ruta: photo ? `x/${index}` : null,
      fotoUrl: photo === "ok" ? "/img/ok.svg" : photo === "fail" ? "/img/missing.png" : null, actualizado_en: "2026-10-19T12:00:00.000Z",
      stock: locations.reduce((sum, item) => sum + item.cantidad, 0), ubicaciones: locations.length }, locations };
}
const NINE = [
  makeProduct(1, "Módulo térmico", "Electrónica", "Módulo de control y protección térmica para equipos de prueba.", "ok", [[73, 8], [85, 10], [1, 4], [5, 1], [94, 2], [78, 1]]),
  makeProduct(2, "ESP32-S3 C++", "Sensores técnicos", "Placa de desarrollo ESP32-S3.", null, [[2, 7], [73, 5]]),
  makeProduct(3, "Relé industrial 24 V", "Repuestos", "", "fail", [[1, 1]]),
  makeProduct(4, "Conector M12 de 4 pines", "Conectores y cables", "Sin stock registrado.", "ok", []),
  makeProduct(5, "Soporte inoxidable C#", "Repuestos", "Soporte de acero inoxidable.", null, [[3, 6], [4, 6]]),
  makeProduct(6, "Cable apantallado 2 × 0,75 mm² · ½\" de calibre", "Conectores y cables", "Cable multifilar apantallado.", null, [[95, 12]]),
  makeProduct(7, LONG_NAME, LONG_CATEGORY, "x".repeat(300), "ok", [[94, 3], [95, 4], [96, 5]]),
  makeProduct(8, "MOTORES", "Repuestos", null, null, [[78, 9]]),
  makeProduct(9, "Fusible 10 A", "Electrónica", "Fusible de vidrio 5 × 20 mm.", null, []),
];
const SIXTY = [...NINE, ...Array.from({ length: 51 }, (_, i) => makeProduct(10 + i, `Producto de prueba ${String(10 + i).padStart(2, "0")}`, ["Electrónica", "Repuestos", "Sensores técnicos"][i % 3], i % 2 ? "Descripción de prueba." : "", i % 5 === 0 ? "ok" : null, i % 4 === 0 ? [] : [[1 + (i % 70), 1 + (i % 9)]]))];
const SET = { nine: NINE, sixty: SIXTY, one: [NINE[7]], empty: [] };

test("UI05a: catálogo compacto y ficha stock-primero", async t => {
  const directory = process.env.PRODUCT_ARTIFACTS ?? await mkdtemp(path.join(tmpdir(), "ingeagro-ui05a-"));
  await mkdir(directory, { recursive: true });
  t.diagnostic(`Capturas sintéticas: ${directory}`);
  const bundles = { after: await bundleFor(false), before: await bundleFor(true) };
  const css = {
    after: (await Promise.all(cssFiles.map(file => readFile(path.join(root, file), "utf8")))).join("\n").replace('@import "tailwindcss";', ""),
    before: cssFiles.map(file => execFileSync("git", ["show", `${BASE_REF}:${file}`], { cwd: root, encoding: "utf8" })).join("\n").replace('@import "tailwindcss";', ""),
  };
  const state = { set: "nine", actions: [], rpcs: [] };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://fixture.test");
    const rev = url.searchParams.get("rev") === "before" ? "before" : "after";
    const json = value => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value)); };
    if (url.pathname === "/rpc") {
      const name = url.searchParams.get("m"); state.rpcs.push(name);
      if (name === "products") json(SET[state.set].map(item => item.product));
      else if (name === "product") { const found = [...SIXTY].find(item => item.product.id === url.searchParams.get("id")); json(found ?? null); }
      else json(physical);
    } else if (url.pathname === "/action") {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      state.actions.push(JSON.parse(Buffer.concat(chunks).toString())); json({ ok: true, message: "Movimiento registrado." });
    } else if (url.pathname === "/img/ok.svg") { response.setHeader("Content-Type", "image/svg+xml"); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#7aa89b"/><circle cx="80" cy="60" r="30" fill="#fff"/></svg>'); }
    else if (url.pathname.startsWith("/img/")) { response.statusCode = 404; response.end("missing"); }
    else if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); response.end(bundles[rev]); }
    else { response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[rev]}</style><div id="root"></div><script src="/fixture.js?rev=${rev}"></script></html>`); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(); t.after(() => browser.close());

  async function open(route, { width = 390, height = 844, theme = "light", set = "nine", rev = "after", reducedMotion } = {}) {
    state.set = set; state.actions = []; state.rpcs = [];
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 800, reducedMotion });
    page.setDefaultTimeout(8000); page.errors = [];
    page.on("pageerror", error => page.errors.push(error.message));
    await page.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
    await page.addInitScript(theme => { addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.theme = theme; }, { once: true }); }, theme);
    await page.goto(`${url}${route}?rev=${rev}`);
    await page.locator("[data-ready] h1").waitFor();
    await page.waitForFunction(() => [...document.images].every(image => image.complete || image.loading === "lazy")); // fotos visibles cargadas o falladas
    await page.waitForTimeout(250); // fin de transiciones de color tras aplicar el tema
    return page;
  }

  const lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const paints = (page, selector, fromParent = false) => page.locator(selector).evaluateAll((elements, fromParent) => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rgba = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    return elements.filter(element => element.getClientRects().length).map(element => { let node = fromParent ? element.parentElement : element, bg; while (node) { bg = rgba(getComputedStyle(node).backgroundColor); if (bg[3] === 255) break; node = node.parentElement; }
      const style = getComputedStyle(element); return { text: element.textContent.trim().slice(0, 40), fg: rgba(style.color), bg, ring: rgba(style.outlineColor), outlineWidth: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle }; });
  }, fromParent);
  const text = async locator => (await locator.innerText()).replace(/\s+/g, " ").trim();
  const byName = (page, name) => page.locator(".catalog-card").filter({ has: page.getByRole("heading", { name, exact: true }) });

  // ── Catálogo ──
  await t.test("catálogo: filas con miniatura, nombre, categoría, unidades y ubicaciones (0/1/n), sin descripción", async () => {
    const page = await open("/productos"); const rows = page.locator(".catalog-card");
    assert.equal(await rows.count(), 9);
    assert.equal(await page.locator(".catalog-card .catalog-thumb").count(), 9);
    assert.equal(await page.getByText("Producto de prueba", { exact: false }).count(), 0);
    // Singular, plural y cero: «1 unidad · 1 ubicación», «26 unidades · 6 ubicaciones», «0 unidades · Sin stock».
    assert.match(await text(byName(page, "Relé industrial 24 V")), /Repuestos 1 unidad 1 ubicación$/);
    assert.match(await text(byName(page, "Módulo térmico")), /Electrónica 26 unidades 6 ubicaciones$/);
    assert.match(await text(byName(page, "Conector M12 de 4 pines")), /Conectores y cables 0 unidades Sin stock$/);
    assert.equal(await byName(page, "Conector M12 de 4 pines").evaluate(row => row.classList.contains("no-stock")), true);
    assert.match(await text(byName(page, "MOTORES")), /9 unidades 1 ubicación$/);
    // La suma del catálogo coincide con los datos de cada producto (sin cifras inventadas).
    for (const { product } of NINE) assert.match(await text(page.locator(`.catalog-card[href="/productos/${product.id}"]`)), new RegExp(`${product.stock === 1 ? "1 unidad" : `${product.stock} unidades`}`));
    assert.deepEqual(await rows.evaluateAll(links => links.map(link => link.getAttribute("href"))), NINE.map(item => `/productos/${item.product.id}`));
    // Nombres y categorías largos o con símbolos: completos, sin elipsis.
    const long = byName(page, LONG_NAME);
    assert.match(await text(long), new RegExp(LONG_CATEGORY));
    assert.equal(await long.locator("h2").evaluate(heading => getComputedStyle(heading).textOverflow), "clip");
    for (const name of ["ESP32-S3 C++", "Soporte inoxidable C#", "Cable apantallado 2 × 0,75 mm² · ½\" de calibre"]) assert.equal(await byName(page, name).count(), 1, name);
    assert.deepEqual(page.errors, []); await page.close();
  });

  await t.test("catálogo: título, acciones, filtro B3, vacío y 1 producto", async () => {
    let page = await open("/productos");
    assert.equal(await text(page.locator(".catalog-heading-row .catalog-button")), "Crear producto");
    assert.equal(await page.locator(".catalog-heading-row .catalog-button").getAttribute("href"), "/productos/nuevo");
    assert.equal(await text(page.locator(".catalog-count")), "9 productos registrados");
    const filter = page.getByRole("searchbox", { name: "Filtrar productos por nombre o categoría" });
    await filter.fill("modulo"); // sin acentos
    assert.equal(await page.locator(".catalog-card").count(), 2); assert.equal(await text(page.locator(".catalog-count")), "2 productos encontrados");
    await filter.fill("repuestos"); assert.equal(await page.locator(".catalog-card").count(), 3);
    await filter.fill("soporte"); assert.equal(await page.locator(".catalog-card").count(), 1);
    await filter.fill("no-existe-xyz");
    assert.equal(await page.locator(".catalog-card").count(), 0);
    assert.equal(await text(page.locator(".catalog-empty.compact h2")), "No encontramos productos");
    assert.equal(await text(page.locator(".catalog-empty.compact .catalog-button")), "Crear producto");
    await page.close();
    page = await open("/productos", { set: "one" });
    assert.equal(await page.locator(".catalog-card").count(), 1); assert.equal(await text(page.locator(".catalog-count")), "1 producto registrados"); await page.close();
    page = await open("/productos", { set: "empty" });
    assert.equal(await text(page.locator(".catalog-empty h2")), "Aún no hay productos registrados");
    assert.equal(await text(page.locator(".catalog-empty .catalog-button")), "Crear producto");
    assert.equal(await page.locator(".catalog-card").count(), 0); await page.close();
  });

  await t.test("catálogo: 60 productos en filas compactas y fotos presentes, ausentes y fallidas", async () => {
    const page = await open("/productos", { set: "sixty" });
    assert.equal(await page.locator(".catalog-card").count(), 60);
    // Foto presente: carga; ausente: solo el icono; fallida: la imagen se oculta y queda el icono.
    const ok = byName(page, "Módulo térmico"), none = byName(page, "ESP32-S3 C++"), failed = byName(page, "Relé industrial 24 V");
    await ok.scrollIntoViewIfNeeded(); await page.waitForFunction(() => document.querySelector('.catalog-card[href="/productos/p-1"] img')?.naturalWidth > 0);
    assert.equal(await none.locator("img").count(), 0);
    assert.equal(await none.locator(".catalog-thumb svg").isVisible(), true);
    await failed.scrollIntoViewIfNeeded(); await page.waitForFunction(() => document.querySelector('.catalog-card[href="/productos/p-3"] img')?.hidden === true);
    assert.equal(await failed.locator(".catalog-thumb").getAttribute("data-failed"), "true");
    assert.equal(await failed.locator(".catalog-thumb svg").isVisible(), true);
    assert.equal(await failed.locator(".catalog-thumb").evaluate(thumb => { const r = thumb.getBoundingClientRect(); return r.width === 44 && r.height === 44; }), true);
    assert.deepEqual(page.errors, []); await page.close();
  });

  // ── Ficha ──
  await t.test("ficha: orden DOM stock-primero, total = suma de ubicaciones y acción principal", async () => {
    const page = await open("/productos/p-1");
    const order = await page.evaluate(() => {
      const query = selector => document.querySelector(selector);
      const items = [["back", ".back-link"], ["h1", ".product-page h1"], ["edit", ".catalog-heading-row .catalog-button"], ["summary", ".catalog-stock-summary"], ["locations", "#catalog-locations-title"],
        ["add", ".catalog-section-heading .catalog-button"], ["list", ".catalog-location-list"], ["details", ".catalog-secondary"]];
      const nodes = items.map(([name, selector]) => [name, query(selector)]);
      return { found: nodes.map(([name, node]) => [name, !!node]), ordered: nodes.every(([, node], index) => index === 0 || (nodes[index - 1][1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) };
    });
    assert.deepEqual(order.found.filter(([, found]) => !found), []); assert.equal(order.ordered, true, "orden del DOM");
    assert.equal(await text(page.locator(".catalog-stock-summary")), "Stock total 26 unidades Ubicaciones 6 ubicaciones");
    assert.equal(await text(page.locator(".catalog-section-heading .catalog-button")), "Agregar stock");
    assert.equal(await page.locator(".catalog-section-heading .catalog-button").evaluate(button => button.classList.contains("primary")), true);
    const edit = page.locator(".catalog-heading-row .catalog-button");
    assert.equal(await edit.getAttribute("href"), "/productos/p-1/editar"); assert.equal(await edit.evaluate(link => link.classList.contains("primary")), false);
    const rows = await page.locator(".catalog-location-list li").evaluateAll(items => items.map(item => ({ code: item.querySelector(".catalog-location-code").textContent.trim(), units: item.querySelector("strong").textContent.trim() })));
    assert.equal(rows.length, 6);
    assert.equal(rows.reduce((sum, row) => sum + Number(row.units.split(" ")[0]), 0), 26);
    assert.deepEqual(rows.map(row => row.code).sort(), NINE[0].locations.map(item => item.codigo).sort(), "códigos íntegros (incluye el de 24 caracteres)");
    assert.ok(rows.some(row => row.code === LONG_CODE) && rows.some(row => row.units === "1 unidad"));
    assert.equal(await page.locator("h2#catalog-locations-title").count(), 1);
    assert.deepEqual(page.errors, []); await page.close();
  });

  await t.test("ficha: sin stock y 1 unidad", async () => {
    let page = await open("/productos/p-4");
    assert.equal(await text(page.locator(".catalog-stock-summary")), "Stock total 0 unidades Ubicaciones Sin stock");
    assert.equal(await text(page.locator(".catalog-no-stock")), "Sin stock asignado"); assert.equal(await page.locator(".catalog-location-list").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Agregar stock" }).isEnabled(), true); await page.close();
    page = await open("/productos/p-3");
    assert.equal(await text(page.locator(".catalog-stock-summary")), "Stock total 1 unidad Ubicaciones 1 ubicación"); await page.close();
  });

  await t.test("ficha 390×844: stock total, primera ubicación y «Acciones» visibles sin desplazarse", async () => {
    for (const theme of ["light", "dark"]) {
      const page = await open("/productos/p-1", { theme });
      const view = await page.evaluate(() => { const r = selector => document.querySelector(selector).getBoundingClientRect(); const nav = document.querySelector(".mobile-navigation").getBoundingClientRect();
        return { stockBottom: r(".catalog-stock-summary").bottom, rowBottom: r(".catalog-location-list li").bottom, actionBottom: r(".catalog-location-list li .stock-action-trigger").bottom, navTop: nav.top, scrolled: scrollY }; });
      assert.equal(view.scrolled, 0);
      assert.ok(view.stockBottom < view.navTop && view.rowBottom < view.navTop && view.actionBottom < view.navTop, JSON.stringify(view));
      const trigger = page.locator(".catalog-location-list li .stock-action-trigger").first();
      assert.equal(await trigger.evaluate(button => { const r = button.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === button && r.height >= 44; }), true);
      await page.screenshot({ path: path.join(directory, `ficha-390-${theme}.png`) });
      await page.close();
    }
  });

  await t.test("ficha: descripción y fotografía en <details> cerrado, accesible por teclado; foto presente, ausente y fallida", async () => {
    let page = await open("/productos/p-1");
    const details = page.locator(".catalog-secondary");
    assert.equal(await details.evaluate(element => element.open), false);
    assert.equal(await page.locator(".catalog-photo-frame").isVisible(), false);
    await page.locator(".catalog-secondary summary").focus(); await page.keyboard.press("Enter");
    assert.equal(await details.evaluate(element => element.open), true);
    await page.waitForFunction(() => document.querySelector(".catalog-photo-frame img")?.naturalWidth > 0);
    assert.equal(await page.locator(".catalog-photo-frame img").getAttribute("alt"), "Fotografía de Módulo térmico");
    assert.match(await text(page.locator(".catalog-description")), /Módulo de control y protección térmica/);
    await page.keyboard.press("Space"); assert.equal(await details.evaluate(element => element.open), false); await page.close();
    // Ausente.
    page = await open("/productos/p-2"); await page.locator(".catalog-secondary summary").click();
    assert.equal(await page.locator(".catalog-photo-frame img").count(), 0);
    assert.equal(await text(page.locator(".catalog-photo-fallback")), "Sin fotografía");
    assert.equal(await page.locator(".catalog-photo-fallback").isVisible(), true); await page.close();
    // Fallida: la imagen se oculta y el mensaje lo dice.
    page = await open("/productos/p-3"); await page.locator(".catalog-secondary summary").click();
    await page.waitForFunction(() => document.querySelector(".catalog-photo-frame")?.hasAttribute("data-failed"));
    assert.equal(await page.locator(".catalog-photo-frame img").evaluate(image => image.hidden), true);
    assert.equal(await text(page.locator(".catalog-photo-fallback")), "No se pudo cargar la fotografía");
    // Sin descripción.
    assert.equal(await text(page.locator(".catalog-description")), "Sin descripción."); await page.close();
  });

  await t.test("ficha: acciones por ubicación conservan producto, origen y cantidad; Escape devuelve el foco", async () => {
    const page = await open("/productos/p-1");
    const rows = page.locator(".catalog-location-list li");
    const row = rows.nth(2); const code = (await text(row.locator(".catalog-location-code"))), quantity = Number((await text(row.locator("strong"))).split(" ")[0]);
    const trigger = row.getByRole("button", { name: "Acciones" });
    await trigger.click();
    const menu = page.locator(".stock-action-options:popover-open");
    await menu.waitFor();
    assert.deepEqual(await menu.getByRole("button").allTextContents(), ["Retirar", "Mover", "Ajustar"]);
    await menu.getByRole("button", { name: "Ajustar", exact: true }).click();
    const dialog = page.locator(".stock-dialog[open]"); await dialog.waitFor();
    assert.equal(await text(dialog.locator(".stock-fixed-choice").nth(0)), "Producto Módulo térmico");
    assert.equal(await text(dialog.locator(".stock-fixed-choice").nth(1)), `Ubicación de origen ${code}`);
    assert.equal(await dialog.locator("#stock-quantity").inputValue(), String(quantity));
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    assert.equal(await trigger.evaluate(button => document.activeElement === button), true, "el foco vuelve a «Acciones» de esa fila");
    assert.equal(state.actions.length, 0, "cancelar no envía ninguna operación");
    // Retirar muestra la disponibilidad de esa fila; Ajustar confirmado envía el payload de esa ubicación.
    await trigger.click(); await menu.getByRole("button", { name: "Retirar", exact: true }).click();
    assert.match(await text(dialog.locator(".stock-available")), new RegExp(`Disponible en origen: ${quantity} unidades`));
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    await trigger.click(); await menu.getByRole("button", { name: "Ajustar", exact: true }).click();
    await dialog.locator("#stock-quantity").fill(String(quantity + 3)); await dialog.getByRole("button", { name: "Continuar" }).click();
    await dialog.getByRole("button", { name: "Confirmar movimiento" }).click(); await dialog.waitFor({ state: "hidden" });
    assert.equal(state.actions.length, 1);
    assert.deepEqual([state.actions[0].tipo, state.actions[0].productoId, state.actions[0].cantidadEsperada, state.actions[0].cantidadFisica], ["ajuste", "p-1", quantity, quantity + 3]);
    assert.equal(state.actions[0].origenId, NINE[0].locations.find(item => item.codigo === code).id);
    assert.equal(await page.evaluate(() => window.__refreshed), 1);
    assert.deepEqual(page.errors, []); await page.close();
  });

  // ── Desborde: el commit base lo reproduce y la corrección ataca su causa ──
  await t.test("desborde horizontal de la ficha: el commit base lo reproduce (ficha larga a 761–841 px, código de 24 caracteres en móvil) y ahora es 0", async () => {
    const overflow = async (rev, id, width) => { const page = await open(`/productos/${id}`, { rev, width, height: 900 }); const value = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); await page.close(); return value; };
    for (const width of [761, 768, 840]) { assert.ok(await overflow("before", "p-7", width) > 0, `base debía desbordar a ${width}px`); assert.equal(await overflow("after", "p-7", width), 0, `ficha p-7 a ${width}px`); }
    for (const width of [320, 390]) { assert.ok(await overflow("before", "p-6", width) > 0, `base debía desbordar a ${width}px`); assert.equal(await overflow("after", "p-6", width), 0, `ficha p-6 a ${width}px`); }
  });

  // ── Responsive, contraste, foco, objetivos y columnas ──
  for (const theme of ["light", "dark"]) for (const width of [320, 360, 390, 761, 768, 840, 841, 1024, 1280]) {
    await t.test(`responsive ${width}px ${theme}: catálogo y ficha`, async () => {
      let page = await open("/productos", { width, theme });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "catálogo sin scroll horizontal");
      const rows = await page.locator(".catalog-card").evaluateAll(cards => cards.map(card => { const r = card.getBoundingClientRect(); const meta = card.querySelector(".catalog-card-units").getBoundingClientRect(), name = card.querySelector("h2").getBoundingClientRect(), locations = card.querySelector(".catalog-card-locations").getBoundingClientRect();
        return { left: r.left, right: r.right, h: Math.round(r.height), clipped: card.scrollWidth > card.clientWidth + 1, sameLine: meta.left >= name.right - 0.5, unitsX: Math.round(meta.left), locationsX: Math.round(locations.left), innerRight: Math.max(meta.right, locations.right, name.right) <= r.right + 0.5 }; }));
      for (const row of rows) { assert.ok(row.left >= -0.5 && row.right <= width + 0.5 && !row.clipped && row.innerRight && row.h >= 56, JSON.stringify(row)); }
      const wide = (await page.locator(".catalog-grid").evaluate(list => list.getBoundingClientRect().width)) >= 840;
      assert.equal(rows.every(row => row.sameLine), wide, `columnas alineadas solo desde 840 px útiles (lista ${wide})`);
      if (wide) { assert.equal(new Set(rows.map(row => row.unitsX)).size, 1); assert.equal(new Set(rows.map(row => row.locationsX)).size, 1); }
      for (const selector of [".catalog-card h2", ".catalog-card .catalog-category", ".catalog-card-units", ".catalog-card-locations", ".catalog-count", ".page-description"])
        for (const sample of await paints(page, selector)) assert.ok(ratio(sample.fg, sample.bg) >= 4.5, `${selector} «${sample.text}» ${ratio(sample.fg, sample.bg).toFixed(2)}`);
      if ([320, 390, 768, 1280].includes(width)) await page.screenshot({ path: path.join(directory, `catalogo-${width}-${theme}.png`), fullPage: false });
      await page.locator(".catalog-card").first().focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
      const ring = (await paints(page, ":focus-visible", true))[0]; assert.ok(ring.outlineStyle === "solid" && ring.outlineWidth >= 3 && ratio(ring.ring, ring.bg) >= 3, "foco visible en la fila");
      assert.deepEqual(page.errors, []); await page.close();
      for (const id of ["p-1", "p-6", "p-7"]) {
        page = await open(`/productos/${id}`, { width, theme });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${id} sin scroll horizontal`);
        const geometry = await page.evaluate(() => ({ vw: innerWidth, items: [...document.querySelectorAll(".product-page .catalog-stock-summary > div, .product-page .catalog-locations, .product-page .catalog-location-list li, .product-page .catalog-secondary, .product-page .catalog-heading-row .catalog-button")].map(element => { const r = element.getBoundingClientRect(); return { cls: element.className.split(" ")[0] || element.tagName, left: r.left, right: r.right, h: Math.round(r.height), clipped: element.scrollWidth > element.clientWidth + 1 }; }),
          codes: [...document.querySelectorAll(".catalog-location-code")].map(code => ({ text: code.textContent.trim(), fits: code.scrollWidth <= code.clientWidth + 1, ellipsis: getComputedStyle(code).textOverflow === "ellipsis" })) }));
        for (const item of geometry.items) assert.ok(item.left >= -0.5 && item.right <= geometry.vw + 0.5 && !item.clipped, `${id} ${item.cls} ${JSON.stringify(item)}`);
        for (const code of geometry.codes) assert.ok(code.fits && !code.ellipsis, `código ${code.text} completo`);
        if (id === "p-6") assert.ok(geometry.codes.some(code => code.text === W24), "24 caracteres sin separadores, íntegro");
        const lines = await page.locator(".catalog-stock-summary strong").evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().height / parseFloat(getComputedStyle(item).lineHeight))));
        assert.ok(lines.every(count => count <= 2), `cifras del resumen sin partir palabras: ${lines}`);
        const summarySize = await page.locator(".catalog-secondary summary").evaluate(summary => summary.getBoundingClientRect().height); assert.ok(summarySize >= 48);
        const editSize = await page.locator(".catalog-heading-row .catalog-button").evaluate(link => link.getBoundingClientRect().height); assert.ok(editSize >= 44);
        const actions = await page.locator(".stock-action-trigger").evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().height))); assert.ok(actions.every(height => height >= 44), JSON.stringify(actions));
        for (const selector of [".product-page h1", ".product-page .page-description", ".catalog-stock-summary span", ".catalog-stock-summary strong", ".catalog-section-heading h2", ".catalog-location-code", ".catalog-location-list li strong", ".catalog-secondary summary", ".catalog-heading-row .catalog-button"])
          for (const sample of await paints(page, selector)) assert.ok(ratio(sample.fg, sample.bg) >= 4.5, `${id} ${selector} «${sample.text}» ${ratio(sample.fg, sample.bg).toFixed(2)}`);
        if (id === "p-1" && [320, 390, 768, 1280].includes(width)) await page.screenshot({ path: path.join(directory, `ficha-${width}-${theme}.png`), fullPage: true });
        await page.locator(".catalog-secondary summary").focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
        const focus = (await paints(page, ":focus-visible", true))[0]; assert.ok(focus.outlineStyle === "solid" && focus.outlineWidth >= 3 && ratio(focus.ring, focus.bg) >= 3, "foco visible en el resumen");
        assert.deepEqual(page.errors, []); await page.close();
      }
    });
  }

  await t.test("movimiento reducido: sin transiciones en filas; transición discreta normal", async () => {
    let page = await open("/productos", { width: 1280 });
    assert.ok(await page.locator(".catalog-card").first().evaluate(row => parseFloat(getComputedStyle(row).transitionDuration) > 0.1)); await page.close();
    page = await open("/productos", { width: 1280, reducedMotion: "reduce" });
    assert.ok(await page.locator(".catalog-card").evaluateAll(rows => rows.every(row => getComputedStyle(row).transitionDuration.split(",").every(value => parseFloat(value) <= 0.001)))); await page.close();
  });

  // ── Medidas antes/después (informativas; PRODUCT_MEASURE=1 para ejecutarlas, son lentas) ──
  await t.test("medidas antes/después", { skip: process.env.PRODUCT_MEASURE !== "1" }, async () => {
    const catalog = async (rev, set) => { const page = await open("/productos", { set, rev });
      const m = await page.evaluate(() => { const cards = [...document.querySelectorAll(".catalog-card")]; return { documentHeight: document.documentElement.scrollHeight, rowHeight: Math.round(cards.reduce((sum, card) => sum + card.getBoundingClientRect().height, 0) / cards.length) }; });
      await page.close(); return m; };
    const detail = async rev => { const page = await open("/productos/p-1", { rev });
      const m = await page.evaluate(() => { const top = selector => Math.round(document.querySelector(selector).getBoundingClientRect().top + scrollY), bottom = selector => Math.round(document.querySelector(selector).getBoundingClientRect().bottom + scrollY);
        return { stockTop: top(".catalog-stock-summary"), stockBottom: bottom(".catalog-stock-summary"), firstTop: top(".catalog-location-list li"), firstBottom: bottom(".catalog-location-list li"), documentHeight: document.documentElement.scrollHeight }; });
      await page.close(); return m; };
    const pct = (a, b) => `${(((b - a) / a) * 100).toFixed(1)} %`;
    for (const set of ["nine", "sixty"]) { const before = await catalog("before", set), after = await catalog("after", set);
      t.diagnostic(`catálogo ${set}: ${before.documentHeight}→${after.documentHeight} px (${after.documentHeight - before.documentHeight}; ${pct(before.documentHeight, after.documentHeight)}) · fila media ${before.rowHeight}→${after.rowHeight} px`); }
    const b = await detail("before"), a = await detail("after");
    t.diagnostic(`ficha 390×844: stock total ${b.stockTop}–${b.stockBottom}→${a.stockTop}–${a.stockBottom}; primera ubicación ${b.firstTop}–${b.firstBottom}→${a.firstTop}–${a.firstBottom}; documento ${b.documentHeight}→${a.documentHeight} (${pct(b.documentHeight, a.documentHeight)})`);
  });
});
