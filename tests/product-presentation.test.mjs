import assert from "node:assert/strict";
import test from "node:test";
import { locationsLabel, unitsLabel } from "../lib/product-presentation.ts";

test("unidades: singular, plural, cero y miles", () => {
  assert.equal(unitsLabel(0), "0 unidades");
  assert.equal(unitsLabel(1), "1 unidad");
  assert.equal(unitsLabel(2), "2 unidades");
  assert.equal(unitsLabel(26), "26 unidades");
  assert.equal(unitsLabel(12345), "12.345 unidades");
});

test("ubicaciones: sin stock explícito, singular y plural", () => {
  assert.equal(locationsLabel(0), "Sin stock");
  assert.equal(locationsLabel(1), "1 ubicación");
  assert.equal(locationsLabel(6), "6 ubicaciones");
});
