-- Bloque 5: el navegador solo puede crear movimientos. El trigger existente
-- sigue siendo la única vía que cambia inventario.
grant select on table public.movimientos to authenticated;
grant insert (producto_id, tipo, cantidad, origen_compartimiento_id,
  destino_compartimiento_id) on table public.movimientos to authenticated;

create policy "Cuenta Ingeagro lee movimientos"
  on public.movimientos for select to authenticated
  using ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);

-- Los ajustes por conteo físico deben pasar por la función que comprueba la
-- cantidad observada. Las otras tres operaciones conservan la inserción simple.
create policy "Cuenta Ingeagro crea movimientos normales"
  on public.movimientos for insert to authenticated
  with check (
    (select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid
    and tipo in ('entrada', 'retiro', 'traslado')
  );

-- No se conceden escrituras directas del inventario a la API.
revoke insert, update, delete on table public.inventario from authenticated;

-- SERIALIZA todos los movimientos de un producto antes de leer o escribir sus
-- ubicaciones. NO KEY UPDATE no entra en conflicto con el KEY SHARE del FK del
-- movimiento. El origen se elimina al llegar a cero, en esta misma transacción.
create or replace function public.aplicar_movimiento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.productos
   where id = new.producto_id
   for no key update;

  if new.origen_compartimiento_id is not null then
    update public.inventario
       set cantidad = cantidad - new.cantidad
     where producto_id = new.producto_id
       and compartimiento_id = new.origen_compartimiento_id
       and cantidad >= new.cantidad;

    if not found then
      raise exception 'Stock insuficiente para el movimiento'
        using errcode = '23514';
    end if;

    delete from public.inventario
     where producto_id = new.producto_id
       and compartimiento_id = new.origen_compartimiento_id
       and cantidad = 0;
  end if;

  if new.destino_compartimiento_id is not null then
    insert into public.inventario (producto_id, compartimiento_id, cantidad)
    values (new.producto_id, new.destino_compartimiento_id, new.cantidad)
    on conflict (producto_id, compartimiento_id)
    do update set cantidad = public.inventario.cantidad + excluded.cantidad;
  end if;

  return new;
end;
$$;

-- Compara el conteo físico con el stock observado por el formulario. Se bloquea
-- el producto igual que en el trigger; si hubo otro movimiento, falla completo.
create function public.registrar_ajuste_fisico(
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
    raise exception 'El stock cambió' using errcode = '40001';
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
