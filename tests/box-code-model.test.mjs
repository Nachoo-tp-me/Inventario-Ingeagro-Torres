import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBoxCode, validateBoxCode } from "../lib/box-code-model.ts";

test("códigos de caja: normalización ASCII idéntica al contrato SQL", () => {
  assert.equal(normalizeBoxCode(' a6 '), 'A6');
  for (const value of ['A6','b10',' MOTORES_1 ','C_MOTOR','7','X'.repeat(24)]) assert.equal(validateBoxCode(value), null);
  for (const value of ['', ' ', 'X'.repeat(25), '-A1', '_A1', 'A 1', 'A.1', 'MÓDULO', 'ß', 'ı', 'Ａ1', '\tA1', '\u00a0A1', 'A1\n', null, {}]) assert.ok(validateBoxCode(value), String(value));
  assert.equal(normalizeBoxCode('ß'), 'ß');
});

test("reserva completa de C seguido solo de números", () => {
  for (const value of ['C1','C123','C999','c999',' C0 ']) assert.match(validateBoxCode(value), /reservados/);
  assert.equal(validateBoxCode('C1_A'), null);
  assert.equal(validateBoxCode('CABC'), null);
});
