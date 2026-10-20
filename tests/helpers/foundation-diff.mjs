// Comparador determinista de referencias visuales V2 (UI09b). SOLO LEE: nunca escribe ni regenera referencias.
// Compara el `identity` (enlaces, campos, botones) de dos informes de `ui-foundation` (before.json / after.json),
// clasifica cada cambio frente a reglas PROPUESTAS (aún sin aprobación individual final) y, por separado, compara los
// estados operativos de ocupación en TODAS las capturas (la fase histórica `after` aborta antes de comprobarlos
// cuando falla la identidad). Sin dependencias: solo node:fs / node:path.
//
//   node tests/helpers/foundation-diff.mjs --before <before.json> --after <after.json> \
//        [--rules tests/fixtures/ui-v2-proposed-differences.json] [--out <informe.json>] [--md <informe.md>]
// Código de salida: 0 solo si no hay diferencias sin explicar ni diferencias operativas; 1 en otro caso.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ARRAYS = ['links', 'fields', 'buttons'];
const CHANGES = ['added', 'removed', 'reordered'];
export const parseKey = key => { const m = /^(light|dark)-(\d+)-(.+)$/.exec(key); if (!m) throw new Error(`Clave de captura inválida: ${key}`); return { theme: m[1], width: Number(m[2]), scene: m[3] }; };

const multiset = items => { const map = new Map(); for (const item of items) { const s = JSON.stringify(item); map.set(s, (map.get(s) ?? 0) + 1); } return map; };

/** Diferencias de identidad de una captura: elementos añadidos/retirados (con multiplicidad) o reordenados. */
export function diffIdentity(before, after) {
  const out = [];
  for (const array of ARRAYS) {
    const a = before?.[array] ?? [], b = after?.[array] ?? [];
    const ma = multiset(a), mb = multiset(b);
    for (const s of new Set([...ma.keys(), ...mb.keys()])) {
      const delta = (mb.get(s) ?? 0) - (ma.get(s) ?? 0);
      if (delta) out.push({ array, change: delta > 0 ? 'added' : 'removed', element: JSON.parse(s), count: Math.abs(delta) });
    }
    if (!out.some(d => d.array === array) && JSON.stringify(a) !== JSON.stringify(b)) out.push({ array, change: 'reordered', element: null, count: 1 });
  }
  return out;
}

/** Misma proyección que la fase histórica: color/borde solo donde se pintan. */
export function paintedStates(items) {
  return (items ?? []).map(item => ({ cls: item.cls, background: item.background,
    ...(['compartment-button', 'top-view-sector', 'metric-icon', 'sheet-status'].some(name => item.cls.includes(name)) ? { color: item.color, border: item.border } : {}) }));
}
export function compareOperational(before, after) {
  const diffs = [];
  for (const key of Object.keys(before)) {
    if (!after[key]) { diffs.push({ key, reason: 'captura ausente' }); continue; }
    if (JSON.stringify(paintedStates(before[key].operational)) !== JSON.stringify(paintedStates(after[key].operational))) diffs.push({ key, reason: 'estados operativos distintos' });
  }
  return { captures: Object.keys(before).length, diffs };
}

/** Reglas específicas: escenas explícitas y elementos exactos; sin comodines. Lanza ante cualquier regla ambigua. */
export function validateRules(rules) {
  if (!rules || !Array.isArray(rules.rules) || !rules.rules.length) throw new Error('El archivo de reglas no contiene `rules`.');
  const ids = new Set();
  for (const rule of rules.rules) {
    const where = `regla ${rule?.id ?? '(sin id)'}`;
    for (const field of ['id', 'block', 'commit', 'description', 'justification']) if (typeof rule[field] !== 'string' || !rule[field].trim()) throw new Error(`${where}: falta ${field}`);
    if (ids.has(rule.id)) throw new Error(`${where}: id duplicado`); ids.add(rule.id);
    if (!/^[0-9a-f]{7,40}$/.test(rule.commit)) throw new Error(`${where}: commit inválido`);
    if (!ARRAYS.includes(rule.array)) throw new Error(`${where}: array inválido`);
    if (!CHANGES.includes(rule.change)) throw new Error(`${where}: change inválido`);
    if (!Array.isArray(rule.scenes) || !rule.scenes.length || rule.scenes.some(s => typeof s !== 'string' || /[*?\[\]()|^$]/.test(s) || !s.trim())) throw new Error(`${where}: las escenas deben ser nombres explícitos (sin comodines)`);
    if (rule.change !== 'reordered' && (!Array.isArray(rule.elements) || !rule.elements.length || rule.elements.some(e => !Array.isArray(e) || e.length !== 2))) throw new Error(`${where}: elements debe listar tuplas exactas`);
    if (rule.change !== 'reordered' && rule.elements.some(e => e.some(v => typeof v === 'string' && v.includes('*')))) throw new Error(`${where}: sin comodines en los elementos`);
    for (const key of ['themes', 'widths']) if (rule[key] !== undefined && (!Array.isArray(rule[key]) || !rule[key].length)) throw new Error(`${where}: ${key} debe ser una lista no vacía`);
  }
  return rules;
}

const matches = (rule, diff, info) => rule.array === diff.array && rule.change === diff.change && rule.scenes.includes(info.scene)
  && (!rule.themes || rule.themes.includes(info.theme)) && (!rule.widths || rule.widths.includes(info.width))
  && (diff.change === 'reordered' || rule.elements.some(e => JSON.stringify(e) === JSON.stringify(diff.element))) && (rule.count ?? 1) === diff.count;

/** Clasifica cada diferencia de identidad (por captura = escena × tema × ancho) frente a las reglas propuestas. */
export function classify(before, after, rulesFile) {
  const rules = validateRules(rulesFile).rules;
  const keys = Object.keys(before);
  const extra = Object.keys(after).filter(key => !(key in before));
  const differences = [], usedRules = new Map(rules.map(r => [r.id, 0]));
  const capturesWithDifferences = new Set(), capturesUnexplained = new Set();
  for (const key of keys) {
    const info = parseKey(key);
    if (!after[key]) { differences.push({ key, ...info, array: '-', change: 'missing', element: null, count: 1, rule: null, status: 'sin explicar' }); capturesWithDifferences.add(key); capturesUnexplained.add(key); continue; }
    for (const diff of diffIdentity(before[key].identity, after[key].identity)) {
      const rule = rules.find(candidate => matches(candidate, diff, info));
      if (rule) usedRules.set(rule.id, usedRules.get(rule.id) + 1);
      differences.push({ key, ...info, ...diff, rule: rule?.id ?? null, block: rule?.block ?? null, commit: rule?.commit ?? null, status: rule ? 'explicada' : 'sin explicar' });
      capturesWithDifferences.add(key); if (!rule) capturesUnexplained.add(key);
    }
  }
  const operational = compareOperational(before, after);
  const unexplained = differences.filter(d => d.status === 'sin explicar');
  return {
    captures: keys.length, extraCapturesInAfter: extra,
    capturesWithIdentityDifferences: capturesWithDifferences.size, capturesUnexplained: capturesUnexplained.size,
    elementChanges: differences.length, explained: differences.length - unexplained.length, unexplained,
    unusedRules: [...usedRules].filter(([, n]) => !n).map(([id]) => id), ruleUse: Object.fromEntries(usedRules),
    operational, differences,
    verdict: !unexplained.length && !operational.diffs.length && !extra.length ? 'CONCILIABLE' : 'BLOQUEADO',
  };
}

export function markdownReport(result, meta = {}) {
  const lines = [`# Conciliación de identidad ui-foundation (reglas propuestas)`, '',
    ...Object.entries(meta).map(([k, v]) => `- ${k}: ${v}`), '',
    `- Capturas comparadas: ${result.captures}`, `- Capturas con diferencias de identidad: ${result.capturesWithIdentityDifferences}`,
    `- Cambios de elemento: ${result.elementChanges} (explicados ${result.explained}, sin explicar ${result.unexplained.length})`,
    `- Capturas con alguna diferencia sin explicar: ${result.capturesUnexplained}`,
    `- Diferencias operativas (ocupación): ${result.operational.diffs.length} en ${result.operational.captures} capturas`,
    `- Reglas sin uso: ${result.unusedRules.length ? result.unusedRules.join(', ') : 'ninguna'}`, `- Veredicto: **${result.verdict}**`, '',
    '## Uso de reglas (cambios de elemento por regla)', '', '| Regla | Cambios |', '|---|---|', ...Object.entries(result.ruleUse).map(([id, n]) => `| ${id} | ${n} |`), '',
    '## Capturas con diferencias', '', '| Captura | Cambios | Reglas | Estado |', '|---|---|---|---|'];
  const byKey = new Map();
  for (const d of result.differences) { const e = byKey.get(d.key) ?? { n: 0, rules: new Set(), bad: 0 }; e.n++; if (d.rule) e.rules.add(d.rule); else e.bad++; byKey.set(d.key, e); }
  for (const [key, e] of byKey) lines.push(`| ${key} | ${e.n} | ${[...e.rules].join(', ') || '—'} | ${e.bad ? 'SIN EXPLICAR' : 'explicada'} |`);
  if (result.unexplained.length) { lines.push('', '## Diferencias sin explicar', ''); for (const d of result.unexplained) lines.push(`- ${d.key}: ${d.array} ${d.change} ${JSON.stringify(d.element)}`); }
  return lines.join('\n') + '\n';
}

function cli(argv) {
  const get = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes('--help') || !get('--before') || !get('--after')) { console.log('Uso: node tests/helpers/foundation-diff.mjs --before <before.json> --after <after.json> [--rules <json>] [--out <json>] [--md <md>]'); return 2; }
  const rulesPath = get('--rules') ?? fileURLToPath(new URL('../fixtures/ui-v2-proposed-differences.json', import.meta.url));
  const result = classify(JSON.parse(readFileSync(get('--before'), 'utf8')), JSON.parse(readFileSync(get('--after'), 'utf8')), JSON.parse(readFileSync(rulesPath, 'utf8')));
  const { differences, ...summary } = result;
  console.log(JSON.stringify({ ...summary, unexplained: result.unexplained.length, operational: { captures: result.operational.captures, diffs: result.operational.diffs.length } }, null, 2));
  if (get('--out')) writeFileSync(get('--out'), JSON.stringify(result, null, 2));
  if (get('--md')) writeFileSync(get('--md'), markdownReport(result, { before: get('--before'), after: get('--after'), reglas: rulesPath }));
  return result.verdict === 'CONCILIABLE' ? 0 : 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = cli(process.argv.slice(2));
