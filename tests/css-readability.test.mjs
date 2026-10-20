// UI09a: guarda estática de legibilidad. Ninguna hoja de estilos de V2 declara texto por debajo de 12 px
// (token --text-help) ni valores relativos equivalentes; las excepciones, si existieran, deben listarse aquí con motivo.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const FILES = ['app/globals.css', 'app/theme.css', 'app/catalog.css', 'app/stock.css', 'app/rapid.css', 'app/home.css', 'app/shelves.css', 'app/exports.css', 'components/tower-view.css'];
const EXCEPTIONS = new Map(); // «archivo:declaración» → motivo documentado

test('ninguna hoja declara font-size inferior a 12 px', () => {
  const found = [];
  for (const file of FILES) {
    const css = readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [declaration, value, unit] of css.matchAll(/font-size:\s*([\d.]+)(px|rem|em)/g).map(m => [m[0], Number(m[1]), m[2]])) {
      const px = unit === 'px' ? value : value * 16;
      if (px > 0 && px < 12 && !EXCEPTIONS.has(`${file}:${declaration}`)) found.push(`${file}: ${declaration}`);
    }
  }
  assert.deepEqual(found, []);
});

test('el token de ayuda sigue siendo 12 px', () => {
  assert.match(readFileSync(new URL('../app/theme.css', import.meta.url), 'utf8'), /--text-help:\s*12px/);
});
