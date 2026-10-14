-- Solo PostgreSQL local desechable; lecturas de exportación y stock ficticio.
begin;
update public.compartimientos set codigo = case when estante_id <= 3
  then 'A'||((estante_id-1)*4+posicion)::text else 'B'||((estante_id-4)*4+posicion)::text end where tipo='caja';
insert into public.productos(id,nombre,categoria_id)
select '00000000-0000-0000-0000-000000000604','TEST EXPORTACIÓN Ω',id from public.categorias where nombre='Otros';
set local role authenticated;
set local "request.jwt.claim.sub"='d5211ae5-39c6-4365-ad35-e6f6bdcc8058';
insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000604','entrada',cantidad,c.id
from (values('C111',2),('A6',3),('B12',5)) v(codigo,cantidad) join public.compartimientos c using(codigo);
do $$ begin
  perform public.renombrar_codigo_caja((select id from public.compartimientos where codigo='A6'),'A6','MOTORES_1');
  if (select count(*) from public.compartimientos)<>96 or (select count(*) from public.estantes)<>6 or
     (select count(*) from public.torres)<>3 then raise exception 'Lecturas incompletas'; end if;
  if (select count(*) from public.compartimientos where tipo='compartimiento')<>72 or
     (select count(*) from public.compartimientos where tipo='caja')<>24 then raise exception 'Tipos incorrectos'; end if;
  if (select sum(i.cantidad) from public.inventario i join public.productos p on p.id=i.producto_id
    join public.compartimientos c on c.id=i.compartimiento_id where p.id='00000000-0000-0000-0000-000000000604')<>10 then
    raise exception 'Join de exportación pierde o duplica stock'; end if;
  if not exists(select 1 from public.inventario i join public.compartimientos c on c.id=i.compartimiento_id
    join public.estantes e on e.id=c.estante_id where i.producto_id='00000000-0000-0000-0000-000000000604'
    and c.codigo='MOTORES_1' and c.torre_id is null and c.piso is null and e.id=2 and c.posicion=2 and i.cantidad=3) then
    raise exception 'Código vigente/posición/stock incorrectos'; end if;
end $$;
select 'PASS exportación: 96 ubicaciones, seis estantes, código vigente y join sin duplicar cantidades';
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000999';
do $$ begin
  if exists(select 1 from public.productos) or exists(select 1 from public.inventario) or
     exists(select 1 from public.compartimientos) or exists(select 1 from public.torres) or exists(select 1 from public.estantes) then
    raise exception 'RLS permite exportar a otra cuenta'; end if;
end $$;
set local "request.jwt.claim.sub"='';
do $$ begin
  if exists(select 1 from public.productos) or exists(select 1 from public.inventario) or exists(select 1 from public.estantes) then
    raise exception 'RLS permite exportar sin identidad'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform id from public.estantes; raise exception 'Anon lee estantes';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS exportación: RLS de las cinco lecturas, cuenta ajena, identidad ausente y anon';
rollback;
