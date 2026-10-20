// UI09a/C1-A: el botón «Reintentar» del límite de error del espacio de trabajo usa la clase visual común y llama a `retry`
// (vuelve a consultar y renderizar; `reset` solo limpiaba el estado). La recuperación real se prueba en error-boundary.browser.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app/(workspace)/error.tsx', import.meta.url), 'utf8');

test('Reintentar usa catalog-button primary y llama a retry, no a reset', () => {
  assert.match(source, /onClick=\{retry\}\s+className="catalog-button primary"/);
  assert.doesNotMatch(source, /onClick=\{reset\}|\breset\b/);
  assert.doesNotMatch(source, /primary-button/);
  assert.match(source, /retry: \(\) => void/);
});
