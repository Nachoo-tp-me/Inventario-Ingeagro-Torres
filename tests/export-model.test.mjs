import assert from "node:assert/strict";
import test from "node:test";
import writeExcelFile from "write-excel-file/node";
import { unzipSync } from "fflate"; // Dependencia existente de write-excel-file.
import { buildExportSnapshot, inventoryCsv, inventoryWorkbookData, INVENTORY_HEADERS } from "../lib/export-model.ts";

const products = [
  { id: "secret-a", nombre: "Módulo ESP32-S3", categoria: "Microcontroladores", descripcion: "Placa \"principal\"" },
  { id: "secret-b", nombre: "=SUM(1+1)", categoria: "Otros", descripcion: null },
];
const towers = [{ id: 2, codigo: "C2" }];
const compartments = [
  { tipo: "compartimiento", id: 1, codigo: "C264", torre_id: 2, piso: 6, posicion: 4 },
  { tipo: "compartimiento", id: 2, codigo: "C251", torre_id: 2, piso: 5, posicion: 1 },
  { tipo: "compartimiento", id: 3, codigo: "C252", torre_id: 2, piso: 5, posicion: 2 },
];
const stock = [
  { producto_id: "secret-a", compartimiento_id: 1, cantidad: 17 },
  { producto_id: "secret-a", compartimiento_id: 2, cantidad: 8 },
];
const snapshot = buildExportSnapshot(products, stock, compartments, towers, "2026-09-30T12:00:00.000Z");

test("exporta una fila por producto/ubicación y productos sin stock, con resumen real", () => {
  assert.deepEqual(snapshot.rows.map((item) => [item.producto, item.cantidad, item.ubicacion]), [
    ["Módulo ESP32-S3", 17, "C264"], ["Módulo ESP32-S3", 8, "C251"], ["=SUM(1+1)", 0, ""],
  ]);
  assert.deepEqual(snapshot.resumen, { productos: 2, unidades: 25, compartimientos: 3, ocupados: 2, disponibles: 1, cajas: 0, ubicaciones: 3 });
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
  assert.deepEqual(sheets[0].data[1], ["Módulo ESP32-S3", "Microcontroladores", "Placa \"principal\"", 17, "C264", "C2", 6, 4, "Compartimiento", "", ""]);
  const buffer = await writeExcelFile(sheets).toBuffer();
  assert.equal(buffer.subarray(0, 2).toString(), "PK");
  assert.ok(buffer.length > 1000);
});

test("exportación vacía conserva encabezados y resumen en cero", () => {
  const empty = buildExportSnapshot([], [], [], [], "2026-09-30T12:00:00.000Z");
  assert.equal(empty.rows.length, 0);
  assert.deepEqual(empty.resumen, {
    productos: 0, unidades: 0, compartimientos: 0, ocupados: 0, disponibles: 0,
    cajas: 0, ubicaciones: 0,
  });
  assert.equal(inventoryCsv(empty).split("\r\n").filter(Boolean).length, 1);
  assert.equal(inventoryWorkbookData(empty)[0].data.length, 1);
});

const shelves=Array.from({length:6},(_,i)=>({id:i+1,nombre:`Estante ${i+1}`,grupo:i<3?'A':'B'}));
const boxes=Array.from({length:24},(_,i)=>({tipo:'caja',id:73+i,codigo:i===0?'MOTORES_1':`${i<12?'A':'B'}${i%12+1}`,estante_id:Math.floor(i/4)+1,posicion:i%4+1}));

test('cajas: ocho columnas compatibles, tres nuevas, referencias múltiples y cero duplicación',()=>{
  const mixed=buildExportSnapshot(products,[...stock,{producto_id:'secret-a',compartimiento_id:73,cantidad:3},{producto_id:'secret-b',compartimiento_id:73,cantidad:2}],
    [...compartments,...boxes],towers,snapshot.generadoEn,shelves);
  assert.deepEqual(INVENTORY_HEADERS,['Producto','Categoría','Descripción','Cantidad','Ubicación','Torre','Piso','Compartimiento','Tipo de ubicación','Estante','Posición de caja']);
  assert.deepEqual(inventoryWorkbookData(mixed)[0].data.slice(1,3).map(row=>row.slice(0,8)),inventoryWorkbookData(snapshot)[0].data.slice(1,3).map(row=>row.slice(0,8)));
  const boxRows=mixed.rows.filter(row=>row.tipoUbicacion==='Caja');assert.equal(boxRows.length,2);
  assert.ok(boxRows.every(row=>row.ubicacion==='MOTORES_1'&&row.torre===''&&row.piso===null&&row.compartimiento===null&&row.estante==='Estante 1'&&row.posicionCaja==='1 · Superior izquierda'));
  assert.deepEqual(mixed.resumen,{productos:2,unidades:30,compartimientos:3,cajas:24,ubicaciones:27,ocupados:3,disponibles:24});
  assert.deepEqual(mixed.torres,snapshot.torres,'Cajas no contaminan estadísticas de torres');
  assert.equal(mixed.rows.length,4,'No añade filas por cajas vacías ni una fila sin stock para un producto que solo está en caja');
  assert.deepEqual(mixed.estantes.flatMap(shelf=>shelf.cajas.map(box=>box.codigo)),boxes.map(box=>box.codigo));
  assert.ok(mixed.estantes.every(shelf=>shelf.cajas.map(box=>box.posicion).join(',')==='1,2,3,4'));
  assert.equal(mixed.estantes[0].ocupados,1);assert.equal(mixed.estantes[5].disponibles,4);
});

test('CSV y XLSX reales conservan Unicode, separadores y textos peligrosos sin fórmulas',async()=>{
  const dangerous=['=SUM(1+1)',' +1','\t-2','\r@X','C++ / C# · ½ Ω, ñ "sí"\nsegunda línea'];
  const input=dangerous.map((nombre,i)=>({id:String(i),nombre,categoria:nombre,descripcion:nombre}));
  const data=buildExportSnapshot(input,[],[],[],snapshot.generadoEn);
  const csv=inventoryCsv(data);assert.equal(csv.charCodeAt(0),0xfeff);
  for(const value of dangerous.slice(0,4))assert.ok(csv.includes(`"'${value}"`));
  assert.ok(csv.includes('C++ / C# · ½ Ω, ñ ""sí""\nsegunda línea'));
  const zip=unzipSync(await writeExcelFile(inventoryWorkbookData(data)).toBuffer());
  const sheet=Buffer.from(zip['xl/worksheets/sheet1.xml']).toString('utf8');
  const strings=Buffer.from(zip['xl/sharedStrings.xml']).toString('utf8');
  assert.doesNotMatch(sheet,/<f[\s>]/);assert.match(sheet,/<c[^>]*t="s"/);
  for(const value of ['=SUM(1+1)','C++ / C#','½ Ω','ñ'])assert.ok(strings.includes(value));
});

test('referencias incompletas, duplicados y estantes corruptos impiden exportar',()=>{
  const build=(s=stock,places=compartments,parents=[])=>buildExportSnapshot(products,s,places,towers,snapshot.generadoEn,parents);
  assert.throws(()=>build([...stock,stock[0]]),/duplicado/);
  assert.throws(()=>build(stock,[...compartments,compartments[0]]),/duplicados/);
  assert.throws(()=>build([{...stock[0],producto_id:'missing'}]),/incompleta/);
  assert.throws(()=>build([{...stock[0],compartimiento_id:999}]),/incompleta/);
  assert.throws(()=>build([],boxes),/incompleta/);
  assert.throws(()=>build([],boxes.slice(1),shelves),/cuatro posiciones/);
  assert.throws(()=>build([],boxes.map(box=>box.id===74?{...box,posicion:1}:box),shelves),/cuatro posiciones/);
});

test('compartimiento con stock y torre faltante rechaza la exportación',()=>{
  assert.throws(()=>buildExportSnapshot(products,stock,compartments,[],snapshot.generadoEn),
    {message:'Referencia de torre incompleta'});
});

test('caja con stock y estante faltante rechaza la exportación',()=>{
  const boxStock=[{producto_id:'secret-a',compartimiento_id:73,cantidad:5}];
  assert.throws(()=>buildExportSnapshot(products,boxStock,boxes,[],snapshot.generadoEn,[]),
    {message:'Referencia de estante incompleta'});
});

test('contenedores válidos conservan filas y cantidades de torres y cajas',()=>{
  const data=buildExportSnapshot(products,[stock[0],{producto_id:'secret-a',compartimiento_id:73,cantidad:5}],
    [compartments[0],...boxes.slice(0,4)],towers,snapshot.generadoEn,shelves.slice(0,1));
  assert.deepEqual(data.rows.map(row=>[row.ubicacion,row.torre,row.estante,row.cantidad]),[
    ['C264','C2','',17],['MOTORES_1','','Estante 1',5],['','','',0],
  ]);
  assert.equal(data.resumen.unidades,22);
  assert.equal(data.resumen.ocupados,2);
  assert.equal(data.torres[0].ocupados,1);
  assert.equal(data.estantes[0].ocupados,1);
});
