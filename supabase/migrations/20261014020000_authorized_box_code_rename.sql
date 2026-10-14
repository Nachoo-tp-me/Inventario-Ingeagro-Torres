-- Bloque 4: única entrada API para renombrar cajas; no cambia permisos de tablas.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function public.renombrar_codigo_caja(
  p_ubicacion_id bigint,
  p_codigo_esperado text,
  p_codigo_nuevo text
)
returns table (ubicacion_id bigint, estante_id smallint, codigo text, sin_cambios boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_caja public.compartimientos%rowtype;
  v_esperado text;
  v_nuevo text;
begin
  if (select auth.uid()) is distinct from 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_ubicacion_id is null or p_ubicacion_id <= 0 or p_codigo_esperado is null or p_codigo_nuevo is null then
    raise exception 'Datos de renombrado inválidos' using errcode = '22023';
  end if;
  -- Misma normalización ASCII y formato que la restricción aprobada del Bloque 1.
  v_esperado := pg_catalog.upper(pg_catalog.btrim(p_codigo_esperado) collate "C");
  v_nuevo := pg_catalog.upper(pg_catalog.btrim(p_codigo_nuevo) collate "C");
  if v_esperado collate "C" !~ '^[A-Z0-9][A-Z0-9_-]{0,23}$' or
     v_nuevo collate "C" !~ '^[A-Z0-9][A-Z0-9_-]{0,23}$' or
     v_nuevo collate "C" ~ '^C[0-9]+$' then
    raise exception 'Código inválido o reservado para torres' using errcode = '22023';
  end if;

  select c.* into v_caja from public.compartimientos as c
    where c.id = p_ubicacion_id for update;
  if not found then
    raise exception 'Ubicación inexistente' using errcode = '23503';
  end if;
  if v_caja.tipo <> 'caja' then
    raise exception 'Solo se pueden renombrar cajas' using errcode = '22023';
  end if;
  -- Comprobar después del bloqueo, incluso cuando el código nuevo ya coincide.
  if v_caja.codigo is distinct from v_esperado then
    raise exception 'El código cambió; actualiza la ubicación' using errcode = '40001';
  end if;
  if v_nuevo = v_caja.codigo then
    return query select v_caja.id, v_caja.estante_id, v_caja.codigo, true;
    return;
  end if;

  -- Reserva global, recuperación de aliases propios y auditoría: triggers existentes.
  -- Una colisión de código revierte esta actualización y cualquier fila de auditoría.
  update public.compartimientos as c set codigo = v_nuevo where c.id = v_caja.id;
  return query select v_caja.id, v_caja.estante_id, v_nuevo, false;
end;
$$;

revoke all on function public.renombrar_codigo_caja(bigint, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.renombrar_codigo_caja(bigint, text, text) to authenticated;

commit;
