import assert from "node:assert/strict";
import test from "node:test";
import { buildShelfSummaries, parsePhysicalId } from "../lib/shelf-model.ts";

const shelves = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, nombre: `Estante ${i + 1}`, grupo: i < 3 ? "A" : "B" }));
const boxes = Array.from({ length: 24 }, (_, i) => ({ tipo: "caja", id: 73 + i, estante_id: Math.floor(i / 4) + 1,
  posicion: i % 4 + 1, codigo: `${i < 12 ? "A" : "B"}${i % 12 + 1}` }));

test("seis estantes independientes con mapa 2x2 ordenado por posición, no por código", () => {
  const data = buildShelfSummaries([...shelves].reverse(), [...boxes].reverse(), []);
  assert.deepEqual(data.map(shelf => shelf.grupo), ["A", "A", "A", "B", "B", "B"]);
  assert.deepEqual(data.flatMap(shelf => shelf.cajas.map(box => box.codigo)), boxes.map(box => box.codigo));
  assert.ok(data.every(shelf => shelf.cajas.length === 4 && shelf.cajas.every(box => !box.ocupado && box.unidades === 0 && box.referencias === 0)));
  const renamed = buildShelfSummaries(shelves, boxes.map(box => box.id === 73 ? { ...box, codigo: "Z20" } : box), []);
  assert.equal(renamed[0].cajas[0].id, 73);
  assert.equal(renamed[0].cajas[0].codigo, "Z20");
  assert.equal(renamed[0].cajas[0].posicion, 1);
  assert.equal(renamed[0].grupo, "A");
});

test("estados y cantidades positivos aislados por caja, sin contar stock de torres", () => {
  const data = buildShelfSummaries(shelves, boxes, [
    { compartimiento_id: 73, producto_id: "p1", cantidad: 7 },
    { compartimiento_id: 73, producto_id: "p2", cantidad: 3 },
    { compartimiento_id: 74, producto_id: "p1", cantidad: 0 },
    { compartimiento_id: 96, producto_id: "p1", cantidad: 12 },
    { compartimiento_id: 1, producto_id: "p3", cantidad: 999 },
  ]);
  assert.deepEqual([data[0].cajas[0].ocupado, data[0].cajas[0].referencias, data[0].cajas[0].unidades], [true, 2, 10]);
  assert.equal(data[0].cajas[1].ocupado, false);
  assert.equal(data[5].cajas[3].unidades, 12);
  assert.equal(data.flatMap(shelf => shelf.cajas).reduce((sum, box) => sum + box.unidades, 0), 22);
});

test("rechaza topología incompleta/duplicada y parámetros de ruta inválidos", () => {
  assert.throws(() => buildShelfSummaries(shelves, boxes.slice(1), []), /cuatro posiciones/);
  assert.throws(() => buildShelfSummaries(shelves, boxes.map(box => box.id === 74 ? { ...box, posicion: 1 } : box), []), /cuatro posiciones/);
  for (const input of [undefined, [], ["73"], "A1", "1e2", "-1", "0", "01", "1.2", "9007199254740992"]) assert.equal(parsePhysicalId(input), null);
  assert.equal(parsePhysicalId("73"), 73);
  assert.deepEqual(buildShelfSummaries([], [], []), []);
});
