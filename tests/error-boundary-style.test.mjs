// UI09a: el botón «Reintentar» del límite de error del espacio de trabajo usa la clase visual común y conserva su
// función de recuperación (reset) sin cambios.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app/(workspace)/error.tsx', import.meta.url), 'utf8');

test('Reintentar usa catalog-button primary y mantiene onClick={reset}', () => {
  assert.match(source, /onClick=\{reset\}\s+className="catalog-button primary"/);
  assert.doesNotMatch(source, /primary-button/);
  assert.match(source, /reset: \(\) => void/);
});
