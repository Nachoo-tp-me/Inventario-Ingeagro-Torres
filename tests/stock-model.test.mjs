import assert from "node:assert/strict";
import test from "node:test";
import { parseQuantity, validateStockOperation, toPhysicalLocation, physicalLocationContext } from "../lib/stock-model.ts";

const product = "00000000-0000-0000-0000-000000000001";

test("solo acepta cantidades enteras válidas", () => {
  assert.equal(parseQuantity(" 17 "), 17);
  for (const value of ["", "0", "-1", "1.5", "1e3", "2147483648"])
    assert.equal(parseQuantity(value), null);
  assert.equal(parseQuantity("0", true), 0);
});

test("ubicación común: IDs permanentes y contexto sin torre ficticia para cajas", () => {
  const tower = toPhysicalLocation({ id: 1, codigo: "C111", tipo: "compartimiento", torre_id: 1, piso: 1, estante_id: null, posicion: 1 });
  assert.equal(physicalLocationContext(tower), "Torre C1 · Piso 1 · Compartimiento 1");
  for (const [index, position] of ["Superior izquierda", "Superior derecha", "Inferior izquierda", "Inferior derecha"].entries()) {
    const row = { id: 73 + index, codigo: `A${index + 1}`, tipo: "caja", torre_id: null, piso: null, estante_id: 1, posicion: index + 1 };
    const box = toPhysicalLocation(row);
    assert.equal(box.id, row.id);
    assert.equal("torre_id" in box, false);
    assert.equal("piso" in box, false);
    assert.equal(physicalLocationContext(box), `Estante 1 · ${position}`);
    assert.equal(toPhysicalLocation({ ...row, codigo: "MOTORES_1" }).id, box.id);
    for (const invalid of [{ posicion: 0 }, { posicion: 5 }, { torre_id: 1 }, { piso: 1 }, { estante_id: null }, { tipo: "otro" }, { id: Number.MAX_SAFE_INTEGER + 1 }]) {
      assert.throws(() => toPhysicalLocation({ ...row, ...invalid }), /inválida/);
    }
  }
});

test("stock admite IDs de cajas y rechaza IDs sin representación exacta", () => {
  for (const [source, destination] of [[1, 73], [73, 1], [73, 96], [1, 25]]) {
    assert.equal(validateStockOperation({ tipo: "traslado", productoId: product, origenId: source, destinoId: destination, cantidad: 2 }), null);
  }
  for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "73", null]) {
    assert.ok(validateStockOperation({ tipo: "entrada", productoId: product, destinoId: id, cantidad: 1 }));
    assert.ok(validateStockOperation({ tipo: "ajuste", productoId: product, origenId: id, cantidadFisica: 1, cantidadEsperada: 0 }));
  }
});

test("valida ubicaciones, traslado y conteo físico", () => {
  assert.equal(validateStockOperation({ tipo: "entrada", productoId: product, destinoId: 1, cantidad: 10 }), null);
  assert.equal(validateStockOperation({ tipo: "retiro", productoId: product, origenId: 1, cantidad: 4 }), null);
  assert.match(validateStockOperation({ tipo: "traslado", productoId: product, origenId: 1, destinoId: 1, cantidad: 7 }), /diferente/);
  assert.equal(validateStockOperation({ tipo: "traslado", productoId: product, origenId: 1, destinoId: 2, cantidad: 7 }), null);
  assert.match(validateStockOperation({ tipo: "ajuste", productoId: product, origenId: 1, cantidadFisica: -1, cantidadEsperada: 7 }), /igual o mayor/);
  assert.equal(validateStockOperation({ tipo: "ajuste", productoId: product, origenId: 1, cantidadFisica: 0, cantidadEsperada: 7 }), null);
});
