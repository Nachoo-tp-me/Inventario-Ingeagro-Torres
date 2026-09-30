import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCategoryName,
  validateImage,
  validateProduct,
} from "../lib/product-validation.ts";
import { buildTowerDetail } from "../lib/tower-model.ts";

const categories = [{ id: "cat-1", nombre: "Sensores" }];

test("valida nombre, categoría y descripción sin cambiar el nombre visible", () => {
  assert.match(validateProduct("  ", "cat-1", categories, ""), /nombre/);
  assert.match(validateProduct("ESP32-S3", "otra", categories, ""), /categoría/);
  assert.match(validateProduct("ESP32-S3", "cat-1", categories, "x".repeat(2001)), /descripción/);
  assert.equal(validateProduct("ESP32-S3", "cat-1", categories, ""), null);
  assert.equal(validateProduct("ESP32 S3", "cat-1", categories, ""), null);
});

test("rechaza categorías vacías o demasiado largas", () => {
  assert.match(validateCategoryName("   "), /nombre/);
  assert.match(validateCategoryName("x".repeat(81)), /80/);
  assert.equal(validateCategoryName(" Sensores de temperatura "), null);
});

test("acepta fotos JPG, PNG y WebP hasta 5 MB", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"])
    assert.equal(validateImage(new File(["x"], "foto", { type })), null);
  assert.match(validateImage(new File(["x"], "foto.gif", { type: "image/gif" })), /JPG/);
  assert.match(validateImage(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "grande.jpg", { type: "image/jpeg" })), /5 MB/);
});

test("el compartimiento muestra foto firmada y solo stock positivo", () => {
  const detail = buildTowerDetail(
    { id: 1, codigo: "C1" },
    [{ id: 1, codigo: "C111", piso: 1, posicion: 1 }],
    [{ compartimiento_id: 1, producto_id: "prod-1", cantidad: 3 }, { compartimiento_id: 1, producto_id: "prod-1", cantidad: 0 }],
    [{ id: "prod-1", nombre: "Sensor", categoria_id: "cat-1", foto_ruta: "prod-1/image.jpg" }],
    categories,
    new Map([["prod-1/image.jpg", "https://example.test/signed"]]),
  );
  assert.equal(detail.ocupados, 1);
  assert.equal(detail.pisos[0].compartimientos[0].productos[0].cantidad, 3);
  assert.equal(detail.pisos[0].compartimientos[0].productos[0].fotoUrl, "https://example.test/signed");
});
