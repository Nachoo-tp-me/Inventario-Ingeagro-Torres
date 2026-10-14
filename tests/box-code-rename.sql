-- PostgreSQL desechable del runner; mapa aprobado sobre cajas sintéticas existentes.
begin;
update public.compartimientos set codigo = case when estante_id <= 3
  then 'A'||((estante_id-1)*4+posicion)::text else 'B'||((estante_id-4)*4+posicion)::text end where tipo='caja';
insert into public.productos(id,nombre,categoria_id)
select '00000000-0000-0000-0000-000000000601','TEST RENOMBRADO',id from public.categorias where nombre='Otros';
set local role authenticated;
set local "request.jwt.claim.sub"='d5211ae5-39c6-4365-ad35-e6f6bdcc8058';
insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000601','entrada',7,id from public.compartimientos where codigo='A1';
do $$
declare
  v_id bigint := (select id from public.compartimientos where codigo='A1');
  v_original jsonb := (select to_jsonb(c)-'codigo' from public.compartimientos c where id=v_id);
  v_inventory jsonb := (select jsonb_agg(to_jsonb(i) order by producto_id,compartimiento_id) from public.inventario i);
  v_movements jsonb := (select jsonb_agg(to_jsonb(m) order by id) from public.movimientos m);
  v_audits bigint;
  v_result record;
  v_code text;
  v_registry jsonb;
  v_history jsonb;
begin
  if not has_function_privilege('authenticated','public.renombrar_codigo_caja(bigint,text,text)','execute') or
    has_function_privilege('anon','public.renombrar_codigo_caja(bigint,text,text)','execute') or
    has_function_privilege('service_role','public.renombrar_codigo_caja(bigint,text,text)','execute') or
    has_table_privilege('authenticated','public.compartimientos','update') then raise exception 'ACL incorrectas'; end if;
  if not exists(select 1 from pg_proc where oid='public.renombrar_codigo_caja(bigint,text,text)'::regprocedure
      and prosecdef and proconfig @> array['search_path=""']) then raise exception 'SECURITY DEFINER/search_path incorrectos'; end if;

  select * into v_result from public.renombrar_codigo_caja(v_id,' a1 ',' motores_1 ');
  if v_result.ubicacion_id <> v_id or v_result.estante_id <> 1 or v_result.codigo <> 'MOTORES_1' or v_result.sin_cambios then raise exception 'Respuesta/normalización incorrectas'; end if;
  select count(*) into v_audits from public.cambios_codigo_ubicacion where compartimiento_id=v_id;
  select * into v_result from public.renombrar_codigo_caja(v_id,'MOTORES_1',' motores_1 ');
  if not v_result.sin_cambios or (select count(*) from public.cambios_codigo_ubicacion where compartimiento_id=v_id) <> v_audits then raise exception 'No-op creó auditoría'; end if;
  perform public.renombrar_codigo_caja(v_id,'MOTORES_1','A1');
  if (select codigo from public.compartimientos where id=v_id) <> 'A1' or
     (select count(*) from public.ubicacion_codigos where codigo in ('A1','MOTORES_1') and compartimiento_id=v_id) <> 2 then raise exception 'Recuperación de alias propio incorrecta'; end if;
  if not exists(select 1 from public.cambios_codigo_ubicacion where compartimiento_id=v_id and codigo_anterior='A1' and codigo_nuevo='MOTORES_1' and actor_id=auth.uid()) or
     not exists(select 1 from public.cambios_codigo_ubicacion where compartimiento_id=v_id and codigo_anterior='MOTORES_1' and codigo_nuevo='A1' and actor_id=auth.uid()) then raise exception 'Auditoría/actor incorrectos'; end if;

  select jsonb_agg(to_jsonb(r) order by codigo) into v_registry from public.ubicacion_codigos r;
  select jsonb_agg(to_jsonb(a) order by id) into v_history from public.cambios_codigo_ubicacion a;
  begin
    perform public.renombrar_codigo_caja((select id from public.compartimientos where codigo='A2'),'A2','A1');
    raise exception 'Código actual ajeno permitido';
  exception when unique_violation then null; end;
  begin
    perform public.renombrar_codigo_caja((select id from public.compartimientos where codigo='A2'),'A2','MOTORES_1');
    raise exception 'Código histórico ajeno permitido';
  exception when unique_violation then null; end;
  foreach v_code in array array['C123','c999','C1','','A B','-A1','_A1',repeat('X',25),'MÓDULO','ß',E'A1\n',E'\tA1'] loop
    begin
      perform public.renombrar_codigo_caja(v_id,'A1',v_code);
      raise exception 'Código inválido aceptado: %',v_code;
    exception when sqlstate '22023' then null; end;
  end loop;
  begin
    perform public.renombrar_codigo_caja((select id from public.compartimientos where codigo='C111'),'C111','CAJA_TORRE');
    raise exception 'Torre renombrada';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.renombrar_codigo_caja(v_id,'MOTORES_1','A1');
    raise exception 'Código esperado obsoleto aceptado incluso en no-op';
  exception when sqlstate '40001' then null; end;
  begin
    perform public.renombrar_codigo_caja(999999,'A1','CAJA_NUEVA');
    raise exception 'ID inexistente aceptado';
  exception when foreign_key_violation then null; end;
  begin
    perform public.renombrar_codigo_caja(null,'A1','CAJA_NUEVA');
    raise exception 'ID nulo aceptado';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.renombrar_codigo_caja(v_id,'A1','CAMBIO_REVERTIDO');
    perform 1/0;
  exception when division_by_zero then null; end;
  if (select jsonb_agg(to_jsonb(r) order by codigo) from public.ubicacion_codigos r) is distinct from v_registry or
     (select jsonb_agg(to_jsonb(a) order by id) from public.cambios_codigo_ubicacion a) is distinct from v_history or
     (select to_jsonb(c)-'codigo' from public.compartimientos c where id=v_id) is distinct from v_original or
     (select codigo from public.compartimientos where id=v_id) <> 'A1' or
     (select jsonb_agg(to_jsonb(i) order by producto_id,compartimiento_id) from public.inventario i) is distinct from v_inventory or
     (select jsonb_agg(to_jsonb(m) order by id) from public.movimientos m) is distinct from v_movements then raise exception 'Error/renombrado alteró filas o relaciones'; end if;
  -- Permitir el límite exacto y volver al alias propio, conservando el ID.
  perform public.renombrar_codigo_caja(v_id,'A1',repeat('X',24));
  perform public.renombrar_codigo_caja(v_id,repeat('X',24),'A1');
  begin
    update public.compartimientos set codigo='UPDATE_DIRECTO' where id=v_id;
    raise exception 'UPDATE general permitido';
  exception when insufficient_privilege then null; end;
end;
$$;
select 'PASS RPC: normalización, código idéntico, alias propio, códigos ajenos/reservados y formato';
select 'PASS RPC: IDs, posiciones, productos, cantidades e historial de movimientos conservados';
select 'PASS RPC: auditoría/actor, permisos mínimos, lectura obsoleta y rollback integral';

set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000999';
do $$ begin
  begin perform public.renombrar_codigo_caja(1,'A1','PROHIBIDO'); raise exception 'Otro usuario autorizado';
  exception when insufficient_privilege then null; end;
end $$;
set local "request.jwt.claim.sub"='';
do $$ begin
  begin perform public.renombrar_codigo_caja(1,'A1','PROHIBIDO'); raise exception 'JWT ausente autorizado';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.renombrar_codigo_caja(1,'A1','PROHIBIDO'); raise exception 'Anon autorizado';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS RPC: usuario ajeno, JWT ausente y anon rechazados';
rollback;
