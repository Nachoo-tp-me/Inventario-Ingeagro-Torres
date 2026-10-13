import assert from "node:assert/strict";
import test from "node:test";
import { getStockMenuPosition } from "../lib/stock-menu-position.ts";

const menu = { width: 135, height: 172 };

test("abre debajo y alinea el borde derecho en escritorio", () => {
  assert.deepEqual(getStockMenuPosition(
    { left: 700, right: 780, top: 200, bottom: 240 }, menu,
    { left: 0, right: 1280, top: 0, bottom: 800 },
  ), { left: 645, top: 244, maxHeight: 548 });
});

for (const width of [360, 390]) {
  test(`abre encima de la navegación móvil a ${width}px`, () => {
    const result = getStockMenuPosition(
      { left: width - 90, right: width - 16, top: 550, bottom: 590 }, menu,
      { left: 0, right: width, top: 0, bottom: 620 },
    );
    assert.equal(result.top, 374);
    assert.equal(result.left, width - 151);
    assert.ok(result.top + menu.height < 620);
  });
}

test("limita el alto al lado con más espacio en una pantalla corta", () => {
  assert.deepEqual(getStockMenuPosition(
    { left: 0, right: 80, top: 80, bottom: 120 }, menu,
    { left: 0, right: 360, top: 0, bottom: 220 },
  ), { left: 8, top: 124, maxHeight: 88 });
});

test("respeta los límites desplazados del viewport visual", () => {
  const result = getStockMenuPosition(
    { left: 80, right: 160, top: 400, bottom: 440 }, menu,
    { left: 70, right: 430, top: 300, bottom: 700 },
  );
  assert.deepEqual(result, { left: 78, top: 444, maxHeight: 248 });
});
