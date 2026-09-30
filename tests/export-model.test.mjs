import assert from "node:assert/strict";
import test from "node:test";
import writeExcelFile from "write-excel-file/node";
import { buildExportSnapshot, inventoryCsv, inventoryWorkbookData } from "../lib/export-model.ts";

const products = [
  { id: "secret-a", nombre: "Módulo ESP32-S3", categoria: "Microcontroladores", descripcion: "Placa \"principal\"" },
  { id: "secret-b", nombre: "=SUM(1+1)", categoria: "Otros", descripcion: null },
];
const towers = [{ id: 2, codigo: "C2" }];
const compartments = [
  { id: 1, codigo: "C264", torre_id: 2, piso: 6, posicion: 4 },
  { id: 2, codigo: "C251", torre_id: 2, piso: 5, posicion: 1 },
  { id: 3, codigo: "C252", torre_id: 2, piso: 5, posicion: 2 },
];
const stock = [
  { producto_id: "secret-a", compartimiento_id: 1, cantidad: 17 },
  { producto_id: "secret-a", compartimiento_id: 2, cantidad: 8 },
];
const snapshot = buildExportSnapshot(products, stock, compartments, towers, "2026-09-30T12:00:00.000Z");

test("exporta una fila por ubicación y productos sin stock, con resumen real", () => {
  assert.deepEqual(snapshot.rows.map((item) => [item.producto, item.cantidad, item.ubicacion]), [
    ["Módulo ESP32-S3", 17, "C264"], ["Módulo ESP32-S3", 8, "C251"], ["=SUM(1+1)", 0, ""],
  ]);
  assert.deepEqual(snapshot.resumen, { productos: 2, unidades: 25, compartimientos: 3, ocupados: 2, disponibles: 1 });
  assert.equal(snapshot.torres[0].compartimientos[0].codigo, "C264");
  assert.equal(snapshot.torres[0].compartimientos[2].ocupado, false);
});

test("CSV usa BOM UTF-8, escapa celdas y no expone identificadores ni fórmulas", () => {
  const csv = inventoryCsv(snapshot);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /Módulo ESP32-S3/);
  assert.match(csv, /Placa ""principal""/);
  assert.match(csv, /"'=SUM\(1\+1\)"/);
  assert.ok(!csv.includes("secret-a"));
  assert.ok(!csv.includes("secret-b"));
  assert.equal(csv.split("\r\n").filter(Boolean).length, 4);
});

test("Excel contiene Inventario y Resumen como libro XLSX real", async () => {
  const sheets = inventoryWorkbookData(snapshot);
  assert.deepEqual(sheets.map((sheet) => sheet.sheet), ["Inventario", "Resumen"]);
  assert.deepEqual(sheets[0].data[1], ["Módulo ESP32-S3", "Microcontroladores", "Placa \"principal\"", 17, "C264", "C2", 6, 4]);
  const buffer = await writeExcelFile(sheets).toBuffer();
  assert.equal(buffer.subarray(0, 2).toString(), "PK");
  assert.ok(buffer.length > 1000);
});

test("exportación vacía conserva encabezados y resumen en cero", () => {
  const empty = buildExportSnapshot([], [], [], [], "2026-09-30T12:00:00.000Z");
  assert.equal(empty.rows.length, 0);
  assert.deepEqual(empty.resumen, {
    productos: 0, unidades: 0, compartimientos: 0, ocupados: 0, disponibles: 0,
  });
  assert.equal(inventoryCsv(empty).split("\r\n").filter(Boolean).length, 1);
  assert.equal(inventoryWorkbookData(empty)[0].data.length, 1);
});
