// Node >=22; esbuild externo. SHELVES_TEST_TOOLS=<tools>. Solo servicios simulados.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryFixture } from './helpers/history-fixture.mjs';

test('historial común: todos los sentidos, tipos, instantáneas y fechas/cantidades intactos',async()=>{
  const f=createHistoryFixture();const before=structuredClone(f.state.tables.movimientos);
  await f.renameBoxCode({ubicacionId:73,codigoEsperado:'A1',codigoNuevo:'MOTORES'});
  await f.renameBoxCode({ubicacionId:73,codigoEsperado:'MOTORES',codigoNuevo:'Z20'});
  f.state.queries=[];const {entries,hasNext}=await f.getHistory(1);
  assert.equal(entries.length,13);assert.equal(hasNext,false);assert.equal(f.state.queries.length,3);
  assert.deepEqual(f.state.queries.map(q=>q.table),['movimientos','productos','compartimientos']);
  for(const entry of entries){
    const original=before.find(row=>row.id===entry.id);
    assert.equal(entry.fecha,original.fecha);assert.equal(entry.tipo,original.tipo);assert.equal(entry.cantidad,original.cantidad);
    for(const [side,idField,codeField] of [['origen','origen_compartimiento_id','codigo_origen'],['destino','destino_compartimiento_id','codigo_destino']]){
      assert.equal(entry[side]?.id??null,original[idField]);assert.equal(entry[side]?.codigoMovimiento??null,original[codeField]);
      if(original[idField]===73)assert.equal(entry[side].ubicacionActual.codigo,'Z20');
    }
  }
  assert.deepEqual(f.state.tables.movimientos,before);assert.equal(f.state.writes.length,0);
  assert.ok(f.state.paths.includes('/historial'));
  const metadataIds=f.state.queries[2].filters[0][2];assert.deepEqual(metadataIds.sort((a,b)=>a-b),[1,25,73,96]);
});

test('paginación original: 50+1, orden fecha/id, solo IDs de la página visible',async()=>{
  const f=createHistoryFixture(),template=f.state.tables.movimientos[0];
  f.state.tables.movimientos=Array.from({length:105},(_,i)=>({...template,id:i+1,cantidad:i+1}));
  const first=await f.getHistory(1);assert.equal(first.entries.length,50);assert.equal(first.hasNext,true);
  assert.deepEqual(Array.from(first.entries,e=>e.id),Array.from({length:50},(_,i)=>105-i));
  assert.deepEqual(f.state.queries[0].orders,[['fecha',false],['id',false]]);
  assert.deepEqual([f.state.queries[0].start,f.state.queries[0].end],[0,50]);
  const second=await f.getHistory(2);assert.equal(second.entries[0].id,55);assert.equal(second.entries.at(-1).id,6);
  const third=await f.getHistory(3);assert.equal(third.entries.length,5);assert.equal(third.hasNext,false);
  assert.equal(new Set([...first.entries,...second.entries,...third.entries].map(e=>e.id)).size,105);
  f.state.queries=[];f.state.tables.movimientos=[{...template,fecha:'2026-01-03T12:30:00Z',origen_compartimiento_id:73,codigo_origen:'A1'},...Array.from({length:50},(_,i)=>({...template,id:i+2,
    destino_compartimiento_id:i===0?96:25,codigo_destino:i===0?'B12':'C211'}))];
  await f.getHistory(1);assert.ok(f.state.queries[2].filters[0][2].includes(73),'Orden principal por fecha');
  assert.equal(f.state.queries[2].filters[0][2].includes(96),false,'No consulta metadata del centinela 51');
  const page=await f.historyPage({searchParams:Promise.resolve({pagina:'-1'})});assert.ok(page);
  assert.equal(f.state.queries.at(-3).start,0);
});

test('autorización, estados vacíos, metadata ausente y consultas fallidas',async()=>{
  const f=createHistoryFixture();f.state.denied=true;
  await assert.rejects(f.getHistory(1),/No autorizado/);assert.equal(f.state.queries.length,0);
  f.state.denied=false;
  for(const table of ['movimientos','productos','compartimientos']){f.state.failTable=table;await assert.rejects(f.getHistory(1),/Fallo simulado/)}
  f.state.failTable=null;f.state.tables.compartimientos=[];
  const unavailable=await f.getHistory(1);assert.equal(unavailable.entries.find(e=>e.id===8).origen.id,73);
  assert.equal(unavailable.entries.find(e=>e.id===8).origen.codigoMovimiento,'A1');assert.equal(unavailable.entries.find(e=>e.id===8).origen.ubicacionActual,null);
  f.state.tables.movimientos=[];f.state.queries=[];
  assert.equal((await f.getHistory(1)).entries.length,0);assert.equal(f.state.queries.length,1);
});
