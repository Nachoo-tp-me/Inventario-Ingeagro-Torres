// C2b: submitStockOperation REAL (acción de servidor) contra un Supabase simulado que reproduce la restricción UNIQUE de
// movimientos.solicitud_id, aplica la escritura ANTES de perder la respuesta y registra cada escritura y cada movimiento.
// Sin red, sin Supabase real. Node >=22; esbuild externo. SHELVES_TEST_TOOLS=<tools> node --test tests/stock-idempotency.integration.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createShelfFixture, productId, secondProductId } from './helpers/shelves-fixture.mjs';

const U = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const UNCERTAIN = 'No pudimos confirmar el movimiento. Puedes reintentar: si ya se registró, no se duplicará.';
const stockAt = (f, location, product = productId) => f.state.tables.inventario.find(row => row.compartimiento_id === location && row.producto_id === product)?.cantidad ?? 0;
const rows = (f, id) => f.state.tables.movimientos.filter(row => row.solicitud_id === id);
const entry = (id, extra = {}) => ({ tipo: 'entrada', productoId: productId, destinoId: 73, cantidad: 3, solicitudId: id, ...extra });
const withdrawal = (id, extra = {}) => ({ tipo: 'retiro', productoId: productId, origenId: 73, cantidad: 2, solicitudId: id, ...extra });

test('respuesta normal: el id viaja en minúsculas, una fila y el stock aplicado una vez', async () => {
  const f = createShelfFixture(); const result = await f.submitStockOperationRaw(entry(U(1).toUpperCase()));
  assert.deepEqual([result.ok, result.uncertain, result.duplicate], [true, undefined, undefined]); assert.equal(result.message, 'Movimiento registrado correctamente.');
  assert.equal(f.state.writes[0].solicitud_id, U(1)); assert.equal(rows(f, U(1)).length, 1); assert.equal(stockAt(f, 73), 10);
});

test('V2 exige un solicitudId válido para entrada, retiro y traslado (sin él no se escribe nada); el ajuste no lo usa', async () => {
  const f = createShelfFixture();
  for (const bad of [undefined, '', 'no-es-uuid', 42, '11111111-1111-1111-1111-111111111111']) {
    const result = await f.submitStockOperationRaw({ ...entry(U(1)), solicitudId: bad });
    assert.equal(result.ok, false); assert.match(result.message, /No se pudo identificar la solicitud/);
  }
  assert.equal(f.state.writes.length, 0); assert.equal(stockAt(f, 73), 7);
  assert.equal((await f.submitStockOperationRaw({ tipo: 'ajuste', productoId: productId, origenId: 73, cantidadFisica: 5, cantidadEsperada: 7 })).ok, true, 'el ajuste conserva su RPC');
  assert.equal(f.state.rpcs.at(-1).name, 'registrar_ajuste_fisico'); assert.equal('solicitud_id' in f.state.rpcs.at(-1).input, false);
});

test('escritura confirmada y respuesta perdida: incierto, y el reintento con el mismo UUID resuelve «ya registrado» sin duplicar', async () => {
  const f = createShelfFixture(); f.state.loseResponses = 1;
  const first = await f.submitStockOperationRaw(entry(U(2)));
  assert.deepEqual([first.ok, first.uncertain, first.message], [false, true, UNCERTAIN]); assert.equal(stockAt(f, 73), 10, 'la primera escritura SÍ se aplicó'); assert.equal(rows(f, U(2)).length, 1);
  const paths = f.state.paths.length; const retry = await f.submitStockOperationRaw(entry(U(2)));
  assert.deepEqual([retry.ok, retry.duplicate, retry.uncertain], [true, true, undefined]);
  assert.match(retry.message, /^Este movimiento ya estaba registrado; no se duplicó\. Registrado el .*2026/);
  assert.equal(stockAt(f, 73), 10, 'el stock no se aplicó dos veces'); assert.equal(rows(f, U(2)).length, 1);
  assert.ok(f.state.paths.length > paths && f.state.paths.includes(`/productos/${productId}`), 'la deduplicación ejecuta las mismas invalidaciones que un éxito');
});

test('las invalidaciones de una deduplicación son las mismas que las de un éxito normal', async () => {
  const normal = createShelfFixture(); await normal.submitStockOperationRaw(entry(U(3)));
  const dup = createShelfFixture(); dup.state.loseResponses = 1; await dup.submitStockOperationRaw(entry(U(3))); dup.state.paths.length = 0; await dup.submitStockOperationRaw(entry(U(3)));
  assert.deepEqual([...new Set(dup.state.paths)].sort(), [...new Set(normal.state.paths)].sort());
});

test('fallo de transporte sin aplicar: incierto; el reintento con el mismo UUID se aplica UNA sola vez y no es «duplicado»', async () => {
  const f = createShelfFixture(); f.state.transportErrors = 1;
  const first = await f.submitStockOperationRaw(entry(U(4))); assert.deepEqual([first.ok, first.uncertain], [false, true]); assert.equal(stockAt(f, 73), 7); assert.equal(rows(f, U(4)).length, 0);
  const retry = await f.submitStockOperationRaw(entry(U(4))); assert.deepEqual([retry.ok, retry.duplicate], [true, undefined]); assert.equal(stockAt(f, 73), 10); assert.equal(rows(f, U(4)).length, 1);
});

test('23505 + relectura: coincidencia → éxito; otros datos → error definitivo; relectura fallida o fila ausente → incierto, nunca éxito', async () => {
  const f = createShelfFixture(); await f.submitStockOperationRaw(entry(U(5)));
  for (const other of [{ cantidad: 4 }, { destinoId: 74 }, { productoId: secondProductId }]) {
    const mismatch = await f.submitStockOperationRaw(entry(U(5), other));
    assert.deepEqual([mismatch.ok, mismatch.uncertain], [false, undefined], JSON.stringify(other)); assert.match(mismatch.message, /ya se usó con otros datos/);
  }
  assert.equal(await f.submitStockOperationRaw({ tipo: 'retiro', productoId: productId, origenId: 73, cantidad: 3, solicitudId: U(5) }).then(r => r.ok), false, 'otro tipo con el mismo id');
  assert.equal(stockAt(f, 73), 10, 'ningún intento con otros datos cambió el stock'); assert.equal(rows(f, U(5)).length, 1);
  f.state.failTable = 'movimientos'; const unreadable = await f.submitStockOperationRaw(entry(U(5)));
  assert.deepEqual([unreadable.ok, unreadable.uncertain, unreadable.message], [false, true, UNCERTAIN], 'relectura fallida: sin éxito'); f.state.failTable = null;
  const alone = createShelfFixture(); alone.state.entryError = '23505'; // 23505 sin fila que lo respalde
  const noRow = await alone.submitStockOperationRaw(entry(U(6))); assert.deepEqual([noRow.ok, noRow.uncertain], [false, true]); assert.equal(stockAt(alone, 73), 7);
  const other = createShelfFixture(); other.state.insertErrorObject = { code: '23505', message: 'duplicate key value violates unique constraint "otra_restriccion_key"', details: 'Key (x)=(1) already exists.' };
  const foreign = await other.submitStockOperationRaw(entry(U(7))); assert.deepEqual([foreign.ok, foreign.uncertain], [false, undefined], 'un 23505 de otra restricción no se interpreta como deduplicación');
});

test('PGRST204 es incompatibilidad de esquema: error claro, sin reintento y sin degradar a movimientos sin UUID', async () => {
  const f = createShelfFixture(); f.state.schemaMismatch = true;
  const result = await f.submitStockOperationRaw(entry(U(8)));
  assert.deepEqual([result.ok, result.uncertain], [false, undefined]); assert.match(result.message, /todavía no está preparado/); assert.doesNotMatch(result.message, /PGRST|solicitud_id|schema/i, 'sin detalles internos');
  assert.equal(f.state.writes.length, 1, 'un solo intento'); assert.ok(f.state.writes.every(write => write.solicitud_id), 'nunca se envía un movimiento sin solicitud_id'); assert.equal(stockAt(f, 73), 7);
});

test('errores sin código y excepciones son inciertos; los rechazos conocidos son definitivos y no consumen el UUID', async () => {
  const f = createShelfFixture(); f.state.insertThrows = true;
  const thrown = await f.submitStockOperationRaw(entry(U(9))); assert.deepEqual([thrown.ok, thrown.uncertain, thrown.message], [false, true, UNCERTAIN]); f.state.insertThrows = false;
  const short = await f.submitStockOperationRaw(withdrawal(U(1), { cantidad: 100 })); assert.deepEqual([short.ok, short.uncertain], [false, undefined]); assert.match(short.message, /No hay stock suficiente/);
  assert.equal(rows(f, U(1)).length, 0, 'el rechazo no deja fila'); assert.equal(stockAt(f, 73), 7);
  const valid = await f.submitStockOperationRaw(withdrawal(U(1))); assert.equal(valid.ok, true, 'el mismo UUID funciona tras un rechazo definitivo'); assert.equal(stockAt(f, 73), 5);
  for (const [code, text] of [['40001', /El stock cambió/], ['23503', /ya no existe/], ['22023', /Revisa la cantidad/], ['42501', /No fue posible completar/]]) {
    const g = createShelfFixture(); g.state.entryError = code; const r = await g.submitStockOperationRaw(entry(U(2))); assert.deepEqual([r.ok, r.uncertain], [false, undefined], code); assert.match(r.message, text);
  }
  const rpc = createShelfFixture(); rpc.state.client.rpc = async () => { throw new Error('boom'); };
  const adjust = await rpc.submitStockOperationRaw({ tipo: 'ajuste', productoId: productId, origenId: 73, cantidadFisica: 1, cantidadEsperada: 7 }); assert.deepEqual([adjust.ok, adjust.uncertain, adjust.message], [false, undefined, 'No fue posible completar el movimiento. Inténtalo nuevamente.']);
});

test('dos operaciones legítimas idénticas con UUID distintos: dos movimientos y dos aplicaciones', async () => {
  const f = createShelfFixture(); assert.equal((await f.submitStockOperationRaw(withdrawal(U(1)))).ok, true); assert.equal((await f.submitStockOperationRaw(withdrawal(U(2)))).ok, true);
  assert.equal(stockAt(f, 73), 3); assert.equal(f.state.tables.movimientos.length, 2); assert.equal(new Set(f.state.tables.movimientos.map(row => row.solicitud_id)).size, 2);
});

test('traslado: se repite con el mismo UUID y origen/destino cambian una sola vez', async () => {
  const f = createShelfFixture(); f.state.loseResponses = 1; const transfer = { tipo: 'traslado', productoId: productId, origenId: 73, destinoId: 96, cantidad: 2, solicitudId: U(3) };
  assert.equal((await f.submitStockOperationRaw(transfer)).uncertain, true); assert.equal((await f.submitStockOperationRaw(transfer)).duplicate, true);
  assert.deepEqual([stockAt(f, 73), stockAt(f, 96)], [5, 14]); assert.equal(rows(f, U(3)).length, 1);
});

test('invariante: una misma solicitud nunca produce más de un movimiento ni más de una aplicación de stock', async () => {
  const f = createShelfFixture(); const before = stockAt(f, 73); const attempts = ['lose', 'ok', 'ok', 'transport', 'lose', 'ok'];
  for (const [index, kind] of attempts.entries()) {
    f.state.loseResponses = kind === 'lose' ? 1 : 0; f.state.transportErrors = kind === 'transport' ? 1 : 0;
    await f.submitStockOperationRaw(entry(U(8), { cantidad: 5 })); assert.ok(rows(f, U(8)).length <= 1, `intento ${index}`); assert.ok(stockAt(f, 73) - before <= 5, `intento ${index}`);
  }
  assert.equal(rows(f, U(8)).length, 1); assert.equal(stockAt(f, 73), before + 5);
});
