// UI09b: pruebas del comparador determinista de referencias (tests/helpers/foundation-diff.mjs) con datos sintéticos
// y validación del archivo de reglas PROPUESTAS. No lee ni escribe referencias reales.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { classify, compareOperational, diffIdentity, validateRules, parseKey } from './helpers/foundation-diff.mjs';

const rulesFile = JSON.parse(readFileSync(new URL('./fixtures/ui-v2-proposed-differences.json', import.meta.url), 'utf8'));
const capture = (links = [], buttons = [], operational = [], fields = []) => ({ identity: { links, fields, buttons }, operational });
const rule = extra => ({ id: 'R1', block: 'UIxx', commit: 'abcdef1', array: 'links', change: 'added', scenes: ['home'], elements: [['/x', 'X']], description: 'd', justification: 'j', ...extra });

test('las reglas propuestas son válidas, específicas y no se presentan como aprobadas', () => {
  validateRules(rulesFile);
  assert.match(rulesFile._nota, /PROPUESTAS/); assert.match(rulesFile._nota, /Gepeto\/Nacho/);
  for (const r of rulesFile.rules) {
    assert.ok(r.scenes.every(s => /^[a-z-]+$/.test(s)), `${r.id}: escenas explícitas`);
    assert.ok(r.elements.every(e => e.length === 2 && !String(e[0]).includes('*')), `${r.id}: elementos exactos`);
    assert.ok(r.justification.length > 20 && r.commit.length >= 7);
  }
  assert.equal(new Set(rulesFile.rules.map(r => r.id)).size, rulesFile.rules.length);
});

test('validateRules rechaza comodines, escenas vacías y reglas sin commit', () => {
  assert.throws(() => validateRules({ rules: [rule({ scenes: ['*'] })] }), /comodines/);
  assert.throws(() => validateRules({ rules: [rule({ scenes: ['ho.*'] })] }), /comodines/);
  assert.throws(() => validateRules({ rules: [rule({ scenes: [] })] }), /explícitos/);
  assert.throws(() => validateRules({ rules: [rule({ commit: 'zzz' })] }), /commit/);
  assert.throws(() => validateRules({ rules: [rule({ elements: [['/x*', 'X']] })] }), /comodines/);
  assert.throws(() => validateRules({ rules: [rule(), rule()] }), /duplicado/);
  assert.throws(() => validateRules({ rules: [] }), /rules/);
});

test('diffIdentity detecta añadidos, retirados, multiplicidad y reordenaciones', () => {
  const d = diffIdentity({ links: [['/a', 'A'], ['/b', 'B']], buttons: [], fields: [] }, { links: [['/a', 'A'], ['/a', 'A'], ['/c', 'C']], buttons: [], fields: [] });
  assert.deepEqual(d.map(x => [x.change, x.element, x.count]).sort(), [['added', ['/a', 'A'], 1], ['added', ['/c', 'C'], 1], ['removed', ['/b', 'B'], 1]].sort());
  assert.deepEqual(diffIdentity({ links: [['/a', 'A'], ['/b', 'B']] }, { links: [['/b', 'B'], ['/a', 'A']] }), [{ array: 'links', change: 'reordered', element: null, count: 1 }]);
  assert.deepEqual(diffIdentity({ links: [], buttons: [], fields: [] }, { links: [], buttons: [], fields: [] }), []);
});

test('classify: explicada, sin explicar, regla sin uso y escena/tema distintos no coinciden', () => {
  const before = { 'light-390-home': capture(), 'dark-390-home': capture(), 'light-390-other': capture() };
  const after = { 'light-390-home': capture([['/x', 'X']]), 'dark-390-home': capture([['/x', 'X']]), 'light-390-other': capture([['/x', 'X']]) };
  const result = classify(before, after, { rules: [rule(), rule({ id: 'R2', scenes: ['nada'] })] });
  assert.equal(result.capturesWithIdentityDifferences, 3); assert.equal(result.explained, 2);
  assert.deepEqual(result.unexplained.map(d => d.key), ['light-390-other'], 'otra escena no queda cubierta por una regla de «home»');
  assert.deepEqual(result.unusedRules, ['R2']); assert.equal(result.verdict, 'BLOQUEADO');
  const limited = classify(before, after, { rules: [rule({ scenes: ['home', 'other'], themes: ['light'] })] });
  assert.deepEqual(limited.unexplained.map(d => d.key), ['dark-390-home'], 'los temas también se fijan');
  const exact = classify({ 'light-390-home': capture() }, { 'light-390-home': capture([['/x', 'X ']]) }, { rules: [rule()] });
  assert.equal(exact.unexplained.length, 1, 'un elemento casi igual no coincide');
});

test('classify: conciliable solo sin diferencias sin explicar ni operativas; las operativas se comprueban aunque falle identidad', () => {
  const op = (background) => [{ cls: 'compartment-button occupied', background, color: 'red', border: '1px' }];
  const before = { 'light-390-home': capture([], [], op('rgb(1, 1, 1)')) };
  const same = classify(before, { 'light-390-home': capture([['/x', 'X']], [], op('rgb(1, 1, 1)')) }, { rules: [rule()] });
  assert.equal(same.verdict, 'CONCILIABLE'); assert.equal(same.operational.diffs.length, 0);
  const painted = classify(before, { 'light-390-home': capture([['/x', 'X']], [], op('rgb(9, 9, 9)')) }, { rules: [rule()] });
  assert.equal(painted.unexplained.length, 0, 'la identidad está explicada…'); assert.equal(painted.operational.diffs.length, 1); assert.equal(painted.verdict, 'BLOQUEADO', '…pero un cambio de ocupación bloquea');
  assert.equal(compareOperational(before, {}).diffs[0].reason, 'captura ausente');
  assert.equal(classify(before, { 'light-390-home': capture([], [], op('rgb(1, 1, 1)')), 'light-390-extra': capture() }, { rules: [rule()] }).verdict, 'BLOQUEADO', 'una captura extra tampoco se acepta en silencio');
});

test('parseKey interpreta tema, ancho y escena', () => {
  assert.deepEqual(parseKey('dark-1280-catalog-hover'), { theme: 'dark', width: 1280, scene: 'catalog-hover' });
  assert.throws(() => parseKey('sepia-1-x'), /inválida/);
});
