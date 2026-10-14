-- Solo añade metadatos a movimientos futuros. Los anteriores conservan NULL;
-- no se desactiva ni modifica movimientos_solo_insercion.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.movimientos
  add column codigo_origen text,
  add column codigo_destino text,
  add constraint movimientos_codigo_origen_dueno_fk
    foreign key (codigo_origen, origen_compartimiento_id)
    references public.ubicacion_codigos(codigo, compartimiento_id),
  add constraint movimientos_codigo_destino_dueno_fk
    foreign key (codigo_destino, destino_compartimiento_id)
    references public.ubicacion_codigos(codigo, compartimiento_id),
  add constraint movimientos_codigo_sin_ubicacion_check check (
    (origen_compartimiento_id is not null or codigo_origen is null)
    and (destino_compartimiento_id is not null or codigo_destino is null)
  );

create function public.capturar_codigos_movimiento()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Evitar lecturas privilegiadas antes de que RLS rechace a otra identidad.
  -- El propietario administrativo sigue pudiendo operar sin JWT.
  if current_setting('role') in ('anon', 'authenticated') and
     (select auth.uid()) is distinct from 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  -- SHARE impide cambiar el código durante la captura. Orden fijo para ambos
  -- extremos; no cambia el bloqueo por producto del motor de inventario.
  perform 1 from public.compartimientos
    where id in (new.origen_compartimiento_id, new.destino_compartimiento_id)
    order by id for share;
  new.codigo_origen := null;
  new.codigo_destino := null;
  if new.origen_compartimiento_id is not null then
    select codigo into new.codigo_origen from public.compartimientos
      where id = new.origen_compartimiento_id;
    if not found then
      raise exception 'Ubicación de origen inexistente' using errcode = '23503';
    end if;
  end if;
  if new.destino_compartimiento_id is not null then
    select codigo into new.codigo_destino from public.compartimientos
      where id = new.destino_compartimiento_id;
    if not found then
      raise exception 'Ubicación de destino inexistente' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;
create trigger movimientos_capturar_codigos before insert on public.movimientos
for each row execute function public.capturar_codigos_movimiento();
revoke all on function public.capturar_codigos_movimiento() from public, anon, authenticated;

commit;
