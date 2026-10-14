// Node >=22; esbuild externo. SHELVES_TEST_TOOLS=<directorio con node_modules>.
// Acción real con autorización/Supabase/cache simulados; SQL se prueba por separado.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createShelfFixture } from './helpers/shelves-fixture.mjs';

const input = (code = ' motores_1 ') => ({ ubicacionId: 73, codigoEsperado: 'A1', codigoNuevo: code });

test('renombrado, normalización, alias propios y rutas estables sin tocar stock', async () => {
  const { state, renameBoxCode, shelfPage } = createShelfFixture();
  const stock = structuredClone(state.tables.inventario);
  assert.equal((await renameBoxCode(input())).ok, true);
  assert.deepEqual(state.rpcs[0], { name: 'renombrar_codigo_caja', input: { p_ubicacion_id: 73, p_codigo_esperado: 'A1', p_codigo_nuevo: 'MOTORES_1' } });
  assert.deepEqual(state.paths, ['/estantes', '/productos', '/productos/[id]', '/carga/ubicacion/73', '/carga', '/historial', '/estantes/1']);
  const unchanged = await renameBoxCode({ ...input('MOTORES_1'), codigoEsperado: 'MOTORES_1' });
  assert.equal(unchanged.noChange, true);
  assert.equal(state.codeHistory.length, 1);
  assert.equal((await renameBoxCode({ ...input('A1'), codigoEsperado: 'MOTORES_1' })).ok, true);
  assert.equal(state.codeOwners.get('MOTORES_1'), 73);
  assert.equal(state.codeHistory.length, 2);
  assert.deepEqual(state.tables.inventario, stock);
  assert.equal(state.writes.length, 0);
  const page = await shelfPage({ params: Promise.resolve({ id: '1' }), searchParams: Promise.resolve({ caja: '73' }) });
  assert.equal(page.props.selectedId, 73);
  assert.equal(page.props.shelf.cajas[0].posicion, 1);
});

test('autorización y validación antes de RPC; no se confía en IDs del formulario', async () => {
  const { state, renameBoxCode } = createShelfFixture();
  state.denied = true;
  await assert.rejects(renameBoxCode(input()), /No autorizado/);
  assert.equal(state.rpcs.length, 0);
  state.denied = false;
  for (const bad of [null, {}, { ...input(), ubicacionId: 0 }, { ...input(), ubicacionId: '73' }, { ...input(), codigoEsperado: null }, input('C999'), input('c123'), input('ß'), input('A B'), input('A1\n')]) {
    assert.equal((await renameBoxCode(bad)).ok, false);
  }
  assert.equal(state.rpcs.length, 0);
  assert.equal((await renameBoxCode({ ...input(), ubicacionId: 1, codigoEsperado: 'C111' })).ok, false);
  assert.equal((await renameBoxCode({ ...input(), ubicacionId: 999 })).ok, false);
  assert.equal(state.paths.length, 0);
});

test('errores duplicado/histórico/concurrencia/autorización sin reintentos ni detalles sensibles', async () => {
  const { state, renameBoxCode } = createShelfFixture();
  assert.equal((await renameBoxCode(input('A2'))).ok, false);
  await renameBoxCode({ ubicacionId: 74, codigoEsperado: 'A2', codigoNuevo: 'OTRA' });
  assert.equal((await renameBoxCode(input('A2'))).ok, false);
  assert.equal((await renameBoxCode({ ...input('NUEVO'), codigoEsperado: 'ANTERIOR' })).stale, true);
  for (const code of ['23505', '40001', '23503', '22023', '42501', 'XX000']) {
    state.renameError = code;
    const count = state.rpcs.length;
    const result = await renameBoxCode(input());
    assert.equal(result.ok, false);
    assert.equal(state.rpcs.length, count + 1);
    assert.doesNotMatch(result.message, /Sensitive|database|XX000/);
  }
  state.renameError = null; state.renameThrow = true;
  const count = state.rpcs.length;
  assert.match((await renameBoxCode(input())).message, /Actualiza/);
  assert.equal(state.rpcs.length, count + 1);
});

test('fallo de invalidación con respuesta válida no duplica ni informa fracaso', async () => {
  const { state, renameBoxCode } = createShelfFixture();
  state.failInvalidation = true;
  assert.equal((await renameBoxCode(input())).ok, true);
  assert.equal(state.rpcs.length, 1);
  assert.equal(state.codeHistory.length, 1);
  assert.equal(state.tables.compartimientos.find(row => row.id === 73).codigo, 'MOTORES_1');
  assert.ok(state.paths.includes('/estantes/1'));
});

const validRow = { ubicacion_id: 73, estante_id: 1, codigo: 'MOTORES_1', sin_cambios: false };
const incomplete = field => { const row = { ...validRow }; delete row[field]; return [row]; };
const invalidResponses = [
  ['ausente', undefined], ['nula', null], ['vacía', []], ['fila nula', [null]],
  ['objeto fuera de array', validRow], ['fila primitiva', ['MOTORES_1']], ['fila array', [[]]],
  ...Object.keys(validRow).map(field => [`incompleta: ${field}`, incomplete(field)]),
  ['múltiples válidas', [validRow, validRow]], ['múltiples con una inválida', [validRow, {}]],
  ['ID ajeno', [{ ...validRow, ubicacion_id: 74 }]], ['ID string', [{ ...validRow, ubicacion_id: '73' }]],
  ...[0, 7, null, '1', 1.5].map(estante_id => [`estante inválido: ${String(estante_id)}`, [{ ...validRow, estante_id }]]),
  ...['A1', 'OTRO', 'motores_1', ' MOTORES_1 ', 'C999', null].map(codigo => [`código inconsistente: ${String(codigo)}`, [{ ...validRow, codigo }]]),
  ['sin_cambios contrario al cambio', [{ ...validRow, sin_cambios: true }]],
  ['sin_cambios string', [{ ...validRow, sin_cambios: 'false' }]],
  ['sin_cambios nulo', [{ ...validRow, sin_cambios: null }]],
];

for (const [name, response] of invalidResponses) test(`respuesta no verificable: ${name}`, async () => {
  const { state, renameBoxCode } = createShelfFixture();
  state.renameResponse = response;
  const stock = structuredClone(state.tables.inventario);
  const result = await renameBoxCode(input());
  assert.equal(result.ok, false);
  assert.equal(result.uncertain, true);
  assert.match(result.message, /incierto.*Actualiza.*antes de intentar otra operación/);
  assert.equal(Object.hasOwn(result, 'codigo'), false);
  assert.equal(Object.hasOwn(result, 'noChange'), false);
  assert.equal(state.rpcs.length, 1);
  assert.equal(state.codeHistory.length, 1, 'La escritura puede haberse confirmado pese a la respuesta incorrecta');
  assert.equal(state.tables.compartimientos.find(row => row.id === 73).codigo, 'MOTORES_1');
  assert.deepEqual(state.tables.inventario, stock);
  assert.deepEqual(state.paths, ['/estantes', '/productos', '/productos/[id]', '/carga/ubicacion/73', '/carga', '/historial', '/estantes/[id]']);
});

test('sin_cambios debe ser true cuando ambos códigos normalizados coinciden', async () => {
  const { state, renameBoxCode } = createShelfFixture();
  state.renameResponse = [{ ...validRow, codigo: 'A1', sin_cambios: false }];
  const result = await renameBoxCode(input(' a1 '));
  assert.equal(result.ok, false);
  assert.equal(result.uncertain, true);
  assert.equal(state.rpcs.length, 1);
  assert.equal(state.codeHistory.length, 0);
  assert.equal(state.tables.compartimientos.find(row => row.id === 73).codigo, 'A1');
  assert.ok(state.paths.includes('/estantes/[id]'));
});
