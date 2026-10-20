// C2a: clasificación de resultados de escritura y veredictos de relectura (puro, sin red). Un error sin código nunca es un
// rechazo confirmado; una fila ausente no prueba que una escritura en vuelo no llegará; una foto referenciada no se borra.
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyWriteError, referencesPath, removalDecision, writeVerdict } from '../lib/product-save-model.ts';

const network = { code: '', message: 'TypeError: fetch failed', details: '', hint: '' };
const row = (extra = {}) => ({ id: 'p-1', nombre: 'Sensor', categoria_id: 'c-1', descripcion: null, foto_ruta: 'p-1/a.png', actualizado_en: '2026-10-20T10:00:00.000Z', ...extra });
const intended = { nombre: 'Sensor', categoria_id: 'c-1', descripcion: null, foto_ruta: 'p-1/a.png' };

test('classifyWriteError: solo los rechazos de la base de datos son definitivos', () => {
  for (const code of ['23505', '23514', '23503', '22023', '42501', '42P01', '40001', '40P01', '28000', 'P0001', '55000', '57014', 'PGRST100', 'PGRST116', 'PGRST301'])
    assert.equal(classifyWriteError({ code, message: 'x' }), 'definitive', code);
  for (const error of [network, { message: 'Bad gateway' }, { code: '500' }, { code: '502' }, { code: '08006' }, { code: '53300' }, { code: '57P01' }, { code: 'XX000' }, { code: 'PGRST000' }, { code: 'PGRST003x' },
    new TypeError('fetch failed'), 'texto', null, undefined, 42, {}])
    assert.equal(classifyWriteError(error), 'uncertain', JSON.stringify(error));
});

test('writeVerdict alta: aplicada solo si la fila coincide; ausente = no aplicada (todavía); otra fila = conflicto', () => {
  assert.equal(writeVerdict('create', { status: 'row', row: row() }, intended), 'applied');
  assert.equal(writeVerdict('create', { status: 'row', row: row({ nombre: 'Otro' }) }, intended), 'conflict', 'un 23505 con otros datos no es éxito');
  assert.equal(writeVerdict('create', { status: 'row', row: row({ foto_ruta: null }) }, intended), 'conflict');
  assert.equal(writeVerdict('create', { status: 'row', row: row({ descripcion: 'x' }) }, intended), 'conflict');
  assert.equal(writeVerdict('create', { status: 'absent' }, intended), 'not-applied');
  assert.equal(writeVerdict('create', { status: 'failed' }, intended), 'unknown');
  assert.equal(writeVerdict('create', { status: 'row', row: row({ descripcion: null }) }, { ...intended, descripcion: null }), 'applied');
});

test('writeVerdict edición: aplicada con datos iguales y nuevo actualizado_en; sin cambio = no aplicada; distinto = conflicto', () => {
  const initial = '2026-10-19T12:00:00.000Z';
  assert.equal(writeVerdict('update', { status: 'row', row: row() }, intended, initial), 'applied');
  assert.equal(writeVerdict('update', { status: 'row', row: row({ actualizado_en: initial, nombre: 'Anterior' }) }, intended, initial), 'not-applied');
  assert.equal(writeVerdict('update', { status: 'row', row: row({ actualizado_en: '2026-10-20T11:00:00.000Z', nombre: 'Otra sesión' }) }, intended, initial), 'conflict');
  assert.equal(writeVerdict('update', { status: 'row', row: row({ actualizado_en: initial }) }, intended, initial), 'not-applied', 'mismo actualizado_en: la escritura no se aplicó');
  assert.equal(writeVerdict('update', { status: 'absent' }, intended, initial), 'unknown');
  assert.equal(writeVerdict('update', { status: 'failed' }, intended, initial), 'unknown');
});

test('removalDecision: solo se borra con evidencia positiva de que nada referencia el archivo', () => {
  assert.equal(removalDecision({ status: 'failed' }, 'p-1/a.png'), 'keep-unverified', 'sin relectura no se borra');
  assert.equal(removalDecision({ status: 'row', row: row() }, 'p-1/a.png'), 'keep-referenced');
  assert.equal(removalDecision({ status: 'row', row: row({ foto_ruta: 'p-1/b.png' }) }, 'p-1/a.png'), 'remove');
  assert.equal(removalDecision({ status: 'row', row: row({ foto_ruta: null }) }, 'p-1/a.png'), 'remove');
  assert.equal(removalDecision({ status: 'absent' }, 'p-1/a.png'), 'remove');
  assert.equal(referencesPath({ status: 'row', row: row() }, 'p-1/a.png'), true); assert.equal(referencesPath({ status: 'absent' }, 'p-1/a.png'), false);
});
