// Offline integration of the actual action and both actual search components.
// Install esbuild + playwright outside the repo; INVENTORY_SEARCH_TEST_TOOLS
// points to the directory containing their node_modules. Run node --test here.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchesCatalogQuery } from "../lib/rapid-model.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireTools = createRequire(path.join(process.env.INVENTORY_SEARCH_TEST_TOOLS ?? root, "package.json"));
const { build } = requireTools("esbuild");
const { chromium } = requireTools("playwright");
const actionBundle = await build({
  stdin: { resolveDir: root, contents: `export * from './app/(workspace)/search-actions'; export * from './app/(workspace)/box-code-actions';` },
  bundle: true, write: false, platform: "node", format: "iife", globalName: "searchAction",
  plugins: [{ name: "no-production-access", setup(build) {
    build.onResolve({ filter: /^(next\/cache|@\/lib\/(auth|product-catalog))$/ }, args => ({ path: args.path, namespace: "fake" }));
    build.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ contents: args.path === 'next/cache'
      ? 'export function revalidatePath(path){globalThis.__searchTest.paths.push(path)}' : args.path.endsWith("/auth")
      ? `export async function requireAuthorizedUser() {
          const state = globalThis.__searchTest;
          state.authorizations++;
          if (state.denied) throw new Error("Access denied");
          return state.client;
        }`
      : `export async function getSignedProductImages(paths) {
          globalThis.__searchTest.imageCalls.push(paths);
          return new Map(paths.filter(Boolean).map(p => [p, "https://images.test/" + p]));
        }` }));
  } }],
});

const product = (id, nombre, categoria = "Prueba") => ({ id, nombre, categorias: { nombre: categoria }, foto_ruta: null });
const samples = [
  product("p01", "Módulo térmico", "Electrónica / térmica"),
  product("p02", "ESP32-S3", "Microcontroladores"),
  product("p03", "Eje", "Mecánica"),
  product("p04", "C++", "Software"), product("p05", "C#", "Software"),
  product("p06", "Resistencia 4.7 kΩ"), product("p07", "Resistencia 47 kΩ"),
  product("p08", "センサー ガ"), product("p09", "เซ็นเซอร์"), product("p10", "센서"),
  product("p11", "Fuente −5 V"), product("p12", "Fuente 5 V"),
  product("p13", "Conector 1/4"), product("p14", "Conector 14"),
];

function fixture(products = samples.map(row => structuredClone(row))) {
  const state = {
    products, clock: 0, authorizations: 0, denied: false, failMetadata: false,
    calls: [], imageCalls: [], requests: [], delays: new Map(), paths: [], rpcs: [], failTable: null, hiddenIds: [],
    compartments: [
      { id: 264, tipo: 'compartimiento', codigo: "C264", torre_id: 2, piso: 6, posicion: 4, estante_id: null },
      ...Array.from({length:24},(_,i)=>({id:73+i,tipo:'caja',codigo:(i<12?'A':'B')+(i%12+1),torre_id:null,piso:null,estante_id:Math.floor(i/4)+1,posicion:i%4+1})),
    ],
    stock: products.map((p, index) => ({ producto_id: p.id, cantidad: index + 11,
      compartimiento_id: 264, compartimientos: { codigo: "C264" }, productos: { nombre: p.nombre } })),
  };
  state.codes = state.compartments.map(row=>({codigo:row.codigo,compartimiento_id:row.id}));
  state.client = { async rpc(name, input) {
    assert.equal(name,'renombrar_codigo_caja');state.rpcs.push({name,input});
    const box=state.compartments.find(row=>row.id===input.p_ubicacion_id);
    if(!box||box.tipo!=='caja')return {data:null,error:{code:'22023'}};
    if(box.codigo!==input.p_codigo_esperado)return {data:null,error:{code:'40001'}};
    const reserved=state.codes.find(row=>row.codigo===input.p_codigo_nuevo);
    if(reserved&&reserved.compartimiento_id!==box.id)return {data:null,error:{code:'23505'}};
    const unchanged=box.codigo===input.p_codigo_nuevo;
    if(!reserved)state.codes.push({codigo:input.p_codigo_nuevo,compartimiento_id:box.id});
    box.codigo=input.p_codigo_nuevo;
    return {data:[{ubicacion_id:box.id,estante_id:box.estante_id,codigo:box.codigo,sin_cambios:unchanged}],error:null};
  }, from(table) {
    const query = { table, columns: "", filters: [], orders: [], start: 0, end: Infinity, limit: Infinity, single: false };
    const builder = {
      select(columns) { query.columns = columns; return this; },
      order(column) { query.orders.push(column); return this; },
      range(start, end) { query.start = start; query.end = end; return this; },
      limit(limit) { query.limit = limit; return this; },
      in(column, values) { query.filters.push([column, "in", values]); return this; },
      eq(column, value) { query.filters.push([column, "eq", value]); return this; },
      gt(column, value) { query.filters.push([column, "gt", value]); return this; },
      maybeSingle() { query.single = true; return this; },
      then(resolve, reject) {
        state.calls.push(structuredClone(query));
        if (state.failTable === table) return Promise.resolve({data:null,error:new Error('Synthetic query failure')}).then(resolve,reject);
        if (state.failMetadata && query.table === "productos" && query.columns === "id,nombre,categorias(nombre)") {
          return Promise.resolve({ data: null, error: new Error("Metadata unavailable") }).then(resolve, reject);
        }
        const tables = {productos:state.products,inventario:state.stock,compartimientos:state.compartments,ubicacion_codigos:state.codes};
        assert.ok(Object.hasOwn(tables,table), `Unexpected table ${table}`);
        let rows = [...tables[table]];
        if (table === 'compartimientos') rows=rows.filter(row=>!state.hiddenIds.includes(row.id));
        if (table === 'inventario') rows=rows.map(row=>({...row,compartimientos:{codigo:state.compartments.find(place=>place.id===row.compartimiento_id)?.codigo},productos:{nombre:state.products.find(product=>product.id===row.producto_id)?.nombre}}));
        for (const [column, operator, value] of query.filters) rows = rows.filter(row => operator === "in" ? value.includes(row[column]) : operator === "eq" ? row[column] === value : row[column] > value);
        rows.sort((a, b) => {
          for (const column of query.orders) {
            const difference = String(a[column]).localeCompare(String(b[column]), "es");
            if (difference) return difference;
          }
          return 0;
        });
        rows = rows.slice(query.start, Math.min(query.end + 1, query.start + query.limit));
        if (table === "productos" && !query.columns.includes("foto_ruta")) rows = rows.map(({ id, nombre, categorias }) => ({ id, nombre, categorias }));
        return Promise.resolve({ data: query.single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  } };
  const context = vm.createContext({ __searchTest: state, Date: { now: () => state.clock }, console:{error(){}} });
  new vm.Script(actionBundle.outputFiles[0].text).runInContext(context);
  return { state, search: context.searchAction.searchInventory, rename:context.searchAction.renameBoxCode };
}

const metadataCalls = state => state.calls.filter(q => q.table === "productos" && q.columns === "id,nombre,categorias(nombre)");
const expectedIds = (products, query) => products.filter(p => matchesCatalogQuery(p.nombre, p.categorias?.nombre ?? "Sin categoría", query)).map(p => p.id).sort();
const resultIds = result => Array.from(result.products, p => p.id).sort();

test("B3: acción real y catálogo devuelven las mismas coincidencias con un índice reutilizado", async () => {
  const { state, search } = fixture();
  const terms = ["modulo termico", " MÓDULO_TÉRMICO ", "modulo—termico", "mo\u0301dulo te\u0301rmico", "electronica termica", "mecanica", "esp32 s3", "C++", "C#", "4.7 kΩ", "47 kΩ", "センサー ガ", "セン サー ガ", "เซ็นเซอร์", "센서", "fuente -5 v", "fuente5v", "conector1⁄4", "conector14", "no existe", "%", "(id.eq.x)"];
  for (const term of terms) assert.deepEqual(resultIds(await search(term)), expectedIds(state.products, term), term);
  assert.equal(metadataCalls(state).length, 1);
  assert.equal(state.authorizations, terms.length);
  const selected = state.calls.filter(q => q.table === "productos" && q.columns.includes("foto_ruta"));
  assert.ok(selected.every(q => q.filters[0][0] === "id" && q.filters[0][2].length <= 25));
  assert.ok(state.calls.every(q => !q.columns.includes("descripcion") && !q.columns.includes("nombre_normalizado")));
});

test("B3: paginación completa, orden estable, prioridad exacta y límite de 25", async () => {
  const products = Array.from({ length: 1205 }, (_, index) => product(String(index).padStart(5, "0"), index < 70 ? `Sensor ${index}` : `Otro ${index}`));
  products.at(-1).nombre = "Sénsor";
  const { state, search } = fixture(products);
  const found = await search("sensor");
  assert.equal(found.products.length, 25);
  assert.equal(found.products[0].id, "01204");
  assert.deepEqual(metadataCalls(state).map(q => [q.start, q.end, q.orders]), [[0, 999, ["id"]], [1000, 1999, ["id"]]]);
  await Promise.all([search("SENSOR"), search("sénsor"), search("Sensor_")]);
  assert.equal(metadataCalls(state).length, 2);
});

test("B3: autoriza antes de consultar incluso cuando el índice está caliente", async () => {
  const { state, search } = fixture();
  state.denied = true;
  await assert.rejects(search("modulo"), /Access denied/);
  assert.equal(state.calls.length, 0);
  state.denied = false;
  await search("modulo");
  const before = state.calls.length;
  state.denied = true;
  await assert.rejects(search("modulo"), /Access denied/);
  assert.equal(state.calls.length, before);
});

test("B3: códigos exactos, límite de entrada y búsquedas vacías sin consulta", async () => {
  const { state, search } = fixture();
  for (const term of ["", "   ", "___", "---", "\\", null, {}]) {
    assert.equal((await search(term)).products.length, 0);
  }
  assert.equal(state.calls.length, 0);
  const found = await search(" c264 ");
  assert.equal(found.location.codigo, "C264");
  assert.equal(found.location.productos[0].cantidad, 11);
  for (const term of ["C 264", "Ć264", "Ｃ２６４"]) {
    const result = await search(term);
    assert.equal(result.location, null);
    assert.equal(result.locationAttempt, false);
  }
  assert.equal((await search('C-264')).location, null, 'Guion no equivale a código de torre');
  assert.equal((await search("C299")).locationAttempt, true);
  assert.equal((await search("C299")).location, null);
  assert.equal((await search("a".repeat(101))).products.length, 0);
  const long = fixture([product("long", "a".repeat(100))]);
  assert.equal((await long.search("a".repeat(101))).products.length, 1);
  assert.equal(state.calls.filter(q => q.table === "compartimientos").length, 1, 'Solo se lee el ID encontrado en el registro');
  assert.equal(state.calls.filter(q => q.table === "ubicacion_codigos").length, 4);
});

test("B3: stock/fotos frescos, revalida nombres y renueva el índice tras 15 segundos", async () => {
  const { state, search } = fixture();
  assert.equal((await search("modulo")).products[0].stock, 11);
  state.stock[0].cantidad = 52;
  state.products[0].foto_ruta = "fake-photo.png";
  const fresh = await search("modulo");
  assert.equal(fresh.products[0].stock, 52);
  assert.equal(fresh.products[0].fotoUrl, "https://images.test/fake-photo.png");
  state.products[0].nombre = "Motor nuevo";
  assert.equal((await search("modulo")).products.length, 0);
  assert.equal((await search("motor nuevo")).products.length, 0);
  state.clock = 15_000;
  assert.equal((await search("motor nuevo")).products[0].id, "p01");
  state.products = state.products.filter(row => row.id !== "p01");
  assert.equal((await search("motor nuevo")).products.length, 0);
});

test("B3: las cargas concurrentes no repiten páginas y un fallo permite reintentar", async () => {
  const { state, search } = fixture();
  state.failMetadata = true;
  await assert.rejects(search("modulo"), /Metadata unavailable/);
  state.failMetadata = false;
  await Promise.all([search("modulo"), search("esp32"), search("mecanica")]);
  assert.equal(metadataCalls(state).length, 2);
  state.clock = 15_000;
  await Promise.all([search("modulo"), search("esp32")]);
  assert.equal(metadataCalls(state).length, 3);
});

test("B3: coste acotado de consultas con 5.000 productos ficticios", async (t) => {
  const rows = Array.from({ length: 5000 }, (_, index) => product(String(index).padStart(5, "0"), index === 4999 ? "Módulo térmico" : `Pieza ${index}`));
  const { state, search } = fixture(rows);
  const cold = performance.now();
  assert.equal((await search("modulo termico")).products[0].id, "04999");
  const coldMs = performance.now() - cold;
  assert.equal(metadataCalls(state).length, 6); // Exactly full pages need an empty terminal page.
  const before = state.calls.length;
  const warm = performance.now();
  for (let index = 0; index < 20; index++) await search(index % 2 ? "MODULO_TERMICO" : "modulo termico");
  const warmMs = (performance.now() - warm) / 20;
  assert.equal(metadataCalls(state).length, 6);
  assert.equal(state.calls.length - before, 50); // Products/stock unchanged; ten exact code probes.
  assert.equal(state.calls.filter(q=>q.table==='ubicacion_codigos').length,10);
  assert.ok(warmMs < 250, `warm local filtering took ${warmMs}ms`);
  t.diagnostic(`Synthetic 5,000 rows: cold ${coldMs.toFixed(1)}ms; warm ${warmMs.toFixed(1)}ms/search. No network latency measured.`);
});

test('5A: las 24 etiquetas iniciales resuelven ID, estante y posición sin lecturas masivas', async()=>{
  const {state,search}=fixture();
  for(const box of state.compartments.filter(row=>row.tipo==='caja')){
    const result=await search(` ${box.codigo.toLowerCase()} `);
    assert.equal(result.location.id,box.id);assert.equal(result.location.codigo,box.codigo);
    assert.equal(result.location.tipo,'caja');assert.equal(result.location.estante_id,box.estante_id);
    assert.equal(result.location.posicion,box.posicion);assert.equal(result.location.historical,false);
    assert.equal(result.location.href,`/estantes/${box.estante_id}?caja=${box.id}`);
    assert.match(result.location.context,new RegExp(`Estante ${box.estante_id}`));
  }
  assert.equal(metadataCalls(state).length,1);
  assert.equal(state.calls.filter(q=>q.table==='ubicacion_codigos').length,24);
  assert.equal(state.calls.filter(q=>q.table==='compartimientos').length,24);
  assert.ok(state.calls.filter(q=>['ubicacion_codigos','compartimientos'].includes(q.table)).every(q=>q.single&&q.filters.length===1&&q.filters[0][1]==='eq'));
});

test('5A: renombrar y buscar alias/código actual con productos coincidentes y caché caliente', async()=>{
  const {state,search,rename}=fixture([...samples,product('same','A6')]);
  state.stock.at(-1).compartimiento_id=78;
  assert.equal((await search('A6')).location.id,78);
  assert.equal((await rename({ubicacionId:78,codigoEsperado:'A6',codigoNuevo:' motores '})).ok,true);
  const historic=await search('a6');
  assert.equal(historic.location.id,78);assert.equal(historic.location.codigo,'MOTORES');
  assert.equal(historic.location.matchedCode,'A6');assert.equal(historic.location.historical,true);
  assert.equal(historic.location.href,'/estantes/2?caja=78');
  assert.equal(historic.products[0].id,'same');assert.equal(historic.products[0].principales[0].codigo,'MOTORES');
  const current=await search('MOTORES');assert.equal(current.location.id,78);assert.equal(current.location.historical,false);
  assert.equal(metadataCalls(state).length,1);assert.equal(state.clock,0);
  assert.equal(state.rpcs.length,1);
  assert.equal((await rename({ubicacionId:78,codigoEsperado:'MOTORES',codigoNuevo:'A6'})).ok,true);
  assert.equal((await search('MOTORES')).location.historical,true);
  assert.equal((await search('A6')).location.historical,false);
});

test('5A: códigos exactos conservan separadores, Unicode, RLS y errores explícitos',async()=>{
  const {state,search,rename}=fixture();
  for(const [id,oldCode,newCode] of [[73,'A1','MOTORES_1'],[74,'A2','MOTORES-1'],[75,'A3','SS']]) assert.equal((await rename({ubicacionId:id,codigoEsperado:oldCode,codigoNuevo:newCode})).ok,true);
  assert.equal((await search('motores_1')).location.id,73);
  assert.equal((await search('motores-1')).location.id,74);
  const before=state.calls.filter(q=>q.table==='ubicacion_codigos').length;
  for(const term of ['MOTORES 1','ß','MÓTORES_1','Ｃ264','C++','C#','-A1','_A1','%','A'.repeat(25)]) assert.equal((await search(term)).location,null,term);
  assert.equal(state.calls.filter(q=>q.table==='ubicacion_codigos').length,before);
  assert.equal((await search('A999')).location,null);
  state.hiddenIds=[73];assert.equal((await search('A1')).location,null);
  state.hiddenIds=[];
  for(const table of ['ubicacion_codigos','compartimientos','inventario']){
    state.failTable=table;await assert.rejects(search('A1'),/Synthetic query failure/);
  }
  state.failTable=null;state.denied=true;
  const count=state.calls.length;await assert.rejects(search('A1'),/Access denied/);assert.equal(state.calls.length,count);
});

test("B3/5A: componentes reales, debounce y descarte de respuestas antiguas", async (t) => {
  const { state, search, rename } = fixture([...samples,product('same','A6')]);
  const client = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import { createRoot } from "react-dom/client";
      import { GlobalSearch } from "./components/global-search";
      import { ProductCatalogList } from "./components/product-catalog-list";
      const products = ${JSON.stringify(samples.map((p, index) => ({ id: p.id, nombre: p.nombre, categoria: p.categorias.nombre, fotoUrl: null, descripcion: null, stock: index + 11, ubicaciones: 1 })))};
      createRoot(document.getElementById("root")).render(<><GlobalSearch/><ProductCatalogList products={products}/></>);
    ` },
    bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "local-test-endpoint", setup(build) {
      build.onResolve({ filter: /^(next\/link|@\/app\/\(workspace\)\/search-actions)$/ }, args => ({ path: args.path, namespace: "fake" }));
      build.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ resolveDir: root,
        contents: args.path === "next/link" ? 'import {createElement} from "react"; export default function Link(props) { return createElement("a", props); }'
          : 'export async function searchInventory(query) { const response = await fetch("/search", {method:"POST",body:query}); if (!response.ok) throw new Error("Offline fixture denied"); return response.json(); }',
      }));
    } }],
  });
  const css=(await Promise.all(['app/globals.css','app/theme.css','app/catalog.css','app/stock.css','app/rapid.css','components/tower-view.css'].map(file=>readFile(path.join(root,file),'utf8')))).join('\n').replace('@import "tailwindcss";','');
  const server = createServer(async (request, response) => {
    if (request.url === "/search") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const term = Buffer.concat(chunks).toString();
      state.requests.push(term);
      try {
        const result = await search(term);
        await new Promise(resolve => setTimeout(resolve, state.delays.get(term) ?? 0));
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(result));
      } catch {
        response.statusCode = 403;
        response.end("Denied");
      }
    } else if (request.url === "/fixture.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(client.outputFiles[0].text);
    } else {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`);
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const width of [1280, 360, 390]) {
    await t.test(`${width}px`, async () => {
      const currentCode=state.compartments.find(row=>row.id===78).codigo;
      if(currentCode!=='A6') assert.equal((await rename({ubicacionId:78,codigoEsperado:currentCode,codigoNuevo:'A6'})).ok,true);
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
      await page.goto(url);
      await page.evaluate(()=>document.documentElement.dataset.theme='light');
      const globalInput = page.getByRole("searchbox", { name: "Buscar producto, categoría o ubicación" });
      const catalogInput = page.getByRole("searchbox", { name: "Filtrar productos por nombre o categoría" });
      for (const term of ["modulo termico", "MÓDULO_TERMICO", "modulo—termico", "electronica termica", "mecanica", "esp32 s3", "C++", "C#", "4.7 kΩ", "センサー ガ", "센서"]) {
        const response = page.waitForResponse(r => r.url() === `${url}/search` && r.request().postData() === term);
        await catalogInput.fill(term);
        await globalInput.fill(term);
        await response;
        const ids = expectedIds(state.products, term);
        await page.waitForFunction(count => document.querySelectorAll(".search-product-result").length === count, ids.length);
        const hrefs = links => links.map(link => link.getAttribute("href")).sort();
        assert.deepEqual(await page.locator(".search-product-result").evaluateAll(hrefs), await page.locator(".catalog-card").evaluateAll(hrefs), term);
      }

      // All edits happen in one browser task, before the 250ms debounce can fire.
      const before = state.requests.length;
      const response = page.waitForResponse(r => r.url() === `${url}/search` && r.request().postData() === "esp32 s3");
      await globalInput.evaluate(input => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        for (const term of ["e", "es", "esp", "esp32 s3"]) {
          setValue.call(input, term);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      await response;
      assert.equal(state.requests.length - before, 1);

      state.delays.set("modulo", 700);
      const slow = page.waitForResponse(r => r.url() === `${url}/search` && r.request().postData() === "modulo");
      await globalInput.fill("modulo");
      await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes("Buscando"));
      const fast = page.waitForResponse(r => r.url() === `${url}/search` && r.request().postData() === "esp32");
      await globalInput.fill("esp32");
      await fast;
      await slow;
      assert.match(await page.locator(".search-product-list").innerText(), /ESP32-S3/);
      assert.doesNotMatch(await page.locator(".search-product-list").innerText(), /Módulo/);

      const cleared = page.waitForResponse(r => r.url() === `${url}/search` && r.request().postData() === "modulo");
      await globalInput.fill("modulo");
      await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes("Buscando"));
      await globalInput.fill("");
      await cleared;
      assert.equal(await page.locator(".global-search-results").count(), 0);

      await globalInput.fill(" c264 ");
      await page.locator(".global-location-result").waitFor();
      assert.match(await page.locator(".global-location-result").getAttribute("href"), /compartimiento=C264/);
      assert.match(await page.locator('.global-location-result').innerText(),/Torre C2 · Piso 6 · Compartimiento 4/);
      await globalInput.fill('A6');await page.locator('.global-location-result strong').filter({hasText:'A6'}).waitFor();
      assert.equal(await page.locator('.global-location-result').getAttribute('href'),'/estantes/2?caja=78');
      assert.match(await page.locator('.global-location-result').innerText(),/Estante 2 · Superior derecha/);
      await page.locator('.search-product-result[href="/productos/same"]').waitFor();
      assert.equal((await rename({ubicacionId:78,codigoEsperado:'A6',codigoNuevo:'MOTORES'})).ok,true);
      // Changing the query triggers a fresh code read while the product cache stays warm.
      await globalInput.fill(' a6 ');await page.locator('.global-location-result strong').filter({hasText:'MOTORES'}).waitFor();
      assert.match(await page.locator('.global-location-result').innerText(),/Código histórico: A6 · Código actual: MOTORES/);
      assert.equal(await page.locator('.global-location-result').getAttribute('href'),'/estantes/2?caja=78');
      await page.locator('.search-product-result[href="/productos/same"]').waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(process.env.INVENTORY_SEARCH_ARTIFACTS){
        await mkdir(process.env.INVENTORY_SEARCH_ARTIFACTS,{recursive:true});
        await page.screenshot({path:path.join(process.env.INVENTORY_SEARCH_ARTIFACTS,`busqueda-historica-${width}.png`),fullPage:true});
      }
      await globalInput.fill('MOTORES');await page.locator('.global-location-result').waitFor();
      assert.doesNotMatch(await page.locator('.global-location-result').innerText(),/Código histórico/);
      const longCode='W'.repeat(24);
      assert.equal((await rename({ubicacionId:78,codigoEsperado:'MOTORES',codigoNuevo:longCode})).ok,true);
      await globalInput.fill(' MOTORES ');await page.locator('.global-location-result strong').filter({hasText:longCode}).waitFor();
      assert.equal(await page.locator('.global-location-result').getAttribute('href'),'/estantes/2?caja=78');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(process.env.INVENTORY_SEARCH_ARTIFACTS) await page.screenshot({path:path.join(process.env.INVENTORY_SEARCH_ARTIFACTS,`busqueda-codigo-largo-${width}.png`),fullPage:true});
      await globalInput.fill('A999');await page.locator('.search-empty').filter({hasText:'No encontramos productos ni ubicaciones'}).waitFor();
      state.denied = true;
      await globalInput.fill("denegado");
      await page.getByRole("alert").waitFor();
      state.denied = false;
      assert.deepEqual(errors, []);
      await page.close();
    });
  }
});
