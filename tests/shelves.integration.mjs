// Node >=22; esbuild externo. SHELVES_TEST_TOOLS=<directorio con node_modules>.
// node --test tests/shelves.integration.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createShelfFixture, productId } from "./helpers/shelves-fixture.mjs";

test("lectura agrupada de seis estantes, 24 cajas y contenido real, sin N+1", async () => {
  const { state, getShelfSummaries, getShelfDetail } = createShelfFixture();
  const summaries = await getShelfSummaries();
  assert.equal(summaries.length, 6);
  assert.equal(summaries.flatMap(shelf => shelf.cajas).length, 24);
  assert.equal(state.queries.length, 3);
  assert.deepEqual(state.queries.map(query => query.table), ['estantes', 'compartimientos', 'inventario']);
  assert.deepEqual(state.queries[1].filters, [['tipo', 'eq', 'caja'], ['estante_id', 'in', [1, 2, 3, 4, 5, 6]]]);
  assert.equal(summaries[0].cajas[0].unidades, 10);
  assert.equal(summaries[0].cajas[0].referencias, 2);
  state.queries = [];
  const detail = await getShelfDetail(1);
  assert.deepEqual(Array.from(detail.cajas, box => box.codigo), ['A1', 'A2', 'A3', 'A4']);
  assert.deepEqual(Array.from(detail.cajas[0].productos, row => [row.nombre, row.cantidad, row.categoria]), [['ESP32-S3', 3, 'Electrónica'], ['Módulo térmico', 7, 'Electrónica']]);
  assert.equal(state.queries.length, 5);
  assert.ok(state.queries.filter(query => query.table === 'inventario').every(query => query.filters[0][2].length === 4));
  assert.equal(detail.cajas[1].productos.length, 0);
});

test("paginación de inventario no corta referencias ni aumenta consultas por caja", async () => {
  const { state, getShelfSummaries } = createShelfFixture();
  state.tables.inventario = Array.from({ length: 1205 }, (_, i) => ({ compartimiento_id: 73 + i % 24, producto_id: `p${String(i).padStart(4, '0')}`, cantidad: 2 }));
  const shelves = await getShelfSummaries();
  assert.equal(shelves.flatMap(shelf => shelf.cajas).reduce((sum, box) => sum + box.referencias, 0), 1205);
  assert.equal(shelves.flatMap(shelf => shelf.cajas).reduce((sum, box) => sum + box.unidades, 0), 2410);
  assert.deepEqual(state.queries.filter(query => query.table === 'inventario').map(query => [query.start, query.end]), [[0, 999], [1000, 1999]]);
});

test("autorización antes de consultar, ausencia de registros y fallos explícitos", async () => {
  const { state, getShelfSummaries, getShelfDetail } = createShelfFixture();
  state.denied = true;
  await assert.rejects(getShelfSummaries(), /No autorizado/);
  await assert.rejects(getShelfDetail(1), /No autorizado/);
  assert.equal(state.queries.length, 0);
  state.denied = false;
  assert.equal(await getShelfDetail(999), null);
  for (const table of ['estantes', 'compartimientos', 'inventario', 'productos', 'categorias']) {
    state.failTable = table;
    await assert.rejects(getShelfDetail(1), /Fallo simulado/);
  }
  state.failTable = null;
  state.tables.estantes = [];
  state.queries = [];
  assert.equal((await getShelfSummaries()).length, 0);
  assert.equal(state.queries.length, 1);
});

test("ruta servidor real: IDs estables, caja del estante correcto y códigos editables", async () => {
  const { state, shelfPage, shelvesPage } = createShelfFixture();
  const page = (id, caja) => shelfPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(caja === undefined ? {} : { caja }) });
  const initial = await page('1', '73');
  assert.equal(initial.props.selectedId, 73);
  state.tables.compartimientos.find(row => row.id === 73).codigo = 'MOTORES_1';
  const renamed = await page('1', '73');
  assert.equal(renamed.props.selectedId, 73);
  assert.equal(renamed.props.shelf.cajas[0].codigo, 'MOTORES_1');
  for (const [id, box] of [['1', '96'], ['1', '1'], ['1', 'A1'], ['1', ['73']], ['999', undefined], ['0', undefined], ['abc', undefined]]) await assert.rejects(page(id, box), /NOT_FOUND/);
  assert.equal((await shelvesPage()).props.shelves.length, 6);
});

test("torres siguen limitadas a 72 compartimientos con stock presente en cajas", async () => {
  const { getDashboardSummary } = createShelfFixture();
  const dashboard = await getDashboardSummary();
  assert.equal(dashboard.total, 72);
  assert.equal(dashboard.ocupados, 1);
  assert.deepEqual(Array.from(dashboard.torres, tower => [tower.total, tower.ocupados]), [[24, 1], [24, 0], [24, 0]]);
});

test("stock invalida ambos estantes, sin rutas de carga/torre ficticias", async () => {
  const { state, submitStockOperation, getShelfDetail } = createShelfFixture();
  assert.equal((await submitStockOperation({ tipo: 'traslado', productoId: productId, origenId: 73, destinoId: 96, cantidad: 2 })).ok, true);
  assert.deepEqual(state.paths.filter(path => path.startsWith('/estantes')), ['/estantes', '/estantes/1', '/estantes/6']);
  assert.ok(state.paths.every(path => !/null|undefined|\/carga\/[AB]\d/.test(path)));
  assert.equal((await getShelfDetail(1)).cajas[0].unidades, 8);
  assert.equal((await getShelfDetail(6)).cajas[3].unidades, 14);
});
