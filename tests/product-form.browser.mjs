// UI05b-1/UI05b-2: formularios de producto (crear, editar y modo quick de Carga rápida). Componente ProductForm y
// páginas reales (nuevo / editar) con AppShell; el cliente de Supabase es un doble en memoria que registra cada
// llamada (productos, categorias y storage) y puede fallar a demanda. Sin Supabase, sin JWT, sin red externa.
// Aditivo e independiente de B4: invariantes funcionales y geométricas, sin snapshots ni baselines.
// Node >=22; esbuild 0.28.2 y playwright 1.64.0 externos (npm install --prefix <tools> ...).
// FORM_TEST_TOOLS=<tools> (o SHELVES_TEST_TOOLS); FORM_ARTIFACTS=<ruta externa opcional para capturas>.
// node --test tests/product-form.browser.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireTools = createRequire(path.join(process.env.FORM_TEST_TOOLS ?? process.env.SHELVES_TEST_TOOLS ?? root, "package.json"));
const { build } = requireTools("esbuild");
const { chromium } = requireTools("playwright");
const cssFiles = ["app/globals.css", "components/tower-view.css", "app/theme.css", "app/catalog.css", "app/stock.css", "app/rapid.css", "app/exports.css", "app/shelves.css"];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const CATEGORIES = [{ id: "cat-1", nombre: "Electrónica" }, { id: "cat-2", nombre: "Sensores técnicos" }, { id: "cat-3", nombre: "Repuestos" }];
const PRODUCT = { id: "p-1", nombre: "Módulo térmico", categoria_id: "cat-1", categoria: "Electrónica", descripcion: "Módulo de control y protección térmica.", foto_ruta: "p-1/anterior.png",
  fotoUrl: "/img/ok.svg", actualizado_en: "2026-10-19T12:00:00.000Z", stock: 26, ubicaciones: 6 };

const fixture = `
  import { Fragment, createElement, useEffect, useState, isValidElement, cloneElement } from 'react';
  import { createRoot } from 'react-dom/client';
  import { AppShell } from './components/app-shell';
  import { ProductForm } from './components/product-form';
  import NewProductPage from './app/(workspace)/productos/nuevo/page';
  import EditProductPage from './app/(workspace)/productos/[id]/editar/page';
  const isAsync = type => typeof type === 'function' && type.constructor.name === 'AsyncFunction';
  async function realize(element) {
    if (Array.isArray(element)) return Promise.all(element.map(realize));
    if (!isValidElement(element)) return element;
    if (isAsync(element.type)) return realize(await element.type(element.props));
    if (element.props.children !== undefined) { const children = await realize(element.props.children); return Array.isArray(children) ? cloneElement(element, undefined, ...children) : cloneElement(element, undefined, children); }
    return element;
  }
  function QuickProbe() {
    return <div className="page-stack">
      <h1>Carga rápida (sonda)</h1>
      <ProductForm quick initialCategories={window.__categories} onCreated={product => { window.__created = product; }} onCancel={() => { window.__cancelled = (window.__cancelled || 0) + 1; }} />
    </div>;
  }
  function Current() {
    const [node, setNode] = useState(null);
    useEffect(() => {
      const route = location.pathname;
      if (route === '/quick') { setNode(<QuickProbe />); return; }
      const page = route.endsWith('/editar') ? EditProductPage({ params: Promise.resolve({ id: 'p-1' }) }) : NewProductPage();
      realize(page).then(setNode);
    }, []);
    return node ? (Array.isArray(node) ? createElement(Fragment, null, ...node) : node) : null;
  }
  createRoot(document.getElementById('root')).render(<AppShell><div data-ready><Current /></div></AppShell>);
`;
const fakes = {
  "next/link": `import {createElement} from 'react'; export default function Link({href,children,replace,prefetch,scroll,...props}){
    return createElement('a',{...props,href,onClick:event=>{event.preventDefault();window.__navigated=href}},children)}`,
  "next/navigation": `export function usePathname(){return location.pathname}
    export function useRouter(){return {replace(){},push(url){window.__pushed=url},refresh(){window.__refreshed=(window.__refreshed||0)+1}}}
    export function notFound(){throw new Error('NEXT_NOT_FOUND')}`,
  catalog: `export async function getCategories(){return window.__categories}
    export async function getProduct(){const product=${JSON.stringify(PRODUCT)};if(window.__mode.photo==='nourl')product.fotoUrl=null;if(window.__mode.photo==='bad')product.fotoUrl='/img/missing.png';return {product,locations:[]}}`,
  supabase: `const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    function builder(table) {
      const s = { table, op: 'select', filters: [] };
      const api = {
        select() { return api; }, insert(values) { s.op = 'insert'; s.values = values; return api; }, update(values) { s.op = 'update'; s.values = values; return api; },
        eq(key, value) { s.filters.push([key, value]); return api; }, order() { return api; }, range(from) { s.from = from; return api; },
        single() { return api; }, maybeSingle() { return api; },
        then(resolve, reject) { return run(s).then(resolve, reject); },
      };
      return api;
    }
    async function run(s) {
      const mode = window.__mode;
      window.__calls.push({ kind: 'db', table: s.table, op: s.op, values: s.values ?? null, filters: s.filters });
      if (mode.delay) await wait(mode.delay);
      if (s.table === 'categorias') {
        if (s.op === 'insert') return mode.category === 'duplicate' ? { data: null, error: { code: '23505' } } : mode.category === 'error' ? { data: null, error: { code: '500' } } : { data: { id: 'cat-new', nombre: s.values.nombre }, error: null };
        return { data: window.__categories, error: null };
      }
      if (s.op === 'select') return { data: s.from > 0 ? [] : window.__existing, error: mode.list ? { code: '500' } : null };
      if (s.op === 'insert') return { data: null, error: mode.insert ? { code: '500' } : null };
      if (mode.update === 'error') return { data: null, error: { code: '500' } };
      return mode.update === 'conflict' ? { data: null, error: null } : { data: { id: s.filters[0][1] }, error: null };
    }
    export function createSupabaseClient() {
      return { from: builder, storage: { from(bucket) { return {
        async upload(path, file, options) { window.__calls.push({ kind: 'upload', bucket, path, type: file.type, options }); if (window.__mode.delay) await wait(window.__mode.delay); return window.__mode.upload === 'error' ? { error: { message: 'fail' } } : { error: null }; },
        async remove(paths) { window.__calls.push({ kind: 'remove', bucket, paths }); return window.__mode.remove === 'error' ? { error: { message: 'fail' } } : { error: null }; },
      }; } } };
    }`,
};
async function bundle() {
  const result = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: fixture }, bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "offline", setup(b) {
      b.onResolve({ filter: /^(next\/link|next\/navigation|@\/lib\/supabase\/client|@\/lib\/product-catalog|@\/lib\/stock-data|@\/app\/\(workspace\)\/(stock-actions|box-code-actions))$/ }, args => ({ path: args.path, namespace: "fake" }));
      b.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ resolveDir: root, contents: fakes[args.path === "next/link" ? "next/link" : args.path === "next/navigation" ? "next/navigation"
        : args.path.endsWith("/supabase/client") ? "supabase" : "catalog"] }));
    } }],
  });
  return result.outputFiles[0].text;
}

const lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const text = async locator => (await locator.innerText()).replace(/\s+/g, " ").trim();

test("UI05b-1: formularios de producto (crear, editar y quick)", async t => {
  const directory = process.env.FORM_ARTIFACTS ?? await mkdtemp(path.join(tmpdir(), "ingeagro-ui05b1-"));
  await mkdir(directory, { recursive: true });
  t.diagnostic(`Capturas sintéticas: ${directory}`);
  const script = await bundle();
  const css = (await Promise.all(cssFiles.map(file => readFile(path.join(root, file), "utf8")))).join("\n").replace('@import "tailwindcss";', "");
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.test");
    if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); response.end(script); }
    else if (url.pathname.startsWith("/img/") && url.pathname !== "/img/ok.svg") { response.statusCode = 404; response.end("missing"); }
    else if (url.pathname === "/img/ok.svg") { response.setHeader("Content-Type", "image/svg+xml"); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#7aa89b"/><circle cx="80" cy="60" r="30" fill="#fff"/></svg>'); }
    else { response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>window.__calls=[];window.__mode=Object.assign({},(window.__init||{}).mode);window.__existing=(window.__init||{}).existing||[];window.__categories=${JSON.stringify(CATEGORIES)};</script><script src="/fixture.js"></script></html>`); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(); t.after(() => browser.close());

  async function open(route, { width = 390, height = 844, theme = "light", mode = {}, existing = [], reducedMotion } = {}) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 800, reducedMotion });
    page.setDefaultTimeout(8000); page.errors = [];
    page.on("pageerror", error => page.errors.push(error.message));
    await page.route("**/*", request => request.request().url().startsWith(url) ? request.continue() : request.abort());
    await page.addInitScript(([theme, mode, existing]) => {
      addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.theme = theme; }, { once: true });
      window.__init = { mode, existing };
    }, [theme, mode, existing]);
    await page.goto(url + route);
    await page.locator("[data-ready] form.catalog-form").waitFor();
    await page.waitForTimeout(250);
    return page;
  }
  const calls = page => page.evaluate(() => window.__calls);
  const writes = list => list.filter(call => (call.kind === "db" && call.op !== "select") || call.kind === "upload" || call.kind === "remove");
  const fillValid = async (page, name = "Sensor de proximidad M18") => { await page.locator("#product-name").fill(name); await page.locator("#product-category").selectOption("cat-2"); };

  // ── Crear (formulario completo) ──
  await t.test("crear: estructura, textos, obligatorios/opcionales y ausencia del panel decorativo", async () => {
    const page = await open("/productos/nuevo");
    assert.equal(await text(page.locator("h1")), "Crear producto");
    assert.equal(await text(page.locator(".eyebrow").first()), "CATÁLOGO / NUEVO");
    assert.match(await text(page.locator(".catalog-form-note")), /descripción y la foto se pueden completar después.*«Agregar stock»/);
    assert.equal(await page.locator(".catalog-form-section").first().locator("> p").count(), 1, "un solo párrafo de ayuda");
    assert.equal(await page.locator(".catalog-form-aside, .catalog-aside-icon").count(), 0);
    assert.deepEqual(await page.locator("form.catalog-form .catalog-form-section > h2").allTextContents(), ["Datos del producto", "Descripción", "Fotografía"]);
    assert.equal(await page.locator("form.catalog-form details").count(), 0, "la fotografía ya no está escondida en «Más detalles»");
    assert.equal(await page.locator("form.catalog-form").evaluate(form => form.classList.contains("catalog-form-split")), true);
    assert.equal(await text(page.locator('label[for="product-name"] > span')), "Nombre Obligatorio");
    assert.equal(await text(page.locator('label[for="product-category"] > span')), "Categoría Obligatorio");
    assert.equal(await text(page.locator('label[for="product-description"] > span')), "Descripción Opcional");
    assert.equal(await page.locator("#product-name").getAttribute("required"), "");
    assert.equal(await text(page.locator("form.catalog-form button[type=submit].primary")), "Crear producto");
    const cancel = page.locator(".catalog-form-actions a"); assert.equal(await text(cancel), "Cancelar"); assert.equal(await cancel.getAttribute("href"), "/productos");
    assert.match(await text(page.locator(".catalog-photo-controls")), /Añadir foto La fotografía es opcional\./);
    assert.equal(await page.locator("#product-photo").getAttribute("accept"), "image/jpeg,image/png,image/webp");
    assert.deepEqual(writes(await calls(page)), []); assert.deepEqual(page.errors, []); await page.close();
  });

  await t.test("crear: valores enviados, sin foto y con foto (orden subir → guardar)", async () => {
    let page = await open("/productos/nuevo");
    await fillValid(page); await page.locator("#product-description").fill("Detecta presencia a 8 mm.");
    await page.locator("form.catalog-form button[type=submit]").click();
    await page.waitForFunction(() => window.__pushed);
    let list = await calls(page); const insert = list.find(call => call.kind === "db" && call.op === "insert" && call.table === "productos");
    assert.deepEqual([insert.values.nombre, insert.values.categoria_id, insert.values.descripcion, insert.values.foto_ruta], ["Sensor de proximidad M18", "cat-2", "Detecta presencia a 8 mm.", null]);
    assert.match(insert.values.id, /^[0-9a-f-]{36}$/);
    assert.equal(await page.evaluate(() => window.__pushed), `/productos/${insert.values.id}?guardado=1`);
    assert.equal(list.some(call => call.kind === "upload"), false); await page.close();
    // Con foto.
    page = await open("/productos/nuevo"); await fillValid(page);
    await page.locator("#product-photo").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG });
    assert.equal(await page.locator(".catalog-photo-preview img").getAttribute("alt"), "Vista previa del producto");
    assert.equal(await text(page.locator(".catalog-file-button")), "Reemplazar foto");
    await page.locator("form.catalog-form button[type=submit]").click(); await page.waitForFunction(() => window.__pushed);
    list = await calls(page); const sequence = list.filter(call => call.kind === "upload" || (call.kind === "db" && call.op === "insert")).map(call => call.kind === "upload" ? "upload" : "insert");
    assert.deepEqual(sequence, ["upload", "insert"]);
    const upload = list.find(call => call.kind === "upload"); const photoInsert = list.find(call => call.kind === "db" && call.op === "insert");
    assert.equal(upload.bucket, "product-images"); assert.equal(upload.options.upsert, false); assert.match(upload.path, new RegExp(`^${photoInsert.values.id}/[0-9a-f-]{36}\\.png$`));
    assert.equal(photoInsert.values.foto_ruta, upload.path);
    assert.deepEqual(page.errors, []); await page.close();
  });

  await t.test("crear: validaciones existentes y cancelación no escriben nada", async () => {
    const page = await open("/productos/nuevo"); const submit = page.locator("form.catalog-form button[type=submit]");
    await submit.click(); assert.equal(await text(page.getByRole("alert")), "Escribe un nombre para el producto.");
    await page.locator("#product-name").fill("---"); await submit.click(); assert.equal(await text(page.getByRole("alert")), "El nombre debe incluir al menos una letra o un número.");
    await page.locator("#product-name").fill("Producto válido"); await submit.click(); assert.equal(await text(page.getByRole("alert")), "Selecciona una categoría válida.");
    await page.locator("#product-category").selectOption("cat-1");
    assert.equal(await page.locator("#product-description").getAttribute("maxlength"), "2000", "el tope de 2000 caracteres lo aplica el propio campo");
    await page.locator("#product-photo").setInputFiles({ name: "malo.gif", mimeType: "image/gif", buffer: PNG });
    assert.equal(await text(page.getByRole("alert")), "Elige una imagen JPG, PNG o WebP.");
    assert.deepEqual(await calls(page), [], "ninguna llamada (ni lecturas) ante entradas inválidas");
    assert.equal(await page.locator("#product-name").inputValue(), "Producto válido");
    await page.close();
  });

  await t.test("crear: productos parecidos, categoría nueva, error de servidor y doble envío", async () => {
    let page = await open("/productos/nuevo", { existing: [{ id: "x-9", nombre: "Sensor de proximidad M12", nombre_normalizado: "sensor de proximidad m12", categorias: { nombre: "Sensores técnicos" } }] });
    await fillValid(page, "Sensor de proximidad M12"); await page.locator("form.catalog-form button[type=submit]").click();
    await page.locator(".similar-warning").waitFor();
    assert.match(await text(page.locator(".similar-warning")), /Encontramos productos parecidos.*Sensor de proximidad M12.*Usar este producto.*Crear de todos modos/);
    assert.equal(writes(await calls(page)).length, 0);
    await page.getByRole("button", { name: "Usar este producto" }).click();
    assert.equal(await page.evaluate(() => window.__pushed), "/productos/x-9"); await page.close();
    page = await open("/productos/nuevo", { existing: [{ id: "x-9", nombre: "Sensor de proximidad M12", nombre_normalizado: "sensor de proximidad m12", categorias: { nombre: "Sensores técnicos" } }] });
    await fillValid(page, "Sensor de proximidad M12"); await page.locator("form.catalog-form button[type=submit]").click();
    await page.getByRole("button", { name: "Crear de todos modos" }).click(); await page.waitForFunction(() => window.__pushed);
    assert.equal(writes(await calls(page)).filter(call => call.op === "insert").length, 1); await page.close();
    // Categoría nueva y duplicada.
    page = await open("/productos/nuevo"); await page.locator("#product-category").selectOption("__new__");
    await page.locator("#category-name").fill("Cables"); await page.getByRole("button", { name: "Crear categoría" }).click();
    await page.getByText("Categoría creada y seleccionada.").waitFor();
    assert.equal(await page.locator("#product-category").inputValue(), "cat-new"); await page.close();
    page = await open("/productos/nuevo", { mode: { category: "duplicate" } }); await page.locator("#product-category").selectOption("__new__");
    await page.locator("#category-name").fill("repuestos"); await page.getByRole("button", { name: "Crear categoría" }).click();
    await page.getByText("La categoría ya existía y quedó seleccionada.").waitFor();
    assert.equal(await page.locator("#product-category").inputValue(), "cat-3"); await page.close();
    // Error de servidor: los datos y la foto elegida se conservan, y se limpia el archivo subido.
    page = await open("/productos/nuevo", { mode: { insert: "error" } }); await fillValid(page);
    await page.locator("#product-photo").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG });
    await page.locator("form.catalog-form button[type=submit]").click();
    await page.getByRole("alert").filter({ hasText: "No pudimos guardar el producto." }).waitFor();
    assert.equal(await page.locator("#product-name").inputValue(), "Sensor de proximidad M18");
    assert.equal(await page.locator(".catalog-photo-preview img").count(), 1);
    const failed = await calls(page); assert.deepEqual(failed.filter(call => call.kind === "remove").map(call => call.paths[0]), [failed.find(call => call.kind === "upload").path]);
    assert.equal(await page.evaluate(() => window.__pushed ?? null), null); await page.close();
    // Doble envío con guardado pendiente.
    page = await open("/productos/nuevo", { mode: { delay: 400 } }); await fillValid(page);
    await page.locator("form.catalog-form").evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    await page.waitForFunction(() => document.querySelector("form.catalog-form button[type=submit]")?.disabled);
    await page.waitForFunction(() => /Guardando producto…/.test(document.querySelector("form.catalog-form button[type=submit]")?.textContent ?? ""));
    await page.waitForFunction(() => window.__pushed);
    assert.equal(writes(await calls(page)).filter(call => call.op === "insert").length, 1); await page.close();
  });

  // ── Editar ──
  await t.test("editar: estructura, textos, valores prellenados y envío con control optimista", async () => {
    let page = await open("/productos/p-1/editar");
    assert.equal(await text(page.locator("h1")), "Editar producto"); assert.equal(await text(page.locator(".eyebrow").first()), "CATÁLOGO / EDITAR");
    assert.match(await text(page.locator(".catalog-form-note")), /Aquí editas los datos del producto; para cambiar sus existencias.*«Agregar stock»/);
    assert.equal(await text(page.locator("form.catalog-form button[type=submit].primary")), "Guardar cambios");
    assert.equal(await page.locator("#product-name").inputValue(), "Módulo térmico"); assert.equal(await page.locator("#product-category").inputValue(), "cat-1");
    assert.equal(await page.locator("#product-description").inputValue(), "Módulo de control y protección térmica.");
    assert.equal(await text(page.locator(".catalog-file-button")), "Reemplazar foto"); assert.equal(await page.locator(".catalog-photo-preview img").count(), 1);
    assert.equal(await page.getByRole("button", { name: "Quitar foto" }).count(), 1);
    assert.equal(await page.locator(".catalog-form-actions a").getAttribute("href"), "/productos/p-1");
    await page.locator("#product-name").fill("Módulo térmico v2"); await page.locator("form.catalog-form button[type=submit]").click();
    await page.waitForFunction(() => window.__pushed);
    const update = (await calls(page)).find(call => call.kind === "db" && call.op === "update");
    assert.deepEqual([update.values.nombre, update.values.foto_ruta], ["Módulo térmico v2", "p-1/anterior.png"]);
    assert.deepEqual(update.filters, [["id", "p-1"], ["actualizado_en", "2026-10-19T12:00:00.000Z"]]);
    assert.equal(await page.evaluate(() => window.__pushed), "/productos/p-1?guardado=1");
    assert.equal((await calls(page)).some(call => call.kind === "upload" || call.kind === "remove"), false); await page.close();
    // Reemplazo de foto: sube la nueva, actualiza y elimina la anterior.
    page = await open("/productos/p-1/editar");
    await page.locator("#product-photo").setInputFiles({ name: "nueva.png", mimeType: "image/png", buffer: PNG });
    await page.locator("form.catalog-form button[type=submit]").click(); await page.waitForFunction(() => window.__pushed);
    const list = await calls(page); assert.deepEqual(list.filter(call => call.kind === "upload" || call.kind === "remove" || call.op === "update").map(call => call.kind === "db" ? "update" : call.kind), ["upload", "update", "remove"]);
    assert.deepEqual(list.find(call => call.kind === "remove").paths, ["p-1/anterior.png"]); await page.close();
    // Quitar foto: se aplica al guardar.
    page = await open("/productos/p-1/editar"); await page.getByRole("button", { name: "Quitar foto" }).click();
    assert.equal(await page.locator(".catalog-photo-preview img").count(), 0); assert.equal(await text(page.locator(".catalog-file-button")), "Añadir foto");
    assert.deepEqual(writes(await calls(page)), [], "quitar no escribe hasta guardar");
    await page.locator("form.catalog-form button[type=submit]").click(); await page.waitForFunction(() => window.__pushed);
    const removal = await calls(page); assert.equal(removal.find(call => call.op === "update").values.foto_ruta, null); assert.deepEqual(removal.find(call => call.kind === "remove").paths, ["p-1/anterior.png"]); await page.close();
    // Conflicto y error de servidor: los cambios se conservan y se limpia lo subido.
    for (const [mode, message] of [["conflict", "El producto cambió en otra sesión. Recarga la página antes de editarlo."], ["error", "No pudimos guardar los cambios. Inténtalo de nuevo."]]) {
      page = await open("/productos/p-1/editar", { mode: { update: mode } });
      await page.locator("#product-name").fill("Cambio no guardado");
      await page.locator("#product-photo").setInputFiles({ name: "nueva.png", mimeType: "image/png", buffer: PNG });
      await page.locator("form.catalog-form button[type=submit]").click(); await page.getByRole("alert").filter({ hasText: message }).waitFor();
      assert.equal(await page.locator("#product-name").inputValue(), "Cambio no guardado");
      const done = await calls(page); assert.deepEqual(done.filter(call => call.kind === "remove").map(call => call.paths[0]), [done.find(call => call.kind === "upload").path]);
      assert.equal(await page.evaluate(() => window.__pushed ?? null), null); await page.close();
    }
  });

  // ── Modo quick (Carga rápida) ──
  await t.test("quick: conserva <details>, asteriscos, etiquetas, onCreated y onCancel", async () => {
    let page = await open("/quick");
    assert.equal(await page.locator("form.catalog-form").evaluate(form => form.classList.contains("catalog-form-split")), false);
    assert.equal(await page.locator(".catalog-form-note").count(), 0); assert.equal(await page.locator(".catalog-form-aside").count(), 0);
    const details = page.locator("form.catalog-form details.quick-more-details.compact");
    assert.equal(await details.count(), 1); assert.equal(await details.evaluate(element => element.open), false);
    assert.equal(await text(details.locator("summary")), "Más detalles (opcional)");
    assert.equal(await details.locator("#product-description, #product-photo").count(), 2, "descripción y foto dentro del <details>");
    assert.equal(await text(page.locator('label[for="product-name"] > span')), "Nombre *"); assert.equal(await text(page.locator('label[for="product-category"] > span')), "Categoría *");
    assert.equal(await page.locator(".catalog-form-section > h2").allTextContents().then(items => items.join("|")), "Datos del producto|Fotografía");
    assert.equal(await text(page.locator("form.catalog-form button[type=submit]")), "Agregar producto", "etiqueta funcional del modo quick sin cambios");
    await fillValid(page, "Producto rápido"); await page.locator("form.catalog-form button[type=submit]").click();
    await page.waitForFunction(() => window.__created);
    const created = await page.evaluate(() => window.__created); assert.deepEqual([created.nombre, created.categoria], ["Producto rápido", "Sensores técnicos"]); assert.match(created.id, /^[0-9a-f-]{36}$/);
    assert.equal(await page.evaluate(() => window.__pushed ?? null), null, "quick no navega"); await page.close();
    page = await open("/quick"); await page.getByRole("button", { name: "Cancelar" }).click();
    assert.equal(await page.evaluate(() => window.__cancelled), 1); assert.deepEqual(writes(await calls(page)), []);
    await page.locator("form.catalog-form summary").click(); assert.equal(await page.locator("#product-photo").count(), 1);
    assert.deepEqual(page.errors, []); await page.close();
  });

  // ── UI05b-2: errores asociados a cada campo ──
  const outline = (page, selector) => page.locator(selector).evaluate(element => { const style = getComputedStyle(element); return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }; });
  await t.test("errores de validación: texto exacto, asociado al campo, aria y foco; valores conservados; sin escrituras", async () => {
    const page = await open("/productos/nuevo"); const submit = page.locator("form.catalog-form button[type=submit]");
    const expectError = async (field, id, message) => {
      assert.equal(await text(page.locator("#" + id + "-error")), message, id);
      assert.equal(await page.locator("#" + id).getAttribute("aria-invalid"), "true");
      assert.equal(await page.locator("#" + id).getAttribute("aria-describedby"), id + "-error");
      await page.waitForFunction(expected => document.activeElement?.id === expected, id); // el foco va al campo inválido (tras la nueva renderización del input de archivo)
      assert.equal(await page.getByRole("alert").count(), 1, "una sola alerta (la del campo)");
      assert.equal(await page.locator(".catalog-form-split > .catalog-message.error").count(), 0);
      const ring = await outline(page, field === "foto" ? ".catalog-file-button" : "#" + id); assert.ok(ring.style === "solid" && ring.width >= 3, `foco visible en #${id}: ${JSON.stringify(ring)}`); // el <input type=file> es invisible: el anillo va en su botón
    };
    await page.locator("#product-category").selectOption("cat-2"); await submit.click();
    await expectError("nombre", "product-name", "Escribe un nombre para el producto.");
    assert.equal(await page.locator("#product-category").inputValue(), "cat-2", "los valores se conservan");
    await page.locator("#product-name").fill("---"); await submit.click();
    await expectError("nombre", "product-name", "El nombre debe incluir al menos una letra o un número.");
    await page.locator("#product-name").fill("Producto válido"); await page.locator("#product-category").selectOption(""); await submit.click();
    await expectError("categoria", "product-category", "Selecciona una categoría válida.");
    assert.equal(await page.locator("#product-name").inputValue(), "Producto válido");
    assert.equal(await page.locator("#product-name").getAttribute("aria-invalid"), null, "los demás campos no quedan marcados");
    // Varios errores a la vez: se informa el primero (el mismo de validateProduct) y el foco va a él.
    await page.locator("#product-name").fill(""); await submit.click();
    await expectError("nombre", "product-name", "Escribe un nombre para el producto.");
    // Archivo inválido: mensaje junto a la fotografía, foco en el control de archivo.
    await page.locator("#product-name").fill("Producto válido"); await page.locator("#product-category").selectOption("cat-1");
    await page.locator("#product-photo").setInputFiles({ name: "malo.gif", mimeType: "image/gif", buffer: PNG });
    await expectError("foto", "product-photo", "Elige una imagen JPG, PNG o WebP.");
    assert.equal(await page.locator("#product-name").getAttribute("aria-invalid"), null);
    assert.deepEqual(await calls(page), [], "ninguna llamada con datos inválidos");
    // Corregido, guarda y se limpian las marcas.
    await page.locator("form.catalog-form button[type=submit]").click().catch(() => {}); await page.waitForFunction(() => window.__pushed);
    assert.equal(writes(await calls(page)).filter(call => call.op === "insert").length, 1);
    assert.deepEqual(page.errors, []); await page.close();
  });

  await t.test("quick: el error de nombre se asocia al campo; el de la foto (en <details> cerrado) queda en el área general", async () => {
    const page = await open("/quick");
    await page.locator("form.catalog-form button[type=submit]").click();
    assert.equal(await text(page.locator("#product-name-error")), "Escribe un nombre para el producto.");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "product-name");
    await fillValid(page, "Producto rápido");
    await page.locator("#product-photo").setInputFiles({ name: "malo.gif", mimeType: "image/gif", buffer: PNG });
    assert.equal(await page.locator("#product-photo-error").count(), 0, "sin error inline para un campo oculto");
    assert.equal(await text(page.locator("form.catalog-form > .catalog-message.error")), "Elige una imagen JPG, PNG o WebP.");
    assert.equal(await page.locator("form.catalog-form details").evaluate(element => element.open), false, "el <details> no se abre solo");
    assert.deepEqual(writes(await calls(page)), []); await page.close();
  });

  // ── UI05b-2: estado de guardado accesible ──
  await t.test("estado de guardado: región role=status con la etapa actual; sin porcentajes", async () => {
    const page = await open("/productos/nuevo", { mode: { delay: 500 } }); await fillValid(page);
    await page.locator("#product-photo").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG });
    const status = page.locator("p.catalog-save-status[role=status]");
    assert.equal(await status.count(), 1); assert.equal(await status.getAttribute("aria-live"), "polite"); assert.equal(await status.isVisible(), false, "vacía y oculta en reposo");
    await page.locator("form.catalog-form button[type=submit]").click();
    const seen = [];
    let buttonDuring = "";
    for (let i = 0; i < 40; i++) { const value = (await status.innerText().catch(() => "")).trim(); if (value && !seen.includes(value)) seen.push(value); if (value === "Guardando producto…") buttonDuring = (await page.locator("form.catalog-form button[type=submit]").innerText()).trim(); if (await page.evaluate(() => window.__pushed ?? null)) break; await page.waitForTimeout(100); }
    assert.ok(seen.includes("Comprobando productos parecidos…") && seen.includes("Subiendo fotografía…") && seen.includes("Guardando producto…"), JSON.stringify(seen));
    assert.ok(seen.every(value => !/%/.test(value)), "sin porcentajes inventados");
    assert.equal(buttonDuring, "Guardando producto…", "el botón conserva su texto de etapa");
    await page.waitForFunction(() => window.__pushed); assert.deepEqual(page.errors, []); await page.close();
  });

  // ── UI05b-2: fotografía ──
  await t.test("fotografía guardada sin vista previa: aviso, conservación al guardar y quitar/deshacer sin llamadas", async () => {
    let page = await open("/productos/p-1/editar", { mode: { photo: "nourl" } });
    assert.equal(await page.locator(".catalog-photo-preview img").count(), 0);
    assert.equal(await text(page.locator(".catalog-photo-note")), "Fotografía guardada. Vista previa no disponible");
    assert.equal(await text(page.locator(".catalog-file-button")), "Reemplazar foto");
    await page.getByRole("button", { name: "Quitar foto" }).click();
    assert.equal(await text(page.locator(".catalog-photo-note")), "La fotografía se eliminará cuando guardes. Deshacer");
    assert.equal(await page.locator(".catalog-photo-note").getAttribute("role"), "status");
    await page.waitForFunction(() => document.activeElement?.id === "product-photo-undo");
    await page.getByRole("button", { name: "Deshacer" }).click();
    assert.equal(await text(page.locator(".catalog-photo-note")), "Fotografía guardada. Vista previa no disponible");
    await page.waitForFunction(() => document.activeElement?.id === "product-photo-remove");
    assert.deepEqual(await calls(page), [], "quitar y deshacer no llaman al servidor");
    await page.locator("form.catalog-form button[type=submit]").click(); await page.waitForFunction(() => window.__pushed);
    const list = await calls(page); assert.equal(list.find(call => call.op === "update").values.foto_ruta, "p-1/anterior.png");
    assert.equal(list.some(call => call.kind === "upload" || call.kind === "remove"), false, "conserva la foto: sin subir ni borrar"); await page.close();
    // Quitar sin vista previa disponible y confirmar al guardar.
    page = await open("/productos/p-1/editar", { mode: { photo: "nourl" } }); await page.getByRole("button", { name: "Quitar foto" }).click();
    await page.locator("form.catalog-form button[type=submit]").click(); await page.waitForFunction(() => window.__pushed);
    const removal = await calls(page); assert.equal(removal.find(call => call.op === "update").values.foto_ruta, null); assert.deepEqual(removal.find(call => call.kind === "remove").paths, ["p-1/anterior.png"]); await page.close();
  });

  await t.test("fotografía con vista previa: quitar → aviso + deshacer restaura sin llamadas; quitar + guardar elimina", async () => {
    let page = await open("/productos/p-1/editar");
    await page.getByRole("button", { name: "Quitar foto" }).click();
    assert.equal(await page.locator(".catalog-photo-preview img").count(), 0); assert.match(await text(page.locator(".catalog-photo-note")), /^La fotografía se eliminará cuando guardes\./);
    assert.equal(await text(page.locator(".catalog-file-button")), "Añadir foto");
    await page.getByRole("button", { name: "Deshacer" }).click();
    assert.equal(await page.locator(".catalog-photo-preview img").count(), 1); assert.equal(await page.locator(".catalog-photo-note").count(), 0);
    assert.equal(await text(page.locator(".catalog-file-button")), "Reemplazar foto"); assert.deepEqual(await calls(page), []);
    await page.locator("form.catalog-form button[type=submit]").click(); await page.waitForFunction(() => window.__pushed);
    const kept = await calls(page); assert.equal(kept.find(call => call.op === "update").values.foto_ruta, "p-1/anterior.png"); assert.equal(kept.some(call => call.kind === "remove"), false); await page.close();
    // Crear: «Quitar foto» de una foto recién elegida no muestra el aviso de eliminación (no hay foto guardada).
    page = await open("/productos/nuevo"); await page.locator("#product-photo").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Quitar foto" }).click(); assert.equal(await page.locator(".catalog-photo-note").count(), 0);
    assert.equal(await text(page.locator(".catalog-file-button")), "Añadir foto"); await page.close();
    // Sustituir: deshacer tras quitar y elegir otra foto.
    page = await open("/productos/p-1/editar"); await page.getByRole("button", { name: "Quitar foto" }).click();
    await page.locator("#product-photo").setInputFiles({ name: "nueva.png", mimeType: "image/png", buffer: PNG });
    assert.equal(await page.locator(".catalog-photo-note").count(), 0, "elegir otra foto cancela la eliminación pendiente");
    assert.equal(await text(page.locator(".catalog-file-button")), "Reemplazar foto"); await page.close();
  });

  await t.test("vista previa que falla o caduca: respaldo legible y la acción de reemplazo sigue disponible", async () => {
    const page = await open("/productos/p-1/editar", { mode: { photo: "bad" } });
    await page.waitForFunction(() => document.querySelector(".catalog-photo-preview")?.hasAttribute("data-failed"));
    assert.equal(await page.locator(".catalog-photo-preview img").evaluate(image => image.hidden), true);
    assert.equal(await page.locator(".catalog-preview-failed").isVisible(), true);
    assert.equal(await text(page.locator(".catalog-preview-failed")), "No se pudo cargar la vista previa");
    assert.equal(await text(page.locator(".catalog-file-button")), "Reemplazar foto"); assert.equal(await page.getByRole("button", { name: "Quitar foto" }).count(), 1);
    await page.locator("#product-photo").setInputFiles({ name: "nueva.png", mimeType: "image/png", buffer: PNG });
    assert.equal(await page.locator(".catalog-photo-preview[data-failed]").count(), 0, "la nueva vista previa reinicia el estado");
    assert.equal(await page.locator(".catalog-photo-preview img").evaluate(image => !image.hidden), true);
    assert.deepEqual(page.errors, []); await page.close();
  });

  await t.test("errores de subida y de limpieza: mensajes existentes, campos conservados y secuencia intacta", async () => {
    let page = await open("/productos/nuevo", { mode: { upload: "error" } }); await fillValid(page);
    await page.locator("#product-photo").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG });
    await page.locator("form.catalog-form button[type=submit]").click();
    assert.equal(await text(page.getByRole("alert")), "No pudimos subir la fotografía. Comprueba tu conexión e inténtalo de nuevo.");
    assert.equal(await page.locator(".catalog-field-error").count(), 0, "los errores de servidor no se asocian a un campo");
    assert.equal(await page.locator("#product-name").inputValue(), "Sensor de proximidad M18"); assert.equal(await page.locator(".catalog-photo-preview img").count(), 1);
    assert.equal((await calls(page)).some(call => call.kind === "db" && call.op === "insert"), false); await page.close();
    // Insert falla y la limpieza también: aparece el reintento y el formulario queda bloqueado hasta resolverlo.
    page = await open("/productos/nuevo", { mode: { insert: "error", remove: "error" } }); await fillValid(page);
    await page.locator("#product-photo").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG });
    await page.locator("form.catalog-form button[type=submit]").click();
    await page.getByRole("button", { name: "Reintentar eliminación del archivo" }).waitFor();
    assert.equal(await page.locator("form.catalog-form button[type=submit]").isDisabled(), true);
    await page.evaluate(() => { window.__mode.remove = undefined; });
    await page.getByRole("button", { name: "Reintentar eliminación del archivo" }).click();
    await page.getByText("Archivo temporal eliminado. Puedes guardar de nuevo.").waitFor();
    assert.equal(await page.locator("form.catalog-form button[type=submit]").isDisabled(), false);
    assert.equal(await page.locator("#product-name").inputValue(), "Sensor de proximidad M18"); await page.close();
  });

  // ── Responsive, contraste, foco, teclado y movimiento ──
  const paints = (page, selector, fromParent = false) => page.locator(selector).evaluateAll((elements, fromParent) => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rgba = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    return elements.filter(element => element.getClientRects().length).map(element => { let node = fromParent ? element.parentElement : element, bg; while (node) { bg = rgba(getComputedStyle(node).backgroundColor); if (bg[3] === 255) break; node = node.parentElement; }
      const style = getComputedStyle(element); return { text: element.textContent.trim().slice(0, 40), fg: rgba(style.color), bg, ring: rgba(style.outlineColor), outlineWidth: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle }; });
  }, fromParent);
  for (const theme of ["light", "dark"]) for (const width of [320, 360, 390, 768, 1024, 1280]) {
    await t.test(`responsive ${width}px ${theme}: crear, editar y quick`, async () => {
      for (const route of ["/productos/nuevo", "/productos/p-1/editar", "/quick"]) {
        const page = await open(route, { width, theme });
        const longName = "Controlador lógico programable modular con módulo de expansión analógica y comunicación industrial redundante serie XL-9000".slice(0, 160);
        await page.locator("#product-name").fill(longName);
        if (route === "/quick") await page.locator("form.catalog-form summary").click();
        if (route === "/productos/nuevo") { // error asociado al campo: visible, legible y con el foco en el campo
          await page.locator("#product-name").fill(""); await page.locator("form.catalog-form button[type=submit]").click();
          const errorBox = await page.locator("#product-name-error").evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight }; });
          assert.ok(errorBox.left >= 0 && errorBox.right <= errorBox.vw && errorBox.top >= 0 && errorBox.bottom <= errorBox.vh, `error visible en la ventana a ${width}px ${JSON.stringify(errorBox)}`);
          for (const sample of await paints(page, "#product-name-error")) assert.ok(ratio(sample.fg, sample.bg) >= 4.5, `error ${ratio(sample.fg, sample.bg).toFixed(2)}`);
          assert.equal(await page.evaluate(() => document.activeElement?.id), "product-name");
          await page.locator("#product-name").fill(longName);
        }
        await page.locator("#product-description").fill("Descripción larga ".repeat(110));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} sin scroll horizontal`);
        const geometry = await page.evaluate(() => ({ vw: innerWidth, items: [...document.querySelectorAll(".catalog-form-section, .catalog-form-actions, .catalog-field input, .catalog-field select, .catalog-field textarea, .catalog-photo-editor, .catalog-form-note")]
          .map(element => { const r = element.getBoundingClientRect(); return { cls: element.className.split(" ")[0] || element.tagName, left: r.left, right: r.right, h: Math.round(r.height), clipped: !["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName) && element.scrollWidth > element.clientWidth + 1 }; }),
          form: Math.round(document.querySelector("form.catalog-form").getBoundingClientRect().width) }));
        for (const item of geometry.items) assert.ok(item.left >= -0.5 && item.right <= geometry.vw + 0.5 && !item.clipped, `${route} ${item.cls} ${JSON.stringify(item)}`);
        assert.ok(geometry.items.filter(item => ["INPUT", "SELECT"].includes(item.cls)).every(item => item.h >= 48));
        if (route !== "/quick" && width >= 1024) assert.ok(geometry.form <= 720, `ancho legible ${geometry.form}`);
        const buttons = await page.locator(".catalog-form-actions > *, .catalog-file-button").evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().height))); assert.ok(buttons.every(height => height >= 44), JSON.stringify(buttons));
        if (width <= 680 && route !== "/quick") { const stack = await page.locator(".catalog-form-actions").evaluate(row => getComputedStyle(row).flexDirection); assert.equal(stack, "column-reverse"); }
        for (const selector of [".catalog-form-section h2", ".catalog-form-section > p", ".catalog-form-note", ".catalog-field > span", ".catalog-field small", ".catalog-photo-controls > span", ".catalog-form-actions .catalog-quiet-button", ".catalog-form-actions .primary"])
          for (const sample of await paints(page, selector)) assert.ok(ratio(sample.fg, sample.bg) >= 4.5, `${route} ${selector} «${sample.text}» ${ratio(sample.fg, sample.bg).toFixed(2)}`);
        if ([320, 390, 768, 1280].includes(width) && route !== "/quick") await page.screenshot({ path: path.join(directory, `${route.includes("editar") ? "editar" : "crear"}-${width}-${theme}.png`), fullPage: true });
        if (route === "/quick" && [320, 390].includes(width)) await page.screenshot({ path: path.join(directory, `quick-${width}-${theme}.png`), fullPage: true });
        // Foco visible en el campo y en el botón de archivo (el <input> real está oculto: el anillo va en la etiqueta).
        await page.locator("#product-name").focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
        const ring = (await paints(page, "#product-name:focus-visible", false))[0]; assert.ok(ring.outlineStyle === "solid" && ring.outlineWidth >= 2, `${route} foco del nombre`);
        if (route !== "/quick") {
          await page.locator("#product-photo").focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
          const fileRing = await page.locator(".catalog-file-button").evaluate(label => { const style = getComputedStyle(label); return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }; });
          assert.ok(fileRing.style === "solid" && fileRing.width >= 3, `${route} foco del botón de archivo ${JSON.stringify(fileRing)}`);
        }
        assert.deepEqual(page.errors, []); await page.close();
      }
    });
  }

  await t.test("movimiento reducido: sin transiciones en los controles del formulario", async () => {
    let page = await open("/productos/nuevo", { reducedMotion: "reduce" });
    assert.ok(await page.locator(".catalog-button, .catalog-quiet-button, .catalog-file-button, .catalog-field input").evaluateAll(els => els.every(el => getComputedStyle(el).transitionDuration.split(",").every(value => parseFloat(value) <= 0.001)))); await page.close();
    page = await open("/productos/nuevo"); assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), false); await page.close();
  });
});
