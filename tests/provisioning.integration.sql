-- Integración sobre el entorno YA APROVISIONADO (6 estantes, 24 cajas con etiquetas ficticias de prueba, 96 ubicaciones).
-- Solo el clúster privado creado por provisioning.local.mjs. Verifica movimientos Y saldos; se revierte al final.
-- Cubre: entrada/retiro/traslado/ajuste en cajas, idempotencia con reintento, códigos históricos y renombrado de cajas,
-- RLS (usuario autorizado, ajeno y anon) y políticas del bucket privado de fotografías (tabla storage.objects simulada).
begin;
insert into public.productos(id,nombre,categoria_id)
select '00000000-0000-0000-0000-000000000d01','TEST PROVISIONING',id from public.categorias where nombre='Otros';

set local role authenticated;
set local "request.jwt.claim.sub"='d5211ae5-39c6-4365-ad35-e6f6bdcc8058';

do $$
declare
  p constant uuid := '00000000-0000-0000-0000-000000000d01';
  box1 constant bigint := (select id from public.compartimientos where tipo='caja' and estante_id=1 and posicion=1);
  box2 constant bigint := (select id from public.compartimientos where tipo='caja' and estante_id=6 and posicion=4);
  tower constant bigint := (select id from public.compartimientos where codigo='C111');
  old_code text;
  v_stock integer;
  v_n integer;
begin
  select codigo into old_code from public.compartimientos where id=box1;

  -- Entrada a caja con solicitud; reintento con el mismo UUID rechazado sin segunda aplicación.
  insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,destino_compartimiento_id) values ('d0000000-0000-4000-8000-000000000001',p,'entrada',10,box1);
  begin insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,destino_compartimiento_id) values ('d0000000-0000-4000-8000-000000000001',p,'entrada',10,box1);
    raise exception 'el reintento con el mismo UUID fue aceptado'; exception when unique_violation then null; end;
  select cantidad into v_stock from public.inventario where producto_id=p and compartimiento_id=box1;
  select count(*) into v_n from public.movimientos where solicitud_id='d0000000-0000-4000-8000-000000000001';
  if v_stock <> 10 or v_n <> 1 then raise exception 'entrada: stock=% movimientos=%', v_stock, v_n; end if;

  -- Retiro y traslado caja→caja y caja→torre con saldos exactos y conservación total.
  insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,origen_compartimiento_id) values ('d0000000-0000-4000-8000-000000000002',p,'retiro',2,box1);
  insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id) values ('d0000000-0000-4000-8000-000000000003',p,'traslado',5,box1,box2);
  insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id) values ('d0000000-0000-4000-8000-000000000004',p,'traslado',1,box2,tower);
  if (select cantidad from public.inventario where producto_id=p and compartimiento_id=box1) <> 3
     or (select cantidad from public.inventario where producto_id=p and compartimiento_id=box2) <> 4
     or (select cantidad from public.inventario where producto_id=p and compartimiento_id=tower) <> 1
     or (select sum(cantidad) from public.inventario where producto_id=p) <> 8 then
    raise exception 'saldos tras retiro y traslados incorrectos';
  end if;

  -- Ajuste físico por la RPC existente sobre una caja.
  perform public.registrar_ajuste_fisico(p, box1, 9, 3);
  if (select cantidad from public.inventario where producto_id=p and compartimiento_id=box1) <> 9 then raise exception 'ajuste en caja'; end if;
  begin perform public.registrar_ajuste_fisico(p, box1, 1, 3); raise exception 'ajuste obsoleto aceptado'; exception when serialization_failure then null; end;

  -- Los movimientos capturan el código de la caja al ocurrir; el renombrado conserva el histórico y el ID permanente.
  perform * from public.renombrar_codigo_caja(box1, old_code, 'PRUEBA_RENOMBRADA');
  insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,destino_compartimiento_id) values ('d0000000-0000-4000-8000-000000000005',p,'entrada',1,box1);
  if (select codigo_destino from public.movimientos where solicitud_id='d0000000-0000-4000-8000-000000000001') <> old_code then raise exception 'el snapshot histórico cambió'; end if;
  if (select codigo_destino from public.movimientos where solicitud_id='d0000000-0000-4000-8000-000000000005') <> 'PRUEBA_RENOMBRADA' then raise exception 'el snapshot nuevo no usa el código vigente'; end if;
  if (select compartimiento_id from public.ubicacion_codigos where codigo=old_code) <> box1 then raise exception 'el código anterior debe seguir apuntando a la misma caja'; end if;
  if (select codigo from public.compartimientos where id=box1) <> 'PRUEBA_RENOMBRADA' then raise exception 'código vigente'; end if;
  if (select count(*) from public.ubicacion_codigos) <> 97 then raise exception 'reserva de códigos'; end if;
  -- El reintento de una solicitud anterior sigue siendo duplicado tras el renombrado (mismo UUID, misma caja por ID).
  begin insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,destino_compartimiento_id) values ('d0000000-0000-4000-8000-000000000001',p,'entrada',10,box1);
    raise exception 'duplicado aceptado tras renombrar'; exception when unique_violation then null; end;
end;
$$;
select 'PASS cajas aprovisionadas: entrada, retiro, traslados y ajuste con saldos exactos; idempotencia; snapshots históricos y renombrado por ID';

-- RLS: usuario ajeno y anon no pueden leer ni escribir movimientos/inventario ni renombrar; la caja sigue intacta.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-4000-8000-0000000000ee';
do $$
declare box1 constant bigint := (select id from public.compartimientos where tipo='caja' and estante_id=1 and posicion=1);
begin
  if (select count(*) from public.movimientos) <> 0 or (select count(*) from public.inventario) <> 0 or (select count(*) from public.estantes) <> 0 then
    raise exception 'un usuario ajeno puede leer datos';
  end if;
  begin insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,destino_compartimiento_id) values ('e0000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000d01','entrada',1,box1);
    raise exception 'un usuario ajeno pudo insertar'; exception when insufficient_privilege then null; end;
  begin perform * from public.renombrar_codigo_caja(box1, 'PRUEBA_RENOMBRADA', 'HACKEADA'); raise exception 'un usuario ajeno pudo renombrar'; exception when insufficient_privilege then null; end;
  begin perform public.registrar_ajuste_fisico('00000000-0000-0000-0000-000000000d01', box1, 99, 10); raise exception 'un usuario ajeno pudo ajustar'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin perform count(*) from public.movimientos; raise exception 'anon lee movimientos'; exception when insufficient_privilege then null; end;
  begin insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id) values ('00000000-0000-0000-0000-000000000d01','entrada',1,1); raise exception 'anon inserta'; exception when insufficient_privilege then null; end;
  begin perform * from public.renombrar_codigo_caja(1,'X','Y'); raise exception 'anon renombra'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select 'PASS RLS y permisos: usuario ajeno y anon no leen ni escriben movimientos, inventario, estantes, renombrado ni ajuste';

-- Bucket privado de fotografías: límites y políticas (storage.objects simulada con RLS real).
do $$
begin
  if (select public from storage.buckets where id='product-images') then raise exception 'el bucket debe ser privado'; end if;
  if (select file_size_limit from storage.buckets where id='product-images') <> 5242880 then raise exception 'límite de 5 MiB'; end if;
  if (select allowed_mime_types from storage.buckets where id='product-images') <> array['image/jpeg','image/png','image/webp'] then raise exception 'tipos permitidos'; end if;
end;
$$;
set local role authenticated;
set local "request.jwt.claim.sub"='d5211ae5-39c6-4365-ad35-e6f6bdcc8058';
insert into storage.objects(bucket_id,name) values ('product-images','p-1/foto.png');
do $$
begin
  if (select count(*) from storage.objects where bucket_id='product-images') <> 1 then raise exception 'la cuenta autorizada debe leer su foto'; end if;
  begin insert into storage.objects(bucket_id,name) values ('otro-bucket','x.png'); raise exception 'bucket ajeno aceptado'; exception when insufficient_privilege then null; end;
  update storage.objects set name='p-1/reemplazo.png' where name='p-1/foto.png';
  delete from storage.objects where name='p-1/reemplazo.png';
  if (select count(*) from storage.objects) <> 0 then raise exception 'eliminación de la foto'; end if;
  insert into storage.objects(bucket_id,name) values ('product-images','p-1/otra.png');
end;
$$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-4000-8000-0000000000ee';
do $$
begin
  if (select count(*) from storage.objects) <> 0 then raise exception 'un usuario ajeno ve fotos privadas'; end if;
  begin insert into storage.objects(bucket_id,name) values ('product-images','ajena.png'); raise exception 'un usuario ajeno sube fotos'; exception when insufficient_privilege then null; end;
  delete from storage.objects; if exists (select 1 from storage.objects) then null; end if;
end;
$$;
reset role;
set local role anon;
do $$
begin
  -- anon puede consultar la tabla (permiso de plataforma) pero RLS no le muestra ninguna foto privada; y no puede escribir.
  if (select count(*) from storage.objects) <> 0 then raise exception 'anon ve fotos privadas'; end if;
  begin insert into storage.objects(bucket_id,name) values ('product-images','anon.png'); raise exception 'anon sube fotos'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select 'PASS bucket product-images privado (5 MiB, JPG/PNG/WebP); solo la cuenta autorizada lee, sube, reemplaza y elimina; ajeno y anon denegados';
rollback;
