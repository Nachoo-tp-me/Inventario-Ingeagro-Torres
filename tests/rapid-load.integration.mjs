// Node >=22; esbuild externo. SHELVES_TEST_TOOLS=<tools>. Solo servicios simulados.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createShelfFixture, productId } from './helpers/shelves-fixture.mjs';

test('rutas reales: 24 cajas por ID y 72 compartimientos sin cruzar recorridos',async()=>{
  const f=createShelfFixture();
  const start=(await f.rapidStartPage()).props.children[1].props;
  assert.equal(start.compartments.length,72);assert.equal(start.boxes.length,24);
  for(const row of f.state.tables.compartimientos){
    const page=row.tipo==='caja'?await f.rapidBoxPage({params:Promise.resolve({id:String(row.id)})}):await f.rapidTowerPage({params:Promise.resolve({codigo:row.codigo})});
    assert.equal(page.props.current.id,row.id);assert.equal(page.props.current.tipo,row.tipo);
    for(const neighbor of [page.props.adjacent.previous,page.props.adjacent.next].filter(Boolean)) assert.equal(neighbor.tipo,row.tipo);
  }
  assert.equal(f.state.writes.length,0);assert.equal(f.state.rpcs.length,0);
  assert.equal((await f.rapidBoxPage({params:Promise.resolve({id:'73'})})).props.current.productos.find(p=>p.id===productId).cantidad,7);
  assert.equal((await f.rapidBoxPage({params:Promise.resolve({id:'74'})})).props.current.ocupado,false);
  const box=start.boxes.find(row=>row.id===73);
  await assert.rejects(f.getRapidCompartment(box),/Se esperaba un compartimiento de torre/);
});

test('códigos actuales/históricos, renombrado y ruta permanente autorizada',async()=>{
  const f=createShelfFixture();
  assert.equal((await f.resolveRapidCode(' c264 ')).href,'/carga/C264');
  assert.equal((await f.resolveRapidCode('A6')).href,'/carga/ubicacion/78');
  await f.renameBoxCode({ubicacionId:78,codigoEsperado:'A6',codigoNuevo:'MOTORES'});
  for(const code of ['A6','motores']){
    assert.equal((await f.resolveRapidCode(code)).href,'/carga/ubicacion/78');
    await assert.rejects(f.rapidTowerPage({params:Promise.resolve({codigo:code})}),/REDIRECT:\/carga\/ubicacion\/78/);
  }
  assert.equal((await f.rapidBoxPage({params:Promise.resolve({id:'78'})})).props.current.codigo,'MOTORES');
  assert.ok(f.state.paths.includes('/carga')&&f.state.paths.includes('/carga/ubicacion/78'));
  for(const code of ['C 264','C++','MOTORES 1','A999','ß','']) assert.equal((await f.resolveRapidCode(code)).ok,false);
  assert.equal(f.state.writes.length,0);
});

test('IDs inválidos, tipos incorrectos, autorización y fallos no fabrican ubicaciones',async()=>{
  const f=createShelfFixture();
  for(const id of ['0','-1','1','9999','73x','01','9007199254740992']) await assert.rejects(f.rapidBoxPage({params:Promise.resolve({id})}),/NOT_FOUND/);
  f.state.denied=true;
  const before=f.state.queries.length;
  await assert.rejects(f.rapidBoxPage({params:Promise.resolve({id:'73'})}),/No autorizado/);
  await assert.rejects(f.resolveRapidCode('A1'),/No autorizado/);
  assert.equal(f.state.queries.length,before);
  f.state.denied=false;
  for(const table of ['compartimientos','inventario','productos']){
    f.state.failTable=table;await assert.rejects(f.rapidBoxPage({params:Promise.resolve({id:'73'})}),/Fallo simulado/);
  }
  f.state.failTable='ubicacion_codigos';await assert.rejects(f.resolveRapidCode('A1'),/Fallo simulado/);
  f.state.failTable=null;f.state.tables.compartimientos=[];
  const start=(await f.rapidStartPage()).props.children[1].props;
  assert.equal(start.boxes.length,0);assert.equal(start.compartments.length,0);
});

test('entrada en caja reutiliza acción, producto, ID y cantidad; invalida carga por ID',async()=>{
  const f=createShelfFixture();
  assert.equal((await f.submitStockOperation({tipo:'entrada',productoId:productId,destinoId:74,cantidad:3})).ok,true);
  const current=(await f.rapidBoxPage({params:Promise.resolve({id:'74'})})).props.current;
  assert.equal(current.ocupado,true);assert.equal(current.productos[0].cantidad,3);
  assert.equal(f.state.writes.length,1);assert.equal(f.state.writes[0].destino_compartimiento_id,74);
  assert.ok(f.state.paths.includes('/carga/ubicacion/74'));
  assert.equal(f.state.paths.some(path=>/^\/carga\/ubicacion\/1$/.test(path)),false);
  assert.equal((await f.submitStockOperation({tipo:'entrada',productoId:productId,destinoId:74,cantidad:0})).ok,false);
  assert.equal(f.state.writes.length,1);
});
