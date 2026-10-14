-- Mapa real confirmado por Nacho, probado SOLO sobre IDs y stock sintéticos.
-- No es seed ni migración; toda esta demostración revierte.
-- Frente del estante: 1=superior izquierda, 2=superior derecha,
-- 3=inferior izquierda, 4=inferior derecha. El grupo no depende del código.
begin;
create temporary table mapa_ids_antes on commit drop as
select id,estante_id,posicion from public.compartimientos where tipo='caja';
update public.compartimientos set codigo =
  case when estante_id <= 3 then 'A' || ((estante_id-1)*4+posicion)::text
       else 'B' || ((estante_id-4)*4+posicion)::text end
where tipo='caja';
select test_support.assert_true((select array_agg(codigo order by estante_id,posicion)
  from public.compartimientos where tipo='caja') = array[
  'A1','A2','A3','A4','A5','A6','A7','A8','A9','A10','A11','A12',
  'B1','B2','B3','B4','B5','B6','B7','B8','B9','B10','B11','B12'
], 'mapa inicial por estante y posición');
select test_support.assert_true((select array_agg(grupo order by id) from public.estantes)
  = array['A','A','A','B','B','B'], 'seis estantes independientes agrupados A/B');
select test_support.assert_true(not exists(select 1 from mapa_ids_antes b
  join public.compartimientos c using(id) where c.estante_id<>b.estante_id or c.posicion<>b.posicion), 'posiciones permanentes tras etiquetado');
insert into public.productos(id,nombre,categoria_id)
values('00000000-0000-0000-0000-000000000402','TEST MAPA CONFIRMADO',
  (select id from public.categorias where nombre='Otros'));
set local role authenticated;
set local "request.jwt.claim.sub"='d5211ae5-39c6-4365-ad35-e6f6bdcc8058';
insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000402','entrada',7,id
from public.compartimientos where codigo='A1';
insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000402','entrada',3,id
from public.compartimientos where codigo='B12';
reset role;
update public.compartimientos set codigo='Z20' where codigo='A1';
select test_support.assert_true(exists(select 1 from public.compartimientos c
  join public.estantes e on e.id=c.estante_id join public.inventario i on i.compartimiento_id=c.id
  where c.codigo='Z20' and c.estante_id=1 and c.posicion=1 and e.grupo='A'
    and i.producto_id='00000000-0000-0000-0000-000000000402' and i.cantidad=7), 'renombrado no cambia grupo, ubicación ni stock');
select test_support.assert_true((select count(distinct compartimiento_id) from public.ubicacion_codigos
  where codigo in ('A1','Z20'))=1, 'A1 y Z20 resuelven mismo ID');
select test_support.assert_true(exists(select 1 from public.movimientos
  where producto_id='00000000-0000-0000-0000-000000000402' and codigo_destino='A1'), 'movimiento conserva etiqueta inicial A1');
select test_support.expect_failure($q$update public.compartimientos set codigo='A1' where codigo='B2'$q$,array['23505']);
update public.compartimientos set codigo='A1' where codigo='Z20';
select test_support.assert_true((select sum(cantidad) from public.inventario
  where producto_id='00000000-0000-0000-0000-000000000402')=10, 'recuperación de código mantiene existencias');
set constraints all immediate;
\echo PASS mapa A1-A12/B1-B12, cuadrícula física y renombrado Z20
rollback;
