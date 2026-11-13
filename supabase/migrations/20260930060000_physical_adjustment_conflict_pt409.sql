-- Corrección aditiva de V1: el conflicto de «cantidad esperada desactualizada» de registrar_ajuste_fisico deja de usar
-- SQLSTATE 40001 (serialization_failure). PostgREST 14 trata 40001 como transitorio y REINTENTA la transacción completa:
-- con un conflicto de negocio que se repite en cada intento, la petición queda en bucle hasta el timeout del gateway
-- (staging, 12-nov-2026: «upstream request timeout» tras ~126 s). Ver Supabase KB «SQLSTATE 40001 (serialization_failure)
-- in an RPC function causes infinite retries» (corregido en PostgREST 16).
--
-- Nuevo código: PT409. PostgREST lo devuelve como HTTP 409 con {"code":"PT409"} y NO lo reintenta.
-- La aplicación V2 lo interpreta igual que el antiguo 40001 («El stock cambió»); la aplicación V1 lo muestra con su mensaje
-- genérico de error definitivo (sin reintento automático ni escritura).
--
-- El cuerpo es IDÉNTICO al de 20260930050000_transactional_stock_operations.sql salvo el errcode del conflicto.
-- CREATE OR REPLACE conserva propietario y privilegios; se reafirman igualmente revoke/grant.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.registrar_ajuste_fisico(
  p_producto_id uuid,
  p_compartimiento_id bigint,
  p_cantidad_fisica integer,
  p_cantidad_esperada integer
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual integer;
  v_delta bigint;
  v_movimiento_id bigint;
begin
  if (select auth.uid()) is distinct from
     'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_producto_id is null or p_compartimiento_id is null or
     p_cantidad_fisica is null or p_cantidad_fisica < 0 or
     p_cantidad_esperada is null or p_cantidad_esperada < 0 then
    raise exception 'Datos de ajuste inválidos' using errcode = '22023';
  end if;

  perform 1 from public.productos
   where id = p_producto_id
   for no key update;
  if not found then
    raise exception 'Producto inexistente' using errcode = '23503';
  end if;

  perform 1 from public.compartimientos where id = p_compartimiento_id;
  if not found then
    raise exception 'Compartimiento inexistente' using errcode = '23503';
  end if;

  select coalesce((
    select cantidad from public.inventario
     where producto_id = p_producto_id
       and compartimiento_id = p_compartimiento_id
  ), 0) into v_actual;

  if v_actual <> p_cantidad_esperada then
    raise exception 'El stock cambió' using errcode = 'PT409';
  end if;

  v_delta := p_cantidad_fisica::bigint - v_actual::bigint;
  if v_delta = 0 then
    return null;
  end if;
  if pg_catalog.abs(v_delta) > 2147483647 then
    raise exception 'Variación demasiado grande' using errcode = '22023';
  end if;

  insert into public.movimientos (
    producto_id, tipo, cantidad, origen_compartimiento_id,
    destino_compartimiento_id
  ) values (
    p_producto_id, 'ajuste', pg_catalog.abs(v_delta)::integer,
    case when v_delta < 0 then p_compartimiento_id end,
    case when v_delta > 0 then p_compartimiento_id end
  ) returning id into v_movimiento_id;

  return v_movimiento_id;
end;
$$;

revoke all on function public.registrar_ajuste_fisico(
  uuid, bigint, integer, integer
) from public, anon;
grant execute on function public.registrar_ajuste_fisico(
  uuid, bigint, integer, integer
) to authenticated;

commit;
