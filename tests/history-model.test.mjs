import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHistoryLocation, historyLocationLabel, historyLocationParts } from '../lib/history-model.ts';
const box={tipo:'caja',id:73,codigo:'MOTORES',estante_id:1,posicion:1};

test('historial separa instantánea, código actual e ID tras múltiples renombrados',()=>{
  const places=new Map([[73,box]]);
  const first=resolveHistoryLocation(73,'A1',places);
  assert.equal(first.id,73);assert.equal(first.codigoMovimiento,'A1');
  assert.equal(historyLocationLabel(first),'A1 (actualmente MOTORES)');
  places.set(73,{...box,codigo:'Z20'});
  const later=resolveHistoryLocation(73,'A1',places);
  assert.equal(historyLocationLabel(later),'A1 (actualmente Z20)');
  assert.equal(historyLocationLabel(resolveHistoryLocation(73,'Z20',places)),'Z20');
});

test('NULL histórico se conserva; ausencia de metadata no inventa ubicación ni signo',()=>{
  const legacy=resolveHistoryLocation(73,null,new Map([[73,box]]));
  assert.equal(legacy.codigoMovimiento,null);
  assert.equal(historyLocationLabel(legacy),'MOTORES (código actual; sin instantánea histórica)');
  assert.equal(resolveHistoryLocation(null,null,new Map()),null);
  const unavailable=resolveHistoryLocation(73,'A1',new Map());
  assert.equal(unavailable.ubicacionActual,null);assert.equal(unavailable.id,73);
  assert.equal(historyLocationLabel(unavailable),'A1 (ubicación actual no disponible)');
  assert.equal(historyLocationLabel(resolveHistoryLocation(73,null,new Map())),'Ubicación no disponible (sin instantánea histórica)');
  assert.throws(()=>resolveHistoryLocation(0,'A1',new Map()),/inválido/);
  assert.throws(()=>resolveHistoryLocation(73,'A1',new Map([[73,{...box,id:74}]])),/inconsistente/);
});

test('historyLocationParts reproduce exactamente historyLocationLabel en toda la malla de casos',()=>{
  const current=code=>code===null?null:{tipo:'caja',id:73,codigo:code,estante_id:1,posicion:1};
  let cases=0;
  for(const snapshot of [null,'A1','Z20','W'.repeat(24)])for(const actual of [null,'A1','Z20','MOTORES']){
    const location={id:73,codigoMovimiento:snapshot,ubicacionActual:current(actual)};
    const {code,note}=historyLocationParts(location);cases++;
    assert.equal(note?`${code} (${note})`:code,historyLocationLabel(location),`snapshot=${snapshot} actual=${actual}`);
    assert.ok(code.length>0);
  }
  assert.equal(cases,16);
  const parts=(snapshot,actual)=>historyLocationParts({id:73,codigoMovimiento:snapshot,ubicacionActual:current(actual)});
  assert.deepEqual(parts('A1','Z20'),{code:'A1',note:'actualmente Z20'},'el código del movimiento sigue siendo el principal');
  assert.deepEqual(parts('A1','A1'),{code:'A1',note:null});
  assert.deepEqual(parts(null,'Z20'),{code:'Z20',note:'código actual; sin instantánea histórica'},'NULL: nunca se inventa un código pasado');
  assert.deepEqual(parts('A1',null),{code:'A1',note:'ubicación actual no disponible'});
  assert.deepEqual(parts(null,null),{code:'Ubicación no disponible',note:'sin instantánea histórica'});
});
