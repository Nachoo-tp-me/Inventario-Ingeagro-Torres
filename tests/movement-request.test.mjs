// C2b: identidad de la solicitud de movimiento (puro). Un UUID por operación lógica, reutilizado solo en reintentos inciertos
// con la misma huella y descartado tras cualquier resultado definitivo; generador seguro sin Math.random().
import assert from 'node:assert/strict';
import test from 'node:test';
import { createIdentityStore, formatMovementDate, movementFingerprint, normalizeSolicitudId, secureUuid } from '../lib/movement-request.ts';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('normalizeSolicitudId: minúsculas y solo UUID válidos', () => {
  assert.equal(normalizeSolicitudId('6F1D2C3A-4B5E-4F60-8A71-92B3C4D5E6F7'), '6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7');
  assert.equal(normalizeSolicitudId(' 6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7 '), '6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7');
  for (const bad of ['', 'abc', '6f1d2c3a4b5e4f608a7192b3c4d5e6f7', '6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f', '6f1d2c3a-4b5e-0f60-8a71-92b3c4d5e6f7', '6f1d2c3a-4b5e-4f60-1a71-92b3c4d5e6f7', "x'; drop table movimientos;--", null, undefined, 42, {}])
    assert.equal(normalizeSolicitudId(bad), null, String(bad));
});

test('secureUuid: randomUUID si existe, getRandomValues como alternativa v4 y null sin fuente segura; nunca Math.random', () => {
  const originalRandom = Math.random; Math.random = () => { throw new Error('Math.random no debe usarse'); };
  try {
    assert.equal(secureUuid({ randomUUID: () => '11111111-2222-4333-8444-555555555555' }), '11111111-2222-4333-8444-555555555555');
    let seed = 0; const fill = bytes => { for (let i = 0; i < bytes.length; i++) bytes[i] = (seed += 37) & 0xff; return bytes; };
    const fallback = secureUuid({ getRandomValues: fill }); assert.match(fallback, V4);
    assert.match(secureUuid({ randomUUID: () => { throw new Error('no disponible'); }, getRandomValues: fill }), V4, 'si randomUUID falla usa getRandomValues');
    const ids = new Set(Array.from({ length: 200 }, () => secureUuid({ getRandomValues: bytes => globalThis.crypto.getRandomValues(bytes) }))); assert.equal(ids.size, 200);
    assert.equal(secureUuid({}), null); assert.equal(secureUuid(undefined) === null || V4.test(secureUuid(undefined)), true);
    assert.match(secureUuid(), V4, 'el crypto del entorno genera v4');
  } finally { Math.random = originalRandom; }
});

test('movementFingerprint cambia con tipo, producto, origen, destino y cantidad', () => {
  const base = { tipo: 'traslado', productoId: 'p', origenId: 1, destinoId: 2, cantidad: 3 };
  const same = movementFingerprint(base); assert.equal(movementFingerprint({ ...base }), same);
  for (const change of [{ tipo: 'retiro' }, { productoId: 'q' }, { origenId: 9 }, { destinoId: 9 }, { cantidad: 4 }])
    assert.notEqual(movementFingerprint({ ...base, ...change }), same, JSON.stringify(change));
  assert.notEqual(movementFingerprint({ tipo: 'entrada', productoId: 'p', destinoId: 1, cantidad: 1 }), movementFingerprint({ tipo: 'retiro', productoId: 'p', origenId: 1, cantidad: 1 }));
});

test('identidad: se reutiliza solo con la misma huella mientras el resultado es incierto', () => {
  let n = 0; const store = createIdentityStore(() => `id-${++n}`);
  assert.equal(store.retained, false);
  const first = store.acquire('a'); assert.equal(first, 'id-1'); assert.equal(store.retained, true);
  assert.equal(store.acquire('a'), 'id-1', 'reintento incierto: mismo id'); assert.equal(store.acquire('a'), 'id-1');
  assert.equal(store.acquire('b'), 'id-2', 'cualquier cambio de datos: otra solicitud'); assert.equal(store.acquire('a'), 'id-3', 'volver a los datos anteriores NO reutiliza el id viejo');
});

test('identidad: tras éxito, deduplicación o error definitivo se descarta; dos operaciones idénticas sucesivas reciben UUID distintos', () => {
  let n = 0; const store = createIdentityStore(() => `id-${++n}`);
  const first = store.acquire('retiro|p|1||3'); store.release(); assert.equal(store.retained, false);
  const second = store.acquire('retiro|p|1||3'); assert.notEqual(second, first, 'misma operación legítima, segunda vez: otro UUID');
  store.release(); store.release(); assert.equal(store.acquire('x'), 'id-3');
});

test('identidad: sin fuente segura no se genera nada y la operación queda bloqueada', () => {
  const store = createIdentityStore(() => null); assert.equal(store.acquire('a'), null); assert.equal(store.retained, false);
  let allow = false; const flaky = createIdentityStore(() => allow ? 'ok' : null); assert.equal(flaky.acquire('a'), null); allow = true; assert.equal(flaky.acquire('a'), 'ok');
});

test('formatMovementDate usa la zona de Santiago y rechaza fechas inválidas', () => {
  assert.match(formatMovementDate('2026-10-20T13:30:00.000Z'), /2026/); assert.equal(formatMovementDate('no es una fecha'), null);
  assert.notEqual(formatMovementDate('2026-10-20T03:00:00.000Z'), formatMovementDate('2026-10-20T04:30:00.000Z'));
});
