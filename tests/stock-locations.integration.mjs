// Acciones/consultas TypeScript reales, servicios simulados y datos sintéticos.
// Node >=22; esbuild externo (sin cambiar dependencias del proyecto).
// STOCK_LOCATION_TEST_TOOLS = directorio que contiene node_modules/esbuild.
// node --test tests/stock-locations.integration.mjs
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireTools = createRequire(path.join(process.env.STOCK_LOCATION_TEST_TOOLS ?? root, "package.json"));
const { build } = requireTools("esbuild");
const bundle = await build({
  stdin: { resolveDir: root, contents: `export * from './lib/stock-data'; export * from './app/(workspace)/stock-actions';` },
  bundle: true, write: false, platform: "node", format: "iife", globalName: "stock",
  plugins: [{ name: "offline-only", setup(build) {
    build.onResolve({ filter: /^(@\/lib\/auth|next\/cache)$/ }, args => ({ path: args.path, namespace: "fake" }));
    build.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ contents: args.path === "next/cache"
      ? `export function revalidatePath(path, type) {
          const state = globalThis.__fixture;
          state.paths.push(path);
          state.invalidations.push({ path, type });
          if (path === state.failRevalidationPath) throw new Error('Fallo de caché simulado');
        }`
      : `export async function requireAuthorizedUser() {
          const fixture = globalThis.__fixture;
          fixture.authCalls++;
          if (fixture.denied) throw new Error('No autorizado');
          return fixture.client;
        }` }));
  } }],
});

const syntheticLocations = () => [
  ...Array.from({ length: 72 }, (_, i) => ({ id: i + 1, tipo: "compartimiento", codigo: `C${Math.floor(i / 24) + 1}${Math.floor(i % 24 / 4) + 1}${i % 4 + 1}`,
    torre_id: Math.floor(i / 24) + 1, piso: Math.floor(i % 24 / 4) + 1, posicion: i % 4 + 1, estante_id: null })),
  ...Array.from({ length: 24 }, (_, i) => ({ id: i + 73, tipo: "caja", codigo: `${i < 12 ? 'A' : 'B'}${i % 12 + 1}`,
    torre_id: null, piso: null, posicion: i % 4 + 1, estante_id: Math.floor(i / 4) + 1 })),
];

function fixture() {
  const state = { locations: syntheticLocations(), queries: [], writes: [], rpcs: [], paths: [], invalidations: [], logs: [], authCalls: 0,
    denied: false, error: null, queryError: null, throwQuery: false, failRevalidationPath: null, noChange: false };
  state.client = {
    from(table) {
      const query = { table, columns: null, filters: [], orders: [] };
      return {
        select(columns) { query.columns = columns; return this; },
        eq(column, value) { query.filters.push([column, value]); return this; },
        in(column, values) { query.filters.push([column, values]); return this; },
        order(column, options) { query.orders.push([column, options]); return this; },
        async insert(input) { state.writes.push({ table, input: structuredClone(input) }); return { error: state.error }; },
        then(resolve, reject) {
          state.queries.push(structuredClone(query));
          if (state.throwQuery) return Promise.reject(state.queryError).then(resolve, reject);
          let rows = state.locations;
          for (const [column, value] of query.filters) rows = rows.filter(row => Array.isArray(value) ? value.includes(row[column]) : row[column] === value);
          return Promise.resolve({ data: state.queryError ? null : rows, error: state.queryError }).then(resolve, reject);
        },
      };
    },
    async rpc(name, input) { state.rpcs.push({ name, input: structuredClone(input) }); return { data: state.noChange ? null : 123, error: state.error }; },
  };
  const context = vm.createContext({ __fixture: state, console: { error(...values) { state.logs.push(values); } } });
  new vm.Script(bundle.outputFiles[0].text).runInContext(context);
  return { state, ...context.stock };
}

const product = "00000000-0000-0000-0000-000000000501";
const plain = value => JSON.parse(JSON.stringify(value));

test("consultas autorizadas: 96 ubicaciones comunes y 72 exclusivas de torres", async () => {
  const { state, getPhysicalLocations, getCompartments } = fixture();
  const common = await getPhysicalLocations();
  assert.equal(common.length, 96);
  assert.equal(common.filter(row => row.tipo === "caja").length, 24);
  assert.ok(common.filter(row => row.tipo === "caja").every(row => !('torre_id' in row) && !('piso' in row)));
  const towers = await getCompartments();
  assert.equal(towers.length, 72);
  assert.deepEqual(Array.from(new Set(towers.map(row => row.torre_id))), [1, 2, 3]);
  assert.deepEqual(state.queries[1].filters, [["tipo", "compartimiento"]]);
  assert.equal(state.authCalls, 2);
  const count = state.queries.length;
  state.denied = true;
  await assert.rejects(getPhysicalLocations(), /No autorizado/);
  await assert.rejects(getCompartments(), /No autorizado/);
  assert.equal(state.queries.length, count);
});

test("consultas: propagan errores y rechazan topologías inválidas", async () => {
  const { state, getPhysicalLocations } = fixture();
  state.queryError = new Error("Servicio no disponible");
  await assert.rejects(getPhysicalLocations(), /Servicio no disponible/);
  state.queryError = null;
  state.locations[72].torre_id = 1;
  await assert.rejects(getPhysicalLocations(), /inválida/);
});

test("acción real: siete operaciones conservan producto y IDs exactos", async t => {
  const scenarios = [
    { name: "entrada caja", tipo: "entrada", destinoId: 96, cantidad: 3 },
    { name: "retiro caja", tipo: "retiro", origenId: 73, cantidad: 2 },
    { name: "ajuste caja", tipo: "ajuste", origenId: 73, cantidadFisica: 5, cantidadEsperada: 2 },
    { name: "torre→caja", tipo: "traslado", origenId: 1, destinoId: 96, cantidad: 1 },
    { name: "caja→torre", tipo: "traslado", origenId: 73, destinoId: 25, cantidad: 1 },
    { name: "caja→caja", tipo: "traslado", origenId: 73, destinoId: 96, cantidad: 1 },
    { name: "torre→torre", tipo: "traslado", origenId: 1, destinoId: 49, cantidad: 1 },
  ];
  for (const { name, ...input } of scenarios) await t.test(name, async () => {
    const { state, submitStockOperation } = fixture();
    assert.equal((await submitStockOperation({ ...input, productoId: product })).ok, true);
    if (input.tipo === "ajuste") {
      assert.deepEqual(state.rpcs, [{ name: "registrar_ajuste_fisico", input: {
        p_producto_id: product, p_compartimiento_id: input.origenId,
        p_cantidad_fisica: input.cantidadFisica, p_cantidad_esperada: input.cantidadEsperada,
      } }]);
      assert.equal(state.writes.length, 0);
    } else assert.deepEqual(state.writes, [{ table: "movimientos", input: {
      producto_id: product, tipo: input.tipo, cantidad: input.cantidad,
      origen_compartimiento_id: input.origenId ?? null, destino_compartimiento_id: input.destinoId ?? null,
    } }]);
    assert.equal(state.authCalls, 1);
    assert.ok(state.paths.includes(`/productos/${product}`));
    assert.ok(state.paths.every(path => !/null|undefined|\/carga\/[AB]\d/.test(path)));
    const ids = [input.origenId, input.destinoId].filter(Boolean);
    assert.deepEqual(state.queries[0].filters, [["id", ids]]);
    const towerIds = [...new Set(ids.filter(id => id <= 72).map(id => Math.floor((id - 1) / 24) + 1))];
    assert.deepEqual(state.paths.filter(path => path.startsWith('/torres/')), towerIds.map(id => `/torres/C${id}`));
    const shelfIds = [...new Set(ids.filter(id => id > 72).map(id => Math.floor((id - 73) / 4) + 1))];
    assert.deepEqual(state.paths.filter(path => path.startsWith('/estantes/')), shelfIds.map(id => `/estantes/${id}`));
    assert.equal(state.paths.includes('/estantes'), shelfIds.length > 0);
  });
});

test("acción real: autorización, IDs inválidos y errores no producen éxito/revalidaciones", async () => {
  const { state, submitStockOperation } = fixture();
  const input = { tipo: "entrada", productoId: product, destinoId: 73, cantidad: 1 };
  state.denied = true;
  await assert.rejects(submitStockOperation(input), /No autorizado/);
  assert.equal(state.writes.length, 0);
  assert.equal(state.queries.length, 0);
  state.denied = false;
  for (const change of [{ destinoId: 0 }, { destinoId: Number.MAX_SAFE_INTEGER + 1 }, { cantidad: -1 }]) {
    assert.equal((await submitStockOperation({ ...input, ...change })).ok, false);
  }
  assert.equal(state.writes.length, 0);
  for (const [code, pattern] of [["23503", /no existe/], ["23514", /suficiente/], ["40001", /cambió/]]) {
    state.error = { code };
    const result = await submitStockOperation({ ...input, destinoId: 999999 });
    assert.equal(result.ok, false);
    assert.match(result.message, pattern);
    assert.equal(state.paths.length, 0);
  }
  state.error = null;
  state.noChange = true;
  assert.equal((await submitStockOperation({ tipo: "ajuste", productoId: product, origenId: 73, cantidadFisica: 1, cantidadEsperada: 1 })).noChange, true);
});

test("invalidación no convierte una caja renombrada en ruta de torre/carga rápida", async () => {
  const { state, submitStockOperation } = fixture();
  state.locations[72].codigo = "MOTORES_1";
  assert.equal((await submitStockOperation({ tipo: "entrada", productoId: product, destinoId: 73, cantidad: 1 })).ok, true);
  assert.equal(state.paths.some(path => /\/torres\/|\/carga\//.test(path)), false);
  assert.equal(plain(state.queries[0]).columns, "tipo,torre_id,estante_id,codigo");
});

test("movimiento confirmado y consulta posterior fallida: éxito, invalidación conservadora y ninguna repetición", async t => {
  for (const throwQuery of [false, true]) for (const tipo of ['traslado', 'ajuste']) {
    await t.test(`${tipo}, ${throwQuery ? 'excepción' : 'error devuelto'}`, async () => {
      const { state, submitStockOperation } = fixture();
      state.queryError = new Error('SENSITIVE_JWT_FICTICIO');
      state.throwQuery = throwQuery;
      const input = tipo === 'ajuste'
        ? { tipo, productoId: product, origenId: 73, cantidadFisica: 4, cantidadEsperada: 2 }
        : { tipo, productoId: product, origenId: 73, destinoId: 96, cantidad: 1 };
      const result = await submitStockOperation(input);
      assert.equal(result.ok, true);
      assert.equal(result.noChange, false);
      assert.equal(result.message, 'Movimiento registrado correctamente.');
      assert.equal(state.writes.length, tipo === 'ajuste' ? 0 : 1);
      assert.equal(state.rpcs.length, tipo === 'ajuste' ? 1 : 0);
      assert.equal(state.queries.length, 1);
      assert.deepEqual(plain(state.invalidations.filter(item => item.type)), [
        { path: '/torres/[codigo]', type: 'page' },
        { path: '/estantes/[id]', type: 'page' },
        { path: '/carga/[codigo]', type: 'page' },
      ]);
      assert.ok(state.paths.includes('/estantes'));
      assert.ok(state.paths.includes(`/productos/${product}`));
      assert.equal(state.paths.some(path => /^\/estantes\/\d|^\/torres\/C\d/.test(path)), false);
      assert.deepEqual(plain(state.logs), [['No se pudieron consultar las ubicaciones después de confirmar el movimiento. Se aplica invalidación conservadora.']]);
      assert.equal(JSON.stringify(state.logs).includes('SENSITIVE_JWT_FICTICIO'), false);
      assert.equal(JSON.stringify(state.logs).includes(product), false);
    });
  }
});

test("un fallo de invalidación no convierte una escritura confirmada en fracaso ni impide intentar las demás vistas", async () => {
  const { state, submitStockOperation } = fixture();
  state.queryError = new Error('Consulta no disponible');
  state.failRevalidationPath = '/torres/[codigo]';
  const result = await submitStockOperation({ tipo: 'entrada', productoId: product, destinoId: 73, cantidad: 1 });
  assert.equal(result.ok, true);
  assert.equal(state.writes.length, 1);
  assert.equal(state.rpcs.length, 0);
  assert.ok(state.invalidations.some(item => item.path === '/estantes/[id]' && item.type === 'page'));
  assert.ok(state.invalidations.some(item => item.path === '/carga/[codigo]' && item.type === 'page'));
  assert.equal(state.logs.length, 2);
});
