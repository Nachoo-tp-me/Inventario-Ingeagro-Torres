-- Solo lo invoca el runner que crea su propio clúster PostgreSQL local.
-- Datos anteriores a la ampliación: stock e historial NO vacíos.
insert into public.productos (id, nombre, categoria_id)
values ('00000000-0000-0000-0000-000000000101', 'TEST ANTERIOR A ESTANTES',
        (select id from public.categorias where nombre = 'Otros'));
set role authenticated;
set "request.jwt.claim.sub" = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058';
insert into public.movimientos (producto_id, tipo, cantidad, destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000101', 'entrada', 9, id
from public.compartimientos where codigo = 'C111';
insert into public.movimientos (producto_id, tipo, cantidad, origen_compartimiento_id, destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000101', 'traslado', 2,
       (select id from public.compartimientos where codigo = 'C111'),
       (select id from public.compartimientos where codigo = 'C112');
reset role;
reset "request.jwt.claim.sub";

create schema test_support;
create table test_support.compartimientos_antes as select * from public.compartimientos;
create table test_support.productos_antes as select * from public.productos;
create table test_support.inventario_antes as select * from public.inventario;
create table test_support.movimientos_antes as select * from public.movimientos;
create table test_support.funciones_antes as
select oid, pg_catalog.pg_get_functiondef(oid) as definicion from pg_catalog.pg_proc
where oid in ('public.aplicar_movimiento()'::regprocedure,
              'public.registrar_ajuste_fisico(uuid,bigint,integer,integer)'::regprocedure,
              'public.crear_compartimientos_de_torre()'::regprocedure,
              'public.impedir_modificacion_movimiento()'::regprocedure);
create table test_support.politicas_antes as select * from pg_catalog.pg_policies
where schemaname = 'public';

create function test_support.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'FAIL: %', message; end if;
end;
$$;
create function test_support.expect_failure(statement text, expected_states text[])
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = any(expected_states) then return; end if;
    raise;
  end;
  raise exception 'FAIL: SQL inválido aceptado: %', statement;
end;
$$;
grant usage on schema test_support to anon, authenticated;

select test_support.assert_true((select count(*) from public.compartimientos) = 72, 'base de 72 compartimientos');
select test_support.assert_true((select count(*) from public.movimientos) = 2, 'historial anterior no vacío');
