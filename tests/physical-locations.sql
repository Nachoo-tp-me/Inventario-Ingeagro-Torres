-- PostgreSQL real, propietario y roles API reales; no se conecta a Supabase.
-- Las 24 etiquetas son ficticias y NO se incluyen en migraciones ni seed.

select test_support.assert_true(not exists (
  (select id,torre_id,piso,posicion,codigo from public.compartimientos
   except select * from test_support.compartimientos_antes)
  union all
  (select * from test_support.compartimientos_antes
   except select id,torre_id,piso,posicion,codigo from public.compartimientos)
), 'IDs, códigos y topología originales idénticos');
select test_support.assert_true(not exists (
  (select * from public.productos except select * from test_support.productos_antes)
  union all (select * from test_support.productos_antes except select * from public.productos)
), 'productos originales idénticos');
select test_support.assert_true(not exists (
  (select * from public.inventario except select * from test_support.inventario_antes)
  union all (select * from test_support.inventario_antes except select * from public.inventario)
), 'cantidades y relaciones originales idénticas');
select test_support.assert_true(not exists (
  (select id,producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id,fecha
   from public.movimientos except select * from test_support.movimientos_antes)
  union all
  (select * from test_support.movimientos_antes except
   select id,producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id,fecha from public.movimientos)
), 'movimientos originales idénticos');
select test_support.assert_true(not exists (select 1 from public.movimientos
  where codigo_origen is not null or codigo_destino is not null), 'sin backfill de historial');
select test_support.assert_true(not exists (select 1 from test_support.funciones_antes
  where definicion <> pg_catalog.pg_get_functiondef(oid)), 'motor, ajuste y trigger de torres sin cambios');
select test_support.assert_true(not exists (
  select * from test_support.politicas_antes except select * from pg_catalog.pg_policies
), 'políticas existentes conservadas');
select test_support.assert_true((select attgenerated = '' from pg_catalog.pg_attribute
  where attrelid = 'public.compartimientos'::regclass and attname = 'codigo'), 'conversión de columna generada');
\echo PASS conservación de base con stock e historial anteriores

select test_support.expect_failure($q$
  insert into public.estantes(id) values(1);
  insert into public.compartimientos(tipo,estante_id,posicion,codigo)
  select 'caja',1,p,'TEST_INCOMPLETO_'||p from generate_series(1,3) p;
  set constraints estantes_cuatro_cajas immediate;
$q$,array['23514']);
select test_support.assert_true((select count(*) from public.estantes)=0, 'estante incompleto revierte');
select test_support.assert_true(not exists(select 1 from public.ubicacion_codigos
  where codigo like 'TEST_INCOMPLETO_%'), 'códigos de estante incompleto revierten');
begin;
insert into public.estantes (id) select generate_series(1,6);
insert into public.compartimientos (tipo, estante_id, posicion, codigo)
select 'caja', estante, posicion, ' test_e' || estante::text || '_p' || posicion::text || ' '
from generate_series(1,6) as estante cross join generate_series(1,4) as posicion;
commit;
select test_support.assert_true((select count(*) from public.compartimientos) = 96, '96 ubicaciones');
select test_support.assert_true((select count(*) from public.compartimientos where tipo = 'caja') = 24, '24 cajas');
select test_support.assert_true((select count(*) from public.ubicacion_codigos) = 96, 'registro central completo');
select test_support.assert_true(not exists (select 1 from public.compartimientos c
  left join public.ubicacion_codigos r on r.codigo = c.codigo and r.compartimiento_id = c.id
  where r.codigo is null), 'código actual y dueño consistentes');
select test_support.assert_true((select count(*) from pg_catalog.pg_constraint
  where conrelid='public.compartimientos'::regclass and contype='c' and convalidated
    and conkey=array[(select attnum from pg_catalog.pg_attribute
      where attrelid='public.compartimientos'::regclass and attname='posicion')])=1,
  'un único CHECK existente y validado para posición');
select 'PASS esquema de posición: ' || pg_catalog.pg_get_constraintdef(oid)
from pg_catalog.pg_constraint
where conrelid='public.compartimientos'::regclass and conname='compartimientos_posicion_check';

-- Todo lo siguiente revierte. El escenario 96 permanece para concurrencia.
begin;
select test_support.expect_failure($q$insert into public.estantes(id) values (7)$q$, array['23514']);
select test_support.expect_failure($q$insert into public.compartimientos(tipo,estante_id,posicion,codigo)
  values ('otro',1,1,'TEST_TIPO')$q$, array['23514']);
select test_support.expect_failure($q$insert into public.compartimientos(tipo,posicion,codigo)
  values ('caja',1,'TEST_SIN_ESTANTE')$q$, array['23514']);
select test_support.expect_failure($q$insert into public.compartimientos(tipo,torre_id,piso,estante_id,posicion,codigo)
  values ('caja',1,1,1,1,'TEST_MIXTO')$q$, array['23514']);
select test_support.expect_failure($q$insert into public.compartimientos(tipo,estante_id,posicion,codigo)
  values ('caja',7,1,'TEST_ESTANTE_FK')$q$, array['23503']);
select test_support.expect_failure($q$insert into public.compartimientos(tipo,estante_id,posicion,codigo)
  values ('caja',1,5,'TEST_POSICION')$q$, array['23514']);
select test_support.expect_failure($q$insert into public.compartimientos(tipo,estante_id,posicion,codigo)
  values ('caja',1,0,'TEST_POSICION_CERO')$q$, array['23514']);
select test_support.expect_failure($q$insert into public.compartimientos(tipo,estante_id,posicion,codigo)
  values ('caja',1,1,'TEST_POS_REPETIDA')$q$, array['23505']);
select test_support.expect_failure($q$insert into public.compartimientos(tipo,estante_id,posicion,codigo)
  values ('caja',1,4,'TEST_QUINTA_CAJA')$q$, array['23505']);
select test_support.assert_true((select count(*) from public.compartimientos where estante_id=1)=4,
  'posición 0/5, duplicada y quinta caja rechazadas sin alterar las cuatro existentes');
\echo PASS posiciones 0 y 5 rechazadas (23514); duplicada y quinta caja rechazadas (23505)
select test_support.expect_failure($q$update public.compartimientos set codigo = '' where codigo = 'TEST_E1_P1'$q$, array['23514']);
select test_support.expect_failure($q$update public.compartimientos set codigo = null where codigo = 'TEST_E1_P1'$q$, array['23502']);
select test_support.expect_failure($q$update public.compartimientos set codigo = 'Á1' where codigo = 'TEST_E1_P1'$q$, array['23514']);
select test_support.expect_failure($q$update public.compartimientos set codigo = 'A 1' where codigo = 'TEST_E1_P1'$q$, array['23514']);
select test_support.expect_failure($q$update public.compartimientos set codigo = '-A1' where codigo = 'TEST_E1_P1'$q$, array['23514']);
select test_support.expect_failure($q$update public.compartimientos set codigo = repeat('A',25) where codigo = 'TEST_E1_P1'$q$, array['23514']);
update public.compartimientos set codigo = repeat('A',24) where codigo = 'TEST_E1_P1';
update public.compartimientos set codigo = 'TEST_E1_P1' where codigo = repeat('A',24);
select test_support.expect_failure($q$update public.compartimientos set codigo = 'TEST_E1_P2' where codigo = 'TEST_E1_P1'$q$, array['23505']);
select test_support.expect_failure($q$update public.compartimientos set codigo = 'C111' where codigo = 'TEST_E1_P1'$q$, array['23514']);
select test_support.expect_failure($q$update public.compartimientos set codigo = 'C999' where codigo = 'TEST_E1_P1'$q$, array['23514']);
select test_support.expect_failure($q$update public.compartimientos set codigo = 'c999' where codigo = 'TEST_E1_P1'$q$, array['23514']);
select test_support.expect_failure($q$update public.compartimientos set codigo = 'C1' where codigo = 'TEST_E1_P1'$q$, array['23514']);
select test_support.assert_true(not exists(select 1 from public.ubicacion_codigos where codigo='C999'),
  'rechazo de C999/c999 no deja una reserva');
\echo PASS C999/c999 rechazados tras normalización (23514); códigos Cxyz originales conservados
select test_support.expect_failure($q$update public.compartimientos set estante_id = 2 where codigo = 'TEST_E1_P1'$q$, array['55000']);
select test_support.expect_failure($q$update public.compartimientos set id = id + 10000 where codigo = 'TEST_E1_P1'$q$, array['428C9']);
select test_support.expect_failure($q$update public.compartimientos set id = default where codigo = 'TEST_E1_P1'$q$, array['55000']);
select test_support.expect_failure($q$update public.compartimientos set posicion = 2 where codigo = 'TEST_E1_P1'$q$, array['55000']);
select test_support.expect_failure($q$update public.compartimientos set tipo = 'compartimiento',torre_id=1,piso=1,estante_id=null where codigo = 'TEST_E1_P1'$q$, array['55000']);
select test_support.expect_failure($q$update public.compartimientos set piso = 2 where codigo = 'C111'$q$, array['55000']);
select test_support.expect_failure($q$update public.compartimientos set codigo = 'TEST_TORRE' where codigo = 'C111'$q$, array['55000']);
select test_support.expect_failure($q$delete from public.compartimientos where codigo = 'TEST_E1_P1'$q$, array['55000']);
select test_support.expect_failure($q$update public.estantes set id = 6 where id = 1$q$, array['55000']);
select test_support.expect_failure($q$delete from public.estantes where id = 1$q$, array['55000']);
\echo PASS estructura, formato, unicidad actual y topología fija

-- Códigos válidos de caja; los anteriores siguen reservados al mismo ID.
set local "request.jwt.claim.sub" = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058';
update public.compartimientos set codigo = ' a6 ' where codigo = 'TEST_E1_P1';
select test_support.assert_true((select count(*) from public.compartimientos where codigo = 'A6') = 1, 'caja A6 válida y normalizada');
update public.compartimientos set codigo = 'MOTORES_1' where codigo = 'A6';
select test_support.assert_true((select count(*) from public.compartimientos where codigo = 'MOTORES_1') = 1, 'caja MOTORES_1 válida');
update public.compartimientos set codigo = ' b10 ' where codigo = 'MOTORES_1';
select test_support.assert_true((select count(*) from public.compartimientos where codigo = 'B10') = 1, 'caja B10 válida y normalizada');
select test_support.assert_true((select count(distinct compartimiento_id) from public.ubicacion_codigos
  where codigo in ('A6','MOTORES_1','B10','TEST_E1_P1')) = 1, 'códigos válidos comparten dueño permanente');
\echo PASS A6, B10 y MOTORES_1 aceptados; normalización existente conservada
select test_support.assert_true((select actor_id from public.cambios_codigo_ubicacion
  where codigo_nuevo = 'B10') = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid, 'actor de auditoría');
insert into public.productos (id,nombre,categoria_id)
values ('00000000-0000-0000-0000-000000000201','TEST PRODUCTO EN CAJAS',
        (select id from public.categorias where nombre='Otros'));
set local role authenticated;
insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000201','entrada',10,id from public.compartimientos where codigo='B10';
reset role;
update public.compartimientos set codigo = 'TEST_E1_P1' where codigo = 'B10';
select test_support.assert_true((select count(distinct compartimiento_id) from public.ubicacion_codigos
  where codigo in ('B10','TEST_E1_P1')) = 1, 'códigos actual e histórico resuelven mismo ID');
select test_support.assert_true((select codigo_destino from public.movimientos
  where producto_id='00000000-0000-0000-0000-000000000201') = 'B10', 'instantánea anterior al renombrado intacta');
select test_support.expect_failure($q$update public.compartimientos set codigo='B10' where codigo='TEST_E1_P2'$q$, array['23505']);
update public.compartimientos set codigo='B10' where codigo='TEST_E1_P1';
update public.compartimientos set codigo='TEST_E1_P1' where codigo='B10';
select test_support.expect_failure($q$update public.ubicacion_codigos set compartimiento_id=1 where codigo='B10'$q$, array['55000']);
select test_support.expect_failure($q$delete from public.ubicacion_codigos where codigo='B10'$q$, array['55000']);
select test_support.expect_failure($q$update public.cambios_codigo_ubicacion set codigo_nuevo='C111'$q$, array['55000']);
select test_support.expect_failure($q$delete from public.cambios_codigo_ubicacion$q$, array['55000']);

-- Incluso sin el trigger de sincronización, la FK exige el dueño al COMMIT.
set constraints all immediate;
set constraints compartimientos_codigo_dueno_fk deferred;
select test_support.expect_failure($q$
  alter table public.compartimientos disable trigger compartimientos_registrar_codigo;
  update public.compartimientos set codigo='TEST_HUERFANO' where codigo='TEST_E1_P2';
  set constraints compartimientos_codigo_dueno_fk immediate;
$q$, array['23503']);
select test_support.assert_true((select tgenabled='O' from pg_catalog.pg_trigger
  where tgrelid='public.compartimientos'::regclass and tgname='compartimientos_registrar_codigo'), 'trigger restaurado por rollback');

do $$
begin
  begin
    update public.compartimientos set codigo='TEST_ROLLBACK' where codigo='TEST_E1_P2';
    update public.compartimientos set codigo='TEST_E1_P4' where codigo='TEST_E1_P3';
    raise exception 'FAIL: colisión aceptada';
  exception when unique_violation then null;
  end;
  perform test_support.assert_true(not exists(select 1 from public.ubicacion_codigos where codigo='TEST_ROLLBACK'), 'reserva revierte');
  perform test_support.assert_true(not exists(select 1 from public.cambios_codigo_ubicacion where codigo_nuevo='TEST_ROLLBACK'), 'auditoría revierte');
  perform test_support.assert_true(exists(select 1 from public.compartimientos where codigo='TEST_E1_P2'), 'código actual revierte');
end;
$$;
\echo PASS códigos históricos, recuperación, auditoría y rollback atómico

set local role authenticated;
select test_support.assert_true((select count(*) from public.estantes)=6, 'lectura autorizada de estantes');
select test_support.assert_true((select count(*) from public.compartimientos)=96, 'lectura autorizada de ubicaciones');
select test_support.expect_failure($q$update public.compartimientos set codigo='TEST_API' where codigo='TEST_E1_P1'$q$, array['42501']);
select test_support.expect_failure($q$delete from public.compartimientos where codigo='TEST_E1_P1'$q$, array['42501']);
select test_support.expect_failure($q$insert into public.compartimientos(tipo,estante_id,posicion,codigo)
  values('caja',1,1,'TEST_API')$q$, array['42501']);
select test_support.expect_failure($q$insert into public.estantes(id) values(6)$q$, array['42501']);
select test_support.expect_failure($q$insert into public.ubicacion_codigos(codigo,compartimiento_id) values('TEST_API',1)$q$, array['42501']);
select test_support.expect_failure($q$insert into public.cambios_codigo_ubicacion(compartimiento_id,codigo_anterior,codigo_nuevo) values(1,'C111','TEST_API')$q$, array['42501']);
select test_support.expect_failure($q$insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id,codigo_destino)
  values('00000000-0000-0000-0000-000000000201','entrada',1,1,'TEST_FALSO')$q$, array['42501']);
select test_support.assert_true(not has_function_privilege('authenticated','public.registrar_codigo_ubicacion()','execute'), 'trigger privilegiado no es RPC');
select test_support.assert_true(not has_function_privilege('anon','public.capturar_codigos_movimiento()','execute'), 'captura no accesible anónimamente');
select test_support.assert_true(not has_table_privilege('authenticated','public.inventario','update'), 'sin UPDATE de inventario');

-- Caja->caja, caja->torre, torre->caja: el mismo trigger aplica las cantidades.
insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000201','traslado',4,
 (select id from public.compartimientos where codigo='TEST_E1_P1'),
 (select id from public.compartimientos where codigo='TEST_E1_P2');
insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000201','traslado',2,
 (select id from public.compartimientos where codigo='TEST_E1_P2'),
 (select id from public.compartimientos where codigo='C111');
insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000201','traslado',1,
 (select id from public.compartimientos where codigo='C111'),
 (select id from public.compartimientos where codigo='TEST_E1_P2');
select test_support.assert_true((select sum(cantidad) from public.inventario
  where producto_id='00000000-0000-0000-0000-000000000201')=10, 'traslados conservan unidades');
select public.registrar_ajuste_fisico('00000000-0000-0000-0000-000000000201',
  (select id from public.compartimientos where codigo='TEST_E1_P2'),5,3);
select test_support.expect_failure($q$select public.registrar_ajuste_fisico('00000000-0000-0000-0000-000000000201',
  (select id from public.compartimientos where codigo='TEST_E1_P2'),9,3)$q$, array['40001']);
insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id)
select '00000000-0000-0000-0000-000000000201','retiro',5,id from public.compartimientos where codigo='TEST_E1_P2';
select test_support.assert_true(not exists(select 1 from public.inventario
  where producto_id='00000000-0000-0000-0000-000000000201' and compartimiento_id=
  (select id from public.compartimientos where codigo='TEST_E1_P2')), 'caja a cero libera existencias');
select test_support.expect_failure($q$insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id)
  select '00000000-0000-0000-0000-000000000201','traslado',999,
  (select id from public.compartimientos where codigo='TEST_E1_P1'),
  (select id from public.compartimientos where codigo='TEST_E1_P3')$q$, array['23514']);
select test_support.assert_true(not exists(select 1 from public.movimientos
  where producto_id='00000000-0000-0000-0000-000000000201' and
  ((origen_compartimiento_id is not null and codigo_origen is null) or
   (destino_compartimiento_id is not null and codigo_destino is null))), 'movimientos nuevos con instantáneas');
select test_support.expect_failure($q$update public.movimientos set codigo_destino='TEST_FALSO'$q$, array['42501']);

set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000099';
select test_support.assert_true((select count(*) from public.estantes)=0, 'RLS estantes otra cuenta');
select test_support.assert_true((select count(*) from public.ubicacion_codigos)=0, 'RLS códigos otra cuenta');
select test_support.assert_true((select count(*) from public.cambios_codigo_ubicacion)=0, 'RLS auditoría otra cuenta');
select test_support.expect_failure($q$insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id)
  values('00000000-0000-0000-0000-000000000201','entrada',1,1)$q$, array['42501']);
reset "request.jwt.claim.sub";
select test_support.assert_true((select count(*) from public.estantes)=0, 'RLS sin JWT');
select test_support.expect_failure($q$insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id)
  values('00000000-0000-0000-0000-000000000201','entrada',1,1)$q$, array['42501']);
set local role anon;
select test_support.expect_failure($q$select * from public.estantes$q$, array['42501']);
select test_support.expect_failure($q$select * from public.ubicacion_codigos$q$, array['42501']);
select test_support.expect_failure($q$select * from public.cambios_codigo_ubicacion$q$, array['42501']);
reset role;
select test_support.expect_failure($q$update public.movimientos set codigo_origen='TEST_FALSO' where id=1$q$, array['55000']);
select test_support.expect_failure($q$delete from public.movimientos where id=1$q$, array['55000']);

-- El trigger original de nuevas torres sigue generando 24 códigos Cxyz.
insert into public.torres(id) values(4);
select test_support.assert_true((select count(*) from public.compartimientos where torre_id=4)=24, 'trigger de torre compatible');
select test_support.assert_true(exists(select 1 from public.ubicacion_codigos where codigo='C464'), 'nueva torre registrada');
\echo PASS motor común, instantáneas, permisos/RLS e inmutabilidad
set constraints all immediate;
rollback;
select test_support.assert_true((select count(*) from public.compartimientos)=96, 'rollback completo conserva escenario 96');
