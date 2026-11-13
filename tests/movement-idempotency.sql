-- C2b: idempotencia de movimientos (solicitud_id UNIQUE). Solo el clúster privado creado por movement-idempotency.local.mjs.
-- Cada caso verifica movimientos Y saldo final del inventario; nunca solo el código de error. Todo se revierte al final.
begin;
insert into public.productos(id,nombre,categoria_id)
select '00000000-0000-0000-0000-000000000c01','TEST IDEMPOTENCIA',id from public.categorias where nombre='Otros';
insert into public.productos(id,nombre,categoria_id)
select '00000000-0000-0000-0000-000000000c02','TEST IDEMPOTENCIA HISTORICO',id from public.categorias where nombre='Otros';

set local role authenticated;
set local "request.jwt.claim.sub"='d5211ae5-39c6-4365-ad35-e6f6bdcc8058';

-- Esquema: columna nullable, restricción UNIQUE con NULL distintos, grant solo de INSERT, RPC de ajuste con la misma firma.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='movimientos'
                 and column_name='solicitud_id' and data_type='uuid' and is_nullable='YES') then
    raise exception 'solicitud_id debe existir como uuid NULL';
  end if;
  if (select count(*) from pg_constraint c where c.conrelid='public.movimientos'::regclass and c.conname='movimientos_solicitud_id_key' and c.contype='u') <> 1 then
    raise exception 'falta movimientos_solicitud_id_key';
  end if;
  if (select i.indnullsnotdistinct from pg_index i join pg_constraint c on c.conindid=i.indexrelid where c.conname='movimientos_solicitud_id_key') then
    raise exception 'NULLS NOT DISTINCT no está permitido';
  end if;
  if not has_column_privilege('authenticated','public.movimientos','solicitud_id','INSERT') then raise exception 'authenticated debe poder insertar solicitud_id'; end if;
  if has_column_privilege('authenticated','public.movimientos','solicitud_id','UPDATE') then raise exception 'authenticated no debe poder actualizar solicitud_id'; end if;
  if has_column_privilege('anon','public.movimientos','solicitud_id','INSERT') then raise exception 'anon no debe insertar'; end if;
  if pg_get_function_arguments('public.registrar_ajuste_fisico(uuid,bigint,integer,integer)'::regprocedure) <> 'p_producto_id uuid, p_compartimiento_id bigint, p_cantidad_fisica integer, p_cantidad_esperada integer' then
    raise exception 'la RPC de ajuste no debe cambiar';
  end if;
end;
$$;
select 'PASS esquema: columna NULL, UNIQUE sin NULLS NOT DISTINCT, grant solo INSERT para authenticated, RPC de ajuste intacta';

do $$
declare
  p constant uuid := '00000000-0000-0000-0000-000000000c01';
  h constant uuid := '00000000-0000-0000-0000-000000000c02';
  l1 constant bigint := (select id from public.compartimientos where codigo='C111');
  l2 constant bigint := (select id from public.compartimientos where codigo='C112');
  u1 constant uuid := '11111111-1111-4111-8111-111111111111';
  u2 constant uuid := '22222222-2222-4222-8222-222222222222';
  u3 constant uuid := '33333333-3333-4333-8333-333333333333';
  u4 constant uuid := '44444444-4444-4444-8444-444444444444';
  u5 constant uuid := '55555555-5555-4555-8555-555555555555';
  constraint_seen text;
  v_stock integer;
  v_count integer;
begin
  -- 1. INSERT normal con UUID: un movimiento y el stock aplicado una vez.
  insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,destino_compartimiento_id) values (u1,p,'entrada',10,l1);
  select count(*) into v_count from public.movimientos where solicitud_id=u1;
  select coalesce(sum(cantidad),0) into v_stock from public.inventario where producto_id=p and compartimiento_id=l1;
  if v_count <> 1 or v_stock <> 10 then raise exception '1: movimientos=% stock=%', v_count, v_stock; end if;

  -- 2. Segundo INSERT idéntico: rechazado por la restricción única y SIN segunda aplicación de stock.
  begin
    insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,destino_compartimiento_id) values (u1,p,'entrada',10,l1);
    raise exception '2: el INSERT repetido no fue rechazado';
  exception when unique_violation then
    get stacked diagnostics constraint_seen = constraint_name;
    if constraint_seen <> 'movimientos_solicitud_id_key' then raise exception '2: restricción inesperada %', constraint_seen; end if;
  end;
  select count(*) into v_count from public.movimientos where solicitud_id=u1;
  select coalesce(sum(cantidad),0) into v_stock from public.inventario where producto_id=p and compartimiento_id=l1;
  if v_count <> 1 or v_stock <> 10 then raise exception '2: tras el duplicado movimientos=% stock=%', v_count, v_stock; end if;

  -- 4. Mismo UUID con parámetros distintos (cantidad, ubicación y tipo): rechazado; la fila original no cambia; el stock tampoco.
  begin insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,destino_compartimiento_id) values (u1,p,'entrada',3,l1);
    raise exception '4a: cantidad distinta aceptada'; exception when unique_violation then null; end;
  begin insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,destino_compartimiento_id) values (u1,p,'entrada',10,l2);
    raise exception '4b: ubicación distinta aceptada'; exception when unique_violation then null; end;
  begin insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,origen_compartimiento_id) values (u1,p,'retiro',2,l1);
    raise exception '4c: tipo distinto aceptado'; exception when unique_violation then null; end;
  if (select count(*) from public.movimientos where solicitud_id=u1 and tipo='entrada' and cantidad=10 and destino_compartimiento_id=l1 and origen_compartimiento_id is null) <> 1 then
    raise exception '4: la fila original cambió';
  end if;
  select coalesce(sum(cantidad),0) into v_stock from public.inventario where producto_id=p;
  if v_stock <> 10 then raise exception '4: stock=%', v_stock; end if;

  -- 5. Dos movimientos legítimos con UUID distintos: dos filas y stock sumado dos veces.
  insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,destino_compartimiento_id) values (u2,p,'entrada',5,l1);
  insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,destino_compartimiento_id) values (u3,p,'entrada',5,l1);
  select coalesce(sum(cantidad),0) into v_stock from public.inventario where producto_id=p;
  select count(*) into v_count from public.movimientos where producto_id=p;
  if v_stock <> 20 or v_count <> 3 then raise exception '5: stock=% movimientos=%', v_stock, v_count; end if;

  -- 6 y 12. Stock insuficiente: error definitivo, ningún movimiento ni saldo cambiado y el UUID NO queda consumido;
  --        el mismo UUID con una solicitud válida funciona después.
  begin insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,origen_compartimiento_id) values (u4,p,'retiro',100,l1);
    raise exception '6: retiro sin stock aceptado'; exception when check_violation then null; end;
  if exists (select 1 from public.movimientos where solicitud_id=u4) then raise exception '6: el movimiento fallido dejó una fila'; end if;
  select coalesce(sum(cantidad),0) into v_stock from public.inventario where producto_id=p;
  if v_stock <> 20 then raise exception '6: stock=%', v_stock; end if;
  insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,origen_compartimiento_id) values (u4,p,'retiro',4,l1);
  select coalesce(sum(cantidad),0) into v_stock from public.inventario where producto_id=p;
  select count(*) into v_count from public.movimientos where solicitud_id=u4;
  if v_stock <> 16 or v_count <> 1 then raise exception '12: stock=% movimientos=%', v_stock, v_count; end if;

  -- 11. Reintento de un retiro cuando el stock ya se agotó: el duplicado se detecta ANTES (23505, no 23514) y no cambia nada.
  insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,origen_compartimiento_id) values (u5,p,'retiro',16,l1);
  if exists (select 1 from public.inventario where producto_id=p and compartimiento_id=l1) then raise exception '11: el stock debía quedar en cero'; end if;
  begin insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,origen_compartimiento_id) values (u5,p,'retiro',16,l1);
    raise exception '11: retiro repetido aceptado'; exception when unique_violation then null; end;
  select count(*) into v_count from public.movimientos where solicitud_id=u5;
  if v_count <> 1 or exists (select 1 from public.inventario where producto_id=p) then raise exception '11: movimientos=% o inventario no vacío', v_count; end if;

  -- 8. Movimientos históricos / V1 sin solicitud_id (NULL): todos se aceptan y no colisionan entre sí.
  insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id) values (h,'entrada',7,l1);
  insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id) values (h,'entrada',7,l1);
  select count(*) into v_count from public.movimientos where producto_id=h and solicitud_id is null;
  select coalesce(sum(cantidad),0) into v_stock from public.inventario where producto_id=h;
  if v_count <> 2 or v_stock <> 14 then raise exception '8: nulos=% stock=%', v_count, v_stock; end if;
end;
$$;
select 'PASS INSERT normal, repetido idéntico, repetido con otros datos, UUID distintos, stock insuficiente sin consumir el UUID, retiro repetido con stock agotado y NULL históricos; movimientos y saldos verificados';

-- 9. Ajuste físico por la RPC existente: sin solicitud_id, con su control de lectura obsoleta.
do $$
declare
  h constant uuid := '00000000-0000-0000-0000-000000000c02';
  l1 constant bigint := (select id from public.compartimientos where codigo='C111');
  v_stock integer;
  v_nulls integer;
begin
  perform public.registrar_ajuste_fisico(h, l1, 10, 14);
  select cantidad into v_stock from public.inventario where producto_id=h and compartimiento_id=l1;
  select count(*) into v_nulls from public.movimientos where producto_id=h and tipo='ajuste' and solicitud_id is null;
  if v_stock <> 10 or v_nulls <> 1 then raise exception '9: stock=% ajustes=%', v_stock, v_nulls; end if;
  begin perform public.registrar_ajuste_fisico(h, l1, 3, 14); raise exception '9: ajuste con lectura obsoleta aceptado';
  exception when sqlstate 'PT409' then null; end;
  select cantidad into v_stock from public.inventario where producto_id=h and compartimiento_id=l1;
  if v_stock <> 10 then raise exception '9: stock tras conflicto=%', v_stock; end if;
  -- el cliente no puede insertar ajustes directos (RLS) aunque aporte un UUID
  begin insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,destino_compartimiento_id) values ('99999999-9999-4999-8999-999999999999',h,'ajuste',1,l1);
    raise exception '9: ajuste directo aceptado'; exception when insufficient_privilege then null; end;
end;
$$;
select 'PASS ajuste físico por RPC sin cambios (sin solicitud_id, conflicto PT409, RLS contra ajustes directos)';

-- 10. Inmutabilidad intacta: no se puede actualizar ni borrar, tampoco solicitud_id.
do $$
begin
  begin update public.movimientos set solicitud_id=null where solicitud_id='11111111-1111-4111-8111-111111111111'; raise exception '10: UPDATE aceptado';
  exception when insufficient_privilege or object_not_in_prerequisite_state then null; end;
  begin delete from public.movimientos where solicitud_id='11111111-1111-4111-8111-111111111111'; raise exception '10: DELETE aceptado';
  exception when insufficient_privilege or object_not_in_prerequisite_state then null; end;
  if (select count(*) from public.movimientos where solicitud_id='11111111-1111-4111-8111-111111111111') <> 1 then raise exception '10: la fila cambió'; end if;
end;
$$;
select 'PASS movimientos inmutables: UPDATE/DELETE rechazados y solicitud_id intacto';
reset role;
rollback;
