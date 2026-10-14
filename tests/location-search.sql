-- Solo PostgreSQL desechable del runner. Datos sintéticos; rollback al terminar.
begin;
update public.compartimientos set codigo = case when estante_id <= 3
  then 'A'||((estante_id-1)*4+posicion)::text else 'B'||((estante_id-4)*4+posicion)::text end where tipo='caja';
insert into public.productos(id,nombre,categoria_id)
select '00000000-0000-0000-0000-000000000602','A6',id from public.categorias where nombre='Otros';
set local role authenticated;
set local "request.jwt.claim.sub"='d5211ae5-39c6-4365-ad35-e6f6bdcc8058';
insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000602','entrada',5,id from public.compartimientos where codigo='A6';
do $$
declare v_id bigint := (select compartimiento_id from public.ubicacion_codigos where codigo='A6');
begin
  if (select count(*) from public.ubicacion_codigos r join public.compartimientos c on c.id=r.compartimiento_id
      where r.codigo=c.codigo and c.tipo='caja') <> 24 then raise exception 'Mapa de cajas incompleto'; end if;
  if (select count(*) from public.ubicacion_codigos r join public.compartimientos c on c.id=r.compartimiento_id
      where r.codigo=c.codigo and c.tipo='compartimiento') <> 72 then raise exception 'Regresión de torres'; end if;
  if not exists(select 1 from public.ubicacion_codigos r join public.compartimientos c on c.id=r.compartimiento_id
      where r.codigo='C264' and c.codigo='C264' and c.torre_id=2 and c.piso=6 and c.posicion=4) then raise exception 'C264 no resuelve su torre'; end if;
  perform public.renombrar_codigo_caja(v_id,'A6',' motores ');
  if (select count(*) from public.ubicacion_codigos where codigo in ('A6','MOTORES') and compartimiento_id=v_id) <> 2 or
     not exists(select 1 from public.ubicacion_codigos r join public.compartimientos c on c.id=r.compartimiento_id
       where r.codigo='A6' and c.codigo='MOTORES' and c.id=v_id and c.estante_id=2 and c.posicion=2) then
    raise exception 'Código histórico/actual no resuelve ID/posición originales';
  end if;
  if not exists(select 1 from public.inventario where compartimiento_id=v_id
    and producto_id='00000000-0000-0000-0000-000000000602' and cantidad=5) then raise exception 'Stock cambió al renombrar'; end if;
  if not exists(select 1 from public.productos where id='00000000-0000-0000-0000-000000000602' and nombre='A6') then raise exception 'Producto coincidente cambió'; end if;
  perform public.renombrar_codigo_caja((select id from public.compartimientos where codigo='A1'),'A1','MOTORES_1');
  perform public.renombrar_codigo_caja((select id from public.compartimientos where codigo='A2'),'A2','MOTORES-1');
  if (select compartimiento_id from public.ubicacion_codigos where codigo='MOTORES_1') =
     (select compartimiento_id from public.ubicacion_codigos where codigo='MOTORES-1') or
     exists(select 1 from public.ubicacion_codigos where codigo in ('C-264','MOTORES 1','A999')) then raise exception 'Equivalencia incorrecta de separadores'; end if;
  perform public.renombrar_codigo_caja(v_id,'MOTORES','A6');
  if not exists(select 1 from public.ubicacion_codigos r join public.compartimientos c on c.id=r.compartimiento_id
     where r.codigo='MOTORES' and c.codigo='A6' and c.id=v_id) then raise exception 'Recuperar alias no conserva búsqueda histórica'; end if;
end $$;
select 'PASS búsqueda: 24 cajas, 72 compartimientos, C264, códigos actuales/históricos, ID y posición';
select 'PASS búsqueda: renombrado/recuperación, separadores exactos, producto coincidente y stock conservado';
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000999';
do $$ begin
  if exists(select 1 from public.ubicacion_codigos) or exists(select 1 from public.compartimientos) or exists(select 1 from public.inventario)
    then raise exception 'RLS permite lecturas a otra cuenta'; end if;
end $$;
set local "request.jwt.claim.sub"='';
do $$ begin
  if exists(select 1 from public.ubicacion_codigos) or exists(select 1 from public.compartimientos)
    then raise exception 'RLS permite lectura sin identidad'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform codigo from public.ubicacion_codigos; raise exception 'Anon puede leer registro';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS búsqueda: RLS de registros/ubicaciones/stock, otra cuenta, identidad ausente y anon';
rollback;
