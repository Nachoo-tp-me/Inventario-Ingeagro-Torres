import assert from "node:assert/strict";
import test from "node:test";
import { adjacentCompartments, comparableProductName, matchesCatalogQuery, normalizeLocationCode, similarProducts } from "../lib/rapid-model.ts";

const compartments = [1, 2, 3].flatMap((tower) => [6, 5, 4, 3, 2, 1].flatMap((floor) =>
  [1, 2, 3, 4].map((position) => ({ id: tower * 100 + floor * 10 + position,
    codigo: `C${tower}${floor}${position}`, torre_id: tower, piso: floor, posicion: position }))));

test("navega en orden horario, baja de piso y pasa de torre solo por enlace explícito", () => {
  assert.equal(adjacentCompartments(compartments, "C261").next.codigo, "C262");
  assert.equal(adjacentCompartments(compartments, "C263").next.codigo, "C264");
  assert.equal(adjacentCompartments(compartments, "C264").next.codigo, "C251");
  assert.equal(adjacentCompartments(compartments, "C114").next.codigo, "C261");
  assert.equal(adjacentCompartments(compartments, "C314").next, null);
  assert.equal(adjacentCompartments(compartments, "C361").previous.codigo, "C214");
});

test("acepta código exacto sin importar mayúsculas ni espacios y rechaza inexistentes", () => {
  assert.equal(normalizeLocationCode(" c264 "), "C264");
  assert.equal(adjacentCompartments(compartments, " c264 ").current.codigo, "C264");
  assert.equal(adjacentCompartments(compartments, "C299").current, null);
});

test("filtra nombres exactos, parciales, categoría y variantes triviales", () => {
  assert.equal(matchesCatalogQuery("ESP32-S3", "Microcontroladores", "ESP32-S3"), true);
  assert.equal(matchesCatalogQuery("ESP32-S3", "Microcontroladores", "esp32"), true);
  assert.equal(matchesCatalogQuery("ESP32-S3", "Microcontroladores", "MICROCONTROLADORES"), true);
  assert.equal(matchesCatalogQuery("ESP32-S3", "Microcontroladores", "esp32 s3"), true);
  assert.equal(matchesCatalogQuery("ESP32-S3", "Microcontroladores", "motor"), false);
});

test("advierte nombres equivalentes sin fusionarlos ni crearlos", () => {
  const existing = [{ id: "one", nombre: "ESP32-S3", nombre_normalizado: "esp32s3" },
    { id: "two", nombre: "Módulo térmico" }];
  assert.equal(comparableProductName(" ÉSP32 s3 "), "esp32s3");
  assert.deepEqual(similarProducts("esp32 s3", existing).map((item) => item.id), ["one"]);
  assert.deepEqual(similarProducts("Modulo-termico", existing).map((item) => item.id), ["two"]);
  assert.deepEqual(similarProducts("Sensor de humedad", existing), []);
  assert.equal(existing.length, 2);
});
