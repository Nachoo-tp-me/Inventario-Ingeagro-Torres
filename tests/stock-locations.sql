-- Solo el clúster privado creado por physical-locations.local.mjs.
-- Fixtures sintéticos de 96 ubicaciones; ningún cambio sobrevive al rollback.
begin;
insert into public.productos(id,nombre,categoria_id)
select '00000000-0000-0000-0000-000000000501','TEST STOCK CAJAS',id from public.categorias where nombre='Otros';

set local role authenticated;
set local "request.jwt.claim.sub"='d5211ae5-39c6-4365-ad35-e6f6bdcc8058';

do $$
declare
  p constant uuid := '00000000-0000-0000-0000-000000000501';
  b1 bigint := (select id from public.compartimientos where codigo='TEST_E1_P1');
  b2 bigint := (select id from public.compartimientos where codigo='TEST_E6_P4');
  t1 bigint := (select id from public.compartimientos where codigo='C111');
  t2 bigint := (select id from public.compartimientos where codigo='C211');
  t3 bigint := (select id from public.compartimientos where codigo='C311');
  m bigint;
  inventory_before jsonb;
  history_before jsonb;
begin
  if b1 is null or b2 is null or t1 is null or t2 is null or t3 is null then
    raise exception 'Fixtures incompletos';
  end if;
  if (select count(*) from public.compartimientos where tipo='compartimiento') <> 72 or
     (select count(*) from public.compartimientos where tipo='caja') <> 24 then
    raise exception 'No están las tres torres y seis estantes';
  end if;
  -- Entrada/retiro/ajuste en caja con el mismo trigger/RPC existente.
  insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id) values(p,'entrada',10,b1);
  insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id) values(p,'retiro',2,b1);
  perform public.registrar_ajuste_fisico(p,b1,12,8);
  if (select cantidad from public.inventario where producto_id=p and compartimiento_id=b1) is distinct from 12 then
    raise exception 'Entrada/retiro/ajuste de caja incorrectos';
  end if;
  if public.registrar_ajuste_fisico(p,b1,12,12) is not null then raise exception 'Ajuste sin delta creó historial'; end if;
  raise notice 'PASS agregar, retirar y ajustar caja (sin delta no crea movimiento)';

  insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id) values(p,'entrada',5,t1);
  insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id)
    values(p,'traslado',3,t1,b2) returning id into m;
  if not exists(select 1 from public.movimientos where id=m and origen_compartimiento_id=t1 and destino_compartimiento_id=b2
    and codigo_origen='C111' and codigo_destino='TEST_E6_P4') then raise exception 'IDs/snapshots torre-caja incorrectos'; end if;
  insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id) values(p,'traslado',5,b1,t2);
  insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id) values(p,'traslado',2,b1,b2);
  insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id) values(p,'traslado',1,t2,t3);
  if (select cantidad from public.inventario where producto_id=p and compartimiento_id=b1) is distinct from 5 or
     (select cantidad from public.inventario where producto_id=p and compartimiento_id=b2) is distinct from 5 or
     (select cantidad from public.inventario where producto_id=p and compartimiento_id=t1) is distinct from 2 or
     (select cantidad from public.inventario where producto_id=p and compartimiento_id=t2) is distinct from 4 or
     (select cantidad from public.inventario where producto_id=p and compartimiento_id=t3) is distinct from 1 or
     (select sum(cantidad) from public.inventario where producto_id=p) <> 17 then
    raise exception 'Traslados perdieron cantidades o usaron ubicaciones incorrectas';
  end if;
  raise notice 'PASS torre-caja, caja-torre, caja-caja y torre-torre; conservación total 17';

  select jsonb_agg(to_jsonb(i) order by compartimiento_id) into inventory_before from public.inventario i where producto_id=p;
  select jsonb_agg(to_jsonb(v) order by id) into history_before from public.movimientos v where producto_id=p;
  begin
    insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id) values(p,'traslado',6,b1,b2);
    raise exception 'Stock insuficiente aceptado';
  exception when check_violation then null; end;
  begin
    insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id) values(p,'retiro',6,b1);
    raise exception 'Retiro excesivo aceptado';
  exception when check_violation then null; end;
  begin
    perform public.registrar_ajuste_fisico(p,b1,10,4);
    raise exception 'Lectura obsoleta aceptada';
  exception when sqlstate '40001' then null; end;
  begin
    insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id) values(p,'traslado',1,b1,999999);
    raise exception 'Destino inexistente aceptado';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id) values(p,'traslado',1,999999,b2);
    raise exception 'Origen inexistente aceptado';
  exception when foreign_key_violation then null; end;
  begin
    perform public.registrar_ajuste_fisico(p,999999,0,0);
    raise exception 'Ajuste de ubicación inexistente aceptado';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id) values(p,'traslado',1,b1,b1);
    raise exception 'Misma caja de origen y destino aceptada';
  exception when check_violation then null; end;
  begin
    insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id) values(p,'entrada',0,b1);
    raise exception 'Cantidad inválida aceptada';
  exception when check_violation then null; end;
  -- Incluso un fallo posterior al trigger revierte stock e historial.
  begin
    insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id) values(p,'traslado',1,b1,b2);
    perform 1/0;
  exception when division_by_zero then null; end;
  if (select jsonb_agg(to_jsonb(i) order by compartimiento_id) from public.inventario i where producto_id=p) is distinct from inventory_before or
     (select jsonb_agg(to_jsonb(v) order by id) from public.movimientos v where producto_id=p) is distinct from history_before then
    raise exception 'Errores dejaron cambios parciales';
  end if;
  raise notice 'PASS stock insuficiente, IDs inválidos, lectura obsoleta, mismo destino y rollback integral';
  begin
    update public.inventario set cantidad=99 where producto_id=p and compartimiento_id=b1;
    raise exception 'Escritura directa de stock permitida';
  exception when insufficient_privilege then null; end;
end;
$$;

set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000999';
do $$
begin
  if exists(select 1 from public.compartimientos) or exists(select 1 from public.inventario) or exists(select 1 from public.movimientos) then
    raise exception 'RLS filtra de manera diferente torres/cajas';
  end if;
  begin
    insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id) values('00000000-0000-0000-0000-000000000501','entrada',1,73);
    raise exception 'Otro usuario pudo escribir';
  exception when insufficient_privilege then null; end;
  begin
    perform public.registrar_ajuste_fisico('00000000-0000-0000-0000-000000000501',73,1,0);
    raise exception 'Otro usuario pudo ajustar';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.inventario;
    raise exception 'Anon pudo leer stock';
  exception when insufficient_privilege then null; end;
  begin
    perform public.registrar_ajuste_fisico('00000000-0000-0000-0000-000000000501',73,1,0);
    raise exception 'Anon pudo ajustar';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select 'PASS autorización/RLS comunes; usuario ajeno y anon rechazados';
select 'PASS siete operaciones, IDs/snapshots correctos y conservación de cantidades';
select 'PASS errores de stock/ubicación, lectura obsoleta y rollback sin cambios parciales';
rollback;
