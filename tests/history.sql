-- Solo PostgreSQL desechable del runner; mapa y movimientos ficticios, rollback.
begin;
update public.compartimientos set codigo = case when estante_id <= 3
  then 'A'||((estante_id-1)*4+posicion)::text else 'B'||((estante_id-4)*4+posicion)::text end where tipo='caja';
insert into public.productos(id,nombre,categoria_id)
select '00000000-0000-0000-0000-000000000603','TEST HISTORIAL',id from public.categorias where nombre='Otros';
set local role authenticated;
set local "request.jwt.claim.sub"='d5211ae5-39c6-4365-ad35-e6f6bdcc8058';
do $$
declare
  p uuid := '00000000-0000-0000-0000-000000000603';
  tower1 bigint := (select id from public.compartimientos where codigo='C111');
  tower2 bigint := (select id from public.compartimientos where codigo='C211');
  box1 bigint := (select id from public.compartimientos where codigo='A6');
  box2 bigint := (select id from public.compartimientos where codigo='B12');
  before_rows jsonb;
  after_rows jsonb;
  before_legacy jsonb;
begin
  select jsonb_agg(to_jsonb(m) order by id) into before_legacy from public.movimientos m;
  insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id)
    values (p,'entrada',10,tower1),(p,'entrada',10,box1),(p,'entrada',10,box2);
  insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id)
    values (p,'traslado',1,tower1,tower2),(p,'traslado',1,tower1,box1),
           (p,'traslado',1,box1,tower2),(p,'traslado',1,box1,box2);
  insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id)
    values (p,'retiro',1,box1),(p,'retiro',1,tower1);
  perform public.registrar_ajuste_fisico(p,box1,10,8);
  perform public.registrar_ajuste_fisico(p,box1,9,10);
  perform public.registrar_ajuste_fisico(p,tower1,9,7);
  perform public.registrar_ajuste_fisico(p,tower1,8,9);
  select jsonb_agg(to_jsonb(m) order by id) into before_rows from public.movimientos m where producto_id=p;
  perform public.renombrar_codigo_caja(box1,'A6','MOTORES');
  perform public.renombrar_codigo_caja(box1,'MOTORES','Z20');
  select jsonb_agg(to_jsonb(m) order by id) into after_rows from public.movimientos m where producto_id=p;
  if before_rows is distinct from after_rows then raise exception 'Renombrar alteró movimientos históricos'; end if;
  if (select count(*) from public.movimientos where producto_id=p) <> 13 then raise exception 'Cantidad/tipos de movimientos incorrectos'; end if;
  if (select count(*) from public.movimientos m join public.compartimientos c on c.id=m.destino_compartimiento_id
      where producto_id=p and c.id=box1 and c.codigo='Z20' and m.codigo_destino='A6') <> 3 then
    raise exception 'Instantánea de destino/código actual/ID incorrectos'; end if;
  if (select count(*) from public.movimientos m join public.compartimientos c on c.id=m.origen_compartimiento_id
      where producto_id=p and c.id=box1 and c.codigo='Z20' and m.codigo_origen='A6') <> 4 then
    raise exception 'Instantánea de origen/código actual/ID incorrectos'; end if;
  if exists(select 1 from public.movimientos m where producto_id=p and
    ((origen_compartimiento_id is not null and codigo_origen is null) or
     (destino_compartimiento_id is not null and codigo_destino is null))) then raise exception 'Falta instantánea'; end if;
  if not exists(select 1 from public.compartimientos where id=box1 and estante_id=2 and posicion=2 and codigo='Z20') then
    raise exception 'Cambió identidad/posición'; end if;
  if (select sum(cantidad) from public.inventario where producto_id=p) <> 30 or
     (select cantidad from public.inventario where producto_id=p and compartimiento_id=box1) <> 9 then
    raise exception 'Cantidad final incorrecta'; end if;
  if before_legacy is distinct from (select jsonb_agg(to_jsonb(m) order by id) from public.movimientos m where producto_id<>p) then
    raise exception 'Se modificaron movimientos anteriores'; end if;
  if not exists(select 1 from public.movimientos where codigo_origen is null and codigo_destino is null) then
    raise exception 'Se inventaron instantáneas de movimientos anteriores'; end if;
  -- Un movimiento posterior captura Z20; un tercer renombrado tampoco lo cambia.
  insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id) values(p,'entrada',1,box1);
  perform public.renombrar_codigo_caja(box1,'Z20','FINAL');
  if not exists(select 1 from public.movimientos m join public.compartimientos c on c.id=m.destino_compartimiento_id
    where producto_id=p and codigo_destino='Z20' and c.codigo='FINAL' and c.id=box1) then raise exception 'Código intermedio perdido'; end if;
end $$;
select 'PASS historial: cuatro traslados, entradas/retiros/ajustes de ambos tipos, IDs y cantidades';
select 'PASS historial: múltiples renombrados, instantáneas inmutables, código vigente y filas antiguas NULL intactas';
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000999';
do $$ begin
  if exists(select 1 from public.movimientos) or exists(select 1 from public.compartimientos) then
    raise exception 'RLS permite historial/ubicaciones a otra cuenta'; end if;
end $$;
set local "request.jwt.claim.sub"='';
do $$ begin
  if exists(select 1 from public.movimientos) then raise exception 'Historial visible sin identidad'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform id from public.movimientos; raise exception 'Anon puede leer historial';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS historial: RLS, cuenta ajena, identidad ausente y acceso anónimo';
rollback;
