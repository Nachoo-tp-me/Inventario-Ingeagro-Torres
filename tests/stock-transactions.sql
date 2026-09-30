-- Se ejecuta solo contra PostgreSQL desechable; toda esta prueba revierte.
begin;

insert into public.productos (id, nombre, categoria_id)
values ('00000000-0000-0000-0000-000000000001', 'TEST SQL Bloque 5',
        (select id from public.categorias where nombre = 'Otros'));

set local role authenticated;
set local "request.jwt.claim.sub" = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058';

-- 0 -> 10 -> 15 -> 11.
insert into public.movimientos (producto_id, tipo, cantidad, destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000001', 'entrada', 10, id
from public.compartimientos where codigo = 'C111';

insert into public.movimientos (producto_id, tipo, cantidad, destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000001', 'entrada', 5, id
from public.compartimientos where codigo = 'C111';

insert into public.movimientos (producto_id, tipo, cantidad, origen_compartimiento_id)
select '00000000-0000-0000-0000-000000000001', 'retiro', 4, id
from public.compartimientos where codigo = 'C111';

do $$
begin
  if (select cantidad from public.inventario where producto_id =
      '00000000-0000-0000-0000-000000000001') <> 11 then
    raise exception 'Entrada/retiro incorrectos';
  end if;

  begin
    insert into public.movimientos (producto_id, tipo, cantidad, origen_compartimiento_id)
    select '00000000-0000-0000-0000-000000000001', 'retiro', 12, id
    from public.compartimientos where codigo = 'C111';
    raise exception 'Retiro inválido aceptado';
  exception when sqlstate '23514' then null;
  end;

  if (select cantidad from public.inventario where producto_id =
      '00000000-0000-0000-0000-000000000001') <> 11 or
     (select count(*) from public.movimientos where producto_id =
      '00000000-0000-0000-0000-000000000001') <> 3 then
    raise exception 'Retiro inválido dejó cambios parciales';
  end if;
end;
$$;

-- Traslado inválido y traslado válido: C111 11 -> 4, C121 0 -> 7.
do $$
begin
  begin
    insert into public.movimientos (producto_id, tipo, cantidad,
      origen_compartimiento_id, destino_compartimiento_id)
    select '00000000-0000-0000-0000-000000000001', 'traslado', 12,
      (select id from public.compartimientos where codigo = 'C111'),
      (select id from public.compartimientos where codigo = 'C121');
    raise exception 'Traslado inválido aceptado';
  exception when sqlstate '23514' then null;
  end;

  if (select count(*) from public.inventario where producto_id =
      '00000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'Traslado inválido creó destino parcial';
  end if;
end;
$$;

insert into public.movimientos (producto_id, tipo, cantidad,
  origen_compartimiento_id, destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000001', 'traslado', 7,
  (select id from public.compartimientos where codigo = 'C111'),
  (select id from public.compartimientos where codigo = 'C121');

do $$
declare
  v_destino bigint := (select id from public.compartimientos where codigo = 'C121');
  v_fuente bigint := (select id from public.compartimientos where codigo = 'C111');
  v_id bigint;
begin
  if (select cantidad from public.inventario where producto_id =
      '00000000-0000-0000-0000-000000000001' and compartimiento_id = v_fuente) <> 4 or
     (select cantidad from public.inventario where producto_id =
      '00000000-0000-0000-0000-000000000001' and compartimiento_id = v_destino) <> 7 then
    raise exception 'Traslado no fue atómico';
  end if;

  -- Ajuste 7 -> 5 -> 8; 8 -> 8 no genera movimiento.
  perform public.registrar_ajuste_fisico('00000000-0000-0000-0000-000000000001', v_destino, 5, 7);
  perform public.registrar_ajuste_fisico('00000000-0000-0000-0000-000000000001', v_destino, 8, 5);
  v_id := public.registrar_ajuste_fisico('00000000-0000-0000-0000-000000000001', v_destino, 8, 8);
  if v_id is not null or
     (select cantidad from public.inventario where producto_id =
      '00000000-0000-0000-0000-000000000001' and compartimiento_id = v_destino) <> 8 or
     (select count(*) from public.movimientos where producto_id =
      '00000000-0000-0000-0000-000000000001') <> 6 then
    raise exception 'Ajuste incorrecto o movimiento inútil';
  end if;

  begin
    perform public.registrar_ajuste_fisico('00000000-0000-0000-0000-000000000001', v_destino, 3, 7);
    raise exception 'Ajuste con lectura obsoleta aceptado';
  exception when sqlstate '40001' then null;
  end;

  if (select cantidad from public.inventario where producto_id =
      '00000000-0000-0000-0000-000000000001' and compartimiento_id = v_destino) <> 8 then
    raise exception 'Ajuste obsoleto alteró stock';
  end if;
end;
$$;

-- Retiro final 4 -> 0: desaparece la fila, pero el historial crece.
insert into public.movimientos (producto_id, tipo, cantidad, origen_compartimiento_id)
select '00000000-0000-0000-0000-000000000001', 'retiro', 4, id
from public.compartimientos where codigo = 'C111';

do $$
begin
  if exists (select 1 from public.inventario where producto_id =
      '00000000-0000-0000-0000-000000000001' and compartimiento_id =
      (select id from public.compartimientos where codigo = 'C111')) or
     (select count(*) from public.movimientos where producto_id =
      '00000000-0000-0000-0000-000000000001') <> 7 then
    raise exception 'Llegada a cero no conserva historial correctamente';
  end if;
end;
$$;

-- Restricciones de base y permisos: inputs inválidos nunca crean historial.
do $$
declare
  v_before bigint := (select count(*) from public.movimientos where producto_id =
    '00000000-0000-0000-0000-000000000001');
begin
  begin
    insert into public.movimientos (producto_id, tipo, cantidad, destino_compartimiento_id)
    select '00000000-0000-0000-0000-000000000001', 'entrada', 0, id
    from public.compartimientos where codigo = 'C111';
    raise exception 'Cantidad cero aceptada';
  exception when sqlstate '23514' then null;
  end;

  begin
    insert into public.movimientos (producto_id, tipo, cantidad, origen_compartimiento_id, destino_compartimiento_id)
    select '00000000-0000-0000-0000-000000000001', 'traslado', 1, id, id
    from public.compartimientos where codigo = 'C121';
    raise exception 'Mismo origen y destino aceptados';
  exception when sqlstate '23514' then null;
  end;

  begin
    insert into public.movimientos (producto_id, tipo, cantidad, destino_compartimiento_id)
    select '00000000-0000-0000-0000-000000000099', 'entrada', 1, id
    from public.compartimientos where codigo = 'C111';
    raise exception 'Producto inexistente aceptado';
  exception when sqlstate '23503' then null;
  end;

  begin
    insert into public.movimientos (producto_id, tipo, cantidad, destino_compartimiento_id)
    values ('00000000-0000-0000-0000-000000000001', 'entrada', 1, 999999);
    raise exception 'Compartimiento inexistente aceptado';
  exception when sqlstate '23503' then null;
  end;

  begin
    perform public.registrar_ajuste_fisico('00000000-0000-0000-0000-000000000001',
      (select id from public.compartimientos where codigo = 'C121'), -1, 8);
    raise exception 'Conteo negativo aceptado';
  exception when sqlstate '22023' then null;
  end;

  begin
    update public.inventario set cantidad = 99 where producto_id =
      '00000000-0000-0000-0000-000000000001';
    raise exception 'UPDATE directo de inventario aceptado';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.movimientos where producto_id =
      '00000000-0000-0000-0000-000000000001';
    raise exception 'DELETE de historial aceptado';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.movimientos (producto_id, tipo, cantidad, destino_compartimiento_id)
    select '00000000-0000-0000-0000-000000000001', 'ajuste', 1, id
    from public.compartimientos where codigo = 'C111';
    raise exception 'Ajuste directo aceptado';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.movimientos set cantidad = 2 where producto_id =
      '00000000-0000-0000-0000-000000000001';
    raise exception 'UPDATE del historial aceptado';
  exception when insufficient_privilege then null;
  end;

  if (select count(*) from public.movimientos where producto_id =
      '00000000-0000-0000-0000-000000000001') <> v_before then
    raise exception 'Una validación inválida alteró historial';
  end if;
end;
$$;

set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000099';
do $$
begin
  if (select count(*) from public.movimientos) <> 0 or
     (select count(*) from public.inventario) <> 0 then
    raise exception 'Otro UUID pudo leer inventario o historial';
  end if;

  begin
    insert into public.movimientos (producto_id, tipo, cantidad, destino_compartimiento_id)
    values ('00000000-0000-0000-0000-000000000001', 'entrada', 1, 1);
    raise exception 'Otro UUID pudo crear un movimiento';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.registrar_ajuste_fisico('00000000-0000-0000-0000-000000000001', 1, 1, 0);
    raise exception 'Otro UUID pudo registrar ajuste';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
