import assert from "node:assert/strict";
import test from "node:test";
import { fieldErrorOfProduct } from "../lib/product-form-model.ts";
import { PRODUCT_DESCRIPTION_MAX, PRODUCT_NAME_MAX, validateProduct } from "../lib/product-validation.ts";

const categories = [{ id: "cat-1", nombre: "Sensores" }, { id: "cat-2", nombre: "Repuestos" }];
const names = ["", " ", "   ", "---", "...", "_", "A", "a", "Sensor M18", "ESP32-S3 C++", "Módulo térmico", "名称", "٣", "x".repeat(PRODUCT_NAME_MAX), "x".repeat(PRODUCT_NAME_MAX + 1), " a ", "😀", "😀 1"];
const categoryIds = ["", "cat-1", "cat-2", "otra", " cat-1"];
const categoryLists = [[], categories, [categories[1]]];
const descriptions = ["", " ", "x", "x".repeat(PRODUCT_DESCRIPTION_MAX), "x".repeat(PRODUCT_DESCRIPTION_MAX + 1)];

test("equivalencia exhaustiva con validateProduct: mismo resultado, mismo texto y campo coherente", () => {
  let invalid = 0, valid = 0;
  const seenFields = new Set();
  for (const nombre of names) for (const categoriaId of categoryIds) for (const list of categoryLists) for (const descripcion of descriptions) {
    const expected = validateProduct(nombre, categoriaId, list, descripcion);
    const found = fieldErrorOfProduct(validateProduct, nombre, categoriaId, list, descripcion);
    if (expected === null) { assert.equal(found, null); valid++; continue; }
    invalid++;
    assert.ok(found, `sin campo para «${expected}»`);
    assert.equal(found.message, expected, "el texto es exactamente el de validateProduct");
    // Orden de evaluación de validateProduct: nombre → categoría → descripción.
    const nameBad = validateProduct(nombre, "ok", [{ id: "ok", nombre: "ok" }], "") !== null;
    const categoryBad = validateProduct("Valid", categoriaId, list, "") !== null;
    assert.equal(found.field, nameBad ? "nombre" : categoryBad ? "categoria" : "descripcion", `${JSON.stringify([nombre.slice(0, 12), categoriaId, descripcion.length])}`);
    seenFields.add(found.field);
  }
  assert.ok(valid > 0 && invalid > 0);
  assert.deepEqual([...seenFields].sort(), ["categoria", "descripcion", "nombre"]);
});

test("textos exactos y campo de cada regla existente", () => {
  const cases = [
    [["", "cat-1", categories, ""], "nombre", "Escribe un nombre para el producto."],
    [["   ", "cat-1", categories, ""], "nombre", "Escribe un nombre para el producto."],
    [["---", "cat-1", categories, ""], "nombre", "El nombre debe incluir al menos una letra o un número."],
    [["x".repeat(PRODUCT_NAME_MAX + 1), "cat-1", categories, ""], "nombre", `El nombre puede tener hasta ${PRODUCT_NAME_MAX} caracteres.`],
    [["Sensor", "", categories, ""], "categoria", "Selecciona una categoría válida."],
    [["Sensor", "otra", categories, ""], "categoria", "Selecciona una categoría válida."],
    [["Sensor", "cat-1", [], ""], "categoria", "Selecciona una categoría válida."],
    [["Sensor", "cat-1", categories, "x".repeat(PRODUCT_DESCRIPTION_MAX + 1)], "descripcion", `La descripción puede tener hasta ${PRODUCT_DESCRIPTION_MAX} caracteres.`],
  ];
  for (const [args, field, message] of cases) assert.deepEqual(fieldErrorOfProduct(validateProduct, ...args), { field, message });
  assert.equal(fieldErrorOfProduct(validateProduct, "Sensor", "cat-1", categories, "x".repeat(PRODUCT_DESCRIPTION_MAX)), null);
});

test("con varios errores a la vez se reporta el mismo primero que validateProduct", () => {
  const found = fieldErrorOfProduct(validateProduct, "", "", categories, "x".repeat(PRODUCT_DESCRIPTION_MAX + 1));
  assert.deepEqual(found, { field: "nombre", message: "Escribe un nombre para el producto." });
  assert.deepEqual(fieldErrorOfProduct(validateProduct, "Sensor", "", categories, "x".repeat(PRODUCT_DESCRIPTION_MAX + 1)),
    { field: "categoria", message: "Selecciona una categoría válida." });
});
