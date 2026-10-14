import assert from 'node:assert/strict';
import test from 'node:test';
import { adjacentCompartments, orderedCompartments } from '../lib/rapid-model.ts';
import { adjacentRapidBoxes, orderedRapidBoxes, rapidLocationHref, resolveLastRapidLocation, rememberRapidLocation, LAST_RAPID_LOCATION, LAST_RAPID_LOCATION_V2 } from '../lib/rapid-navigation-model.ts';

const towers=[1,2,3].flatMap(torre_id=>[6,5,4,3,2,1].flatMap(piso=>[1,2,3,4].map(posicion=>({tipo:'compartimiento',id:torre_id*100+piso*10+posicion,codigo:`C${torre_id}${piso}${posicion}`,torre_id,piso,posicion}))));
const boxes=Array.from({length:24},(_,i)=>({tipo:'caja',id:1000+i,codigo:`ETIQUETA_${24-i}`,estante_id:Math.floor(i/4)+1,posicion:i%4+1}));

test('recorridos completos separados: 72 compartimientos originales y 24 cajas por posición',()=>{
  const mixed=[...boxes].reverse().concat(towers);
  assert.deepEqual(orderedRapidBoxes(mixed),boxes);
  for(let i=0;i<24;i++){
    const walk=adjacentRapidBoxes(mixed,boxes[i].id);
    assert.equal(walk.current.id,boxes[i].id);
    assert.equal(walk.previous?.id??null,boxes[i-1]?.id??null);
    assert.equal(walk.next?.id??null,boxes[i+1]?.id??null);
    assert.equal(rapidLocationHref(walk.current),`/carga/ubicacion/${boxes[i].id}`);
  }
  const original=orderedCompartments(towers);
  for(let i=0;i<72;i++){
    const walk=adjacentCompartments(towers,original[i].codigo);
    assert.equal(walk.previous?.id??null,original[i-1]?.id??null);
    assert.equal(walk.next?.id??null,original[i+1]?.id??null);
    assert.equal(rapidLocationHref(walk.current),`/carga/${original[i].codigo}`);
  }
  assert.equal(adjacentRapidBoxes(mixed,towers[0].id).current,null);
  assert.equal(adjacentRapidBoxes([],1000).next,null);
});

test('Continuar conserva clave antigua y recupera cajas renombradas por ID',()=>{
  const data=new Map([[LAST_RAPID_LOCATION,'C264']]);
  const storage={setItem:(key,value)=>data.set(key,value)};
  rememberRapidLocation(storage,boxes[0]);
  assert.equal(data.get(LAST_RAPID_LOCATION),'C264');
  assert.deepEqual(JSON.parse(data.get(LAST_RAPID_LOCATION_V2)),{version:2,tipo:'caja',id:1000});
  const renamed=[{...boxes[0],codigo:'MOTORES'},...boxes.slice(1),...towers];
  assert.equal(resolveLastRapidLocation(data.get(LAST_RAPID_LOCATION_V2),'C264',renamed).codigo,'MOTORES');
  rememberRapidLocation(storage,towers[0]);
  assert.equal(data.get(LAST_RAPID_LOCATION),towers[0].codigo);
  assert.equal(resolveLastRapidLocation(data.get(LAST_RAPID_LOCATION_V2),'C264',renamed).tipo,'compartimiento');
});

test('preferencias corruptas, IDs ajenos y storage bloqueado no bloquean la carga',()=>{
  for(const value of ['', 'broken', 'null', '[]', '{}', '{"version":2,"tipo":"caja","id":161}', '{"version":2,"tipo":"caja","id":9999}', '{"version":2,"tipo":"caja","id":"1000"}', '{"version":3,"tipo":"caja","id":1000}']){
    assert.equal(resolveLastRapidLocation(value,'C264',[...towers,...boxes]).codigo,'C264');
    assert.equal(resolveLastRapidLocation(value,'desconocido',[...towers,...boxes]),null);
  }
  assert.doesNotThrow(()=>rememberRapidLocation({setItem(){throw new Error('Storage disabled')}},boxes[0]));
  assert.equal(resolveLastRapidLocation('','A1',boxes),null);
});
