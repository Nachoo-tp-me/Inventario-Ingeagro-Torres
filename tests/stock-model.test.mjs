import assert from "node:assert/strict";
import test from "node:test";
import { parseQuantity, validateStockOperation } from "../lib/stock-model.ts";

const product = "00000000-0000-0000-0000-000000000001";

test("solo acepta cantidades enteras válidas", () => {
  assert.equal(parseQuantity(" 17 "), 17);
  for (const value of ["", "0", "-1", "1.5", "1e3", "2147483648"])
    assert.equal(parseQuantity(value), null);
  assert.equal(parseQuantity("0", true), 0);
});

test("valida ubicaciones, traslado y conteo físico", () => {
  assert.equal(validateStockOperation({ tipo: "entrada", productoId: product, destinoId: 1, cantidad: 10 }), null);
  assert.equal(validateStockOperation({ tipo: "retiro", productoId: product, origenId: 1, cantidad: 4 }), null);
  assert.match(validateStockOperation({ tipo: "traslado", productoId: product, origenId: 1, destinoId: 1, cantidad: 7 }), /diferente/);
  assert.equal(validateStockOperation({ tipo: "traslado", productoId: product, origenId: 1, destinoId: 2, cantidad: 7 }), null);
  assert.match(validateStockOperation({ tipo: "ajuste", productoId: product, origenId: 1, cantidadFisica: -1, cantidadEsperada: 7 }), /igual o mayor/);
  assert.equal(validateStockOperation({ tipo: "ajuste", productoId: product, origenId: 1, cantidadFisica: 0, cantidadEsperada: 7 }), null);
});
