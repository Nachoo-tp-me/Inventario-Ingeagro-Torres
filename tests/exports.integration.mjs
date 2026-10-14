// Node >=22, SHELVES_TEST_TOOLS=<esbuild externo>; DAL real, servicios ficticios.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createShelfFixture,productId} from './helpers/shelves-fixture.mjs';

test('exportación común: 96 ubicaciones, 6 estantes, totales y códigos vigentes',async()=>{
  const f=createShelfFixture();
  f.state.tables.productos.push({id:'no-stock',nombre:'Sin stock Ω',descripcion:'½',categoria_id:'cat01'});
  await f.renameBoxCode({ubicacionId:73,codigoEsperado:'A1',codigoNuevo:'MOTORES'});
  f.state.queries=[];const before=structuredClone(f.state.tables);const data=await f.getExportSnapshot();
  assert.deepEqual({...data.resumen},{productos:3,unidades:33,compartimientos:72,cajas:24,ubicaciones:96,ocupados:3,disponibles:93});
  assert.equal(data.rows.length,5);assert.equal(data.rows.filter(row=>row.ubicacion==='MOTORES').length,2);
  assert.equal(data.rows.find(row=>row.producto==='Sin stock Ω').cantidad,0);
  assert.equal(data.rows.find(row=>row.producto==='Sin stock Ω').ubicacion,'');
  assert.equal(data.torres.reduce((sum,row)=>sum+row.ocupados,0),1);
  assert.equal(data.estantes.length,6);assert.equal(data.estantes[0].cajas[0].codigo,'MOTORES');
  assert.equal(f.state.queries.length,10);assert.equal(f.state.writes.length,0);assert.deepEqual(f.state.tables,before);
});

test('paginación de productos/stock y posiciones: datos sintéticos superan 1000 filas',async()=>{
  const f=createShelfFixture();f.state.tables.productos=Array.from({length:1005},(_,i)=>({id:`p${String(i).padStart(4,'0')}`,nombre:`Producto ${i}`,categoria_id:'cat01'}));
  f.state.tables.inventario=f.state.tables.productos.flatMap(product=>[1,73].map(compartimiento_id=>({producto_id:product.id,compartimiento_id,cantidad:2})));
  const data=await f.getExportSnapshot();assert.equal(data.rows.length,2010);assert.equal(data.resumen.unidades,4020);
  assert.equal(new Set(data.rows.map(row=>row.producto+':'+row.ubicacion)).size,2010);
  assert.equal(f.state.queries.filter(q=>q.table==='productos').length,3);
  assert.equal(f.state.queries.filter(q=>q.table==='inventario').length,4);
  assert.equal(f.state.queries.filter(q=>q.table==='compartimientos').length,2);
});

test('límite PostgREST menor al solicitado y error de una página posterior no truncan archivos',async()=>{
  const f=createShelfFixture();f.state.maxRows=2;
  const data=await f.getExportSnapshot();assert.equal(data.resumen.ubicaciones,96);assert.equal(data.resumen.unidades,33);assert.equal(data.estantes.length,6);
  f.state.failTable='compartimientos';f.state.failAfter=4;
  await assert.rejects(f.getExportSnapshot(),/Fallo simulado/);
});

test('autorización, errores de cada lectura, datos faltantes y estado vacío',async()=>{
  const f=createShelfFixture();f.state.denied=true;await assert.rejects(f.getExportSnapshot(),/No autorizado/);assert.equal(f.state.queries.length,0);
  f.state.denied=false;
  for(const table of ['productos','inventario','compartimientos','torres','estantes']){f.state.failTable=table;await assert.rejects(f.getExportSnapshot(),/Fallo simulado/)}
  f.state.failTable=null;f.state.nullTable='productos';await assert.rejects(f.getExportSnapshot(),/verificar/);
  f.state.nullTable=null;f.state.tables.inventario.push({producto_id:productId,compartimiento_id:999,cantidad:1});
  await assert.rejects(f.getExportSnapshot(),/incompleta/);
  for(const table of Object.keys(f.state.tables))f.state.tables[table]=[];
  const empty=await f.getExportSnapshot();assert.equal(empty.rows.length,0);assert.equal(empty.resumen.ubicaciones,0);
});
