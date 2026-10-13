import assert from "node:assert/strict";
import test from "node:test";
import { adjacentCompartments, comparableProductName, matchesCatalogQuery, matchesNormalizedCatalogQuery, normalizeCatalogSearch, normalizeLocationCode, similarProducts } from "../lib/rapid-model.ts";

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

test("B3: nombres y categorías comparten tildes, caja, espacios y separadores", () => {
  const products = [
    { nombre: "Módulo térmico", categoria: "Electrónica / térmica" },
    { nombre: "ESP32-S3", categoria: "Microcontroladores" },
    { nombre: "Eje", categoria: "Mecánica" },
  ];
  for (const query of ["modulo termico", " MÓDULO   TÉRMICO ", "módulo-térmico", "modulo_termico", "modulo/térmico", "modulo\\termico", "modulo—termico", "modulo\u00a0termico", "modulotermico", "mo\u0301dulo te\u0301rmico"]) {
    assert.deepEqual(products.filter(p => matchesCatalogQuery(p.nombre, p.categoria, query)).map(p => p.nombre), ["Módulo térmico"]);
  }
  for (const query of ["electronica termica", "ELECTRÓNICA_TÉRMICA", "mecanica", "ESP32 S3"]) {
    const term = normalizeCatalogSearch(query);
    assert.deepEqual(products.map(p => matchesCatalogQuery(p.nombre, p.categoria, query)),
      products.map(p => matchesNormalizedCatalogQuery(normalizeCatalogSearch(p.nombre), normalizeCatalogSearch(p.categoria), term)));
    assert.ok(products.some(p => matchesCatalogQuery(p.nombre, p.categoria, query)));
  }
  assert.equal(matchesCatalogQuery("Módulo térmico", "Sensores", "térmico módulo"), false);
  assert.equal(matchesCatalogQuery("Módulo térmico", "Sensores", ""), true);
  for (const query of ["---", "_", "/", "\\"]) assert.equal(matchesCatalogQuery("ESP32-S3", "Sensores", query), false);
});

test("B3: conserva símbolos, decimales, signos y nombres técnicos", () => {
  for (const [name, query] of [["ESP32-S3", "esp32_s3"], ["LM-2596", "lm 2596"], ["C++", "c++"], ["C#", "c#"], ["Resistencia 4.7 kΩ", "resistencia4.7kΩ"], ["Fuente −5 V", "fuente -5v"], ["Fuente 12-24 V", "fuente12−24v"], ["Cable 0,5 mm", "cable0,5mm"]]) {
    assert.equal(matchesCatalogQuery(name, "Componentes", query), true, `${name} / ${query}`);
  }
  for (const [name, query] of [["C#", "c++"], ["Resistencia 47 kΩ", "4.7"], ["Cable 05 mm", "0,5"], ["Fuente 5V", "-5V"], ["Fuente 1224V", "12-24V"], ["Sensor 10 µA", "10mA"]]) {
    assert.equal(matchesCatalogQuery(name, "Componentes", query), false, `${name} / ${query}`);
  }
  assert.equal(normalizeCatalogSearch("C++"), "c++");
  assert.equal(normalizeCatalogSearch("C#"), "c#");
  assert.equal(matchesCatalogQuery("Fuente 12–24 V", "Componentes", "fuente 12-24v"), true);
  assert.equal(matchesCatalogQuery("Fuente –5 V", "Componentes", "fuente -5v"), true);
  assert.equal(matchesCatalogQuery("Conector 1/4", "Conectores", "conector1⁄4"), true);
  assert.equal(matchesCatalogQuery("Conector 14", "Conectores", "conector1/4"), false);
});

test("B3: equivalencia Unicode canónica sin eliminar marcas de otros alfabetos", () => {
  for (const name of ["Módulo", "Κατηγορία", "センサー ガ", "센서", "电机", "Sonda μΩ"]) {
    assert.equal(matchesCatalogQuery(name, "Prueba", name.normalize("NFD")), true);
    assert.equal(normalizeCatalogSearch(name), normalizeCatalogSearch(name.normalize("NFD")));
  }
  assert.notEqual(normalizeCatalogSearch("ガ"), normalizeCatalogSearch("カ"));
  assert.notEqual(normalizeCatalogSearch("10µA"), normalizeCatalogSearch("10mA"));
  assert.notEqual(normalizeCatalogSearch("ø"), normalizeCatalogSearch("o"));
});

test("B3: los códigos mantienen coincidencia exacta y no usan el plegado del catálogo", () => {
  assert.equal(normalizeLocationCode(" c264 "), "C264");
  for (const code of ["C 264", "C-264", "C_264", "Ć264", "Ｃ２６４", "C0264"]) {
    assert.equal(adjacentCompartments(compartments, code).current, null);
  }
});
