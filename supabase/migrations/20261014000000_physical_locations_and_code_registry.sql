-- Bloque 1: expansión compatible. No crea estantes/cajas productivos.
-- Ensayar en PostgreSQL desechable antes de cualquier aplicación remota.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Fallar ante una base distinta; no ocultar drift con IF NOT EXISTS.
do $$
begin
  if current_setting('server_version_num')::integer < 140000 then
    raise exception 'Esta migración requiere PostgreSQL 14 o superior';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.compartimientos'::regclass
       and attname = 'codigo' and attgenerated = 's' and not attisdropped
  ) then
    raise exception 'Se esperaba compartimientos.codigo generado y almacenado';
  end if;
  if exists (
    select 1 from public.compartimientos
     where codigo is distinct from ('C' || torre_id::text || piso::text || posicion::text)
  ) then
    raise exception 'La topología/codificación existente no coincide con Cxyz';
  end if;
end;
$$;

create table public.estantes (
  id smallint primary key check (id between 1 and 6),
  nombre text generated always as ('Estante ' || id::text) stored,
  -- Grupo físico, independiente de la etiqueta editable de cualquier caja.
  grupo text generated always as (case when id <= 3 then 'A' else 'B' end) stored
);

-- DROP EXPRESSION retiene valores, columna, IDs, índices y relaciones.
alter table public.compartimientos
  alter column codigo drop expression,
  alter column codigo set not null,
  alter column torre_id drop not null,
  alter column piso drop not null,
  add column tipo text not null default 'compartimiento',
  add column estante_id smallint references public.estantes(id) on delete restrict,
  add constraint compartimientos_tipo_estructura_check check (
    (tipo = 'compartimiento' and torre_id is not null and piso is not null and estante_id is null)
    or (tipo = 'caja' and torre_id is null and piso is null and estante_id is not null)
  ),
  add constraint compartimientos_codigo_formato_check check (
    codigo collate "C" ~ '^[A-Z0-9][A-Z0-9_-]{0,23}$'
    and (tipo <> 'compartimiento' or codigo = 'C' || torre_id::text || piso::text || posicion::text)
    and (tipo <> 'caja' or codigo collate "C" !~ '^C[0-9]+$')
  ),
  add constraint compartimientos_estante_posicion_unica unique (estante_id, posicion);

-- La PK del código reserva su dueño permanentemente. No hay un segundo
-- indicador de "código actual": ese valor sigue en compartimientos.codigo.
create table public.ubicacion_codigos (
  codigo text primary key check (codigo collate "C" ~ '^[A-Z0-9][A-Z0-9_-]{0,23}$'),
  compartimiento_id bigint not null references public.compartimientos(id) on delete restrict,
  registrado_en timestamptz not null default clock_timestamp(),
  constraint ubicacion_codigos_codigo_dueno_unico unique (codigo, compartimiento_id)
);
create index ubicacion_codigos_compartimiento_idx on public.ubicacion_codigos(compartimiento_id);

insert into public.ubicacion_codigos (codigo, compartimiento_id)
select codigo, id from public.compartimientos;

-- Diferida para permitir insertar la ubicación y registrar su código en el
-- AFTER INSERT de la misma transacción. Al COMMIT el dueño debe coincidir.
alter table public.compartimientos
  add constraint compartimientos_codigo_dueno_fk
  foreign key (codigo, id) references public.ubicacion_codigos(codigo, compartimiento_id)
  deferrable initially deferred;

create table public.cambios_codigo_ubicacion (
  id bigint generated always as identity primary key,
  compartimiento_id bigint not null references public.compartimientos(id) on delete restrict,
  codigo_anterior text not null,
  codigo_nuevo text not null,
  fecha timestamptz not null default clock_timestamp(),
  -- NULL identifica una operación administrativa sin JWT, no un actor inventado.
  actor_id uuid,
  check (codigo_anterior <> codigo_nuevo),
  foreign key (codigo_anterior, compartimiento_id)
    references public.ubicacion_codigos(codigo, compartimiento_id),
  foreign key (codigo_nuevo, compartimiento_id)
    references public.ubicacion_codigos(codigo, compartimiento_id)
);
create index cambios_codigo_ubicacion_fecha_idx
  on public.cambios_codigo_ubicacion(compartimiento_id, fecha, id);

create function public.normalizar_codigo_ubicacion()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tipo = 'compartimiento' then
    -- Conserva crear_compartimientos_de_torre(), que inserta sin código explícito.
    new.codigo := 'C' || new.torre_id::text || new.piso::text || new.posicion::text;
  else
    new.codigo := pg_catalog.upper(pg_catalog.btrim(new.codigo) collate "C");
  end if;
  return new;
end;
$$;
create trigger compartimientos_normalizar_codigo
before insert or update on public.compartimientos
for each row execute function public.normalizar_codigo_ubicacion();

-- Torres inmutables como antes. Cajas: únicamente cambia el código; la API
-- sigue sin UPDATE. La RPC autorizada se implementará en el Bloque 4.
create or replace function public.impedir_modificacion_compartimiento()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las ubicaciones físicas no se eliminan' using errcode = '55000';
  end if;
  if old.tipo = 'compartimiento' or
     new.id is distinct from old.id or new.tipo is distinct from old.tipo or
     new.torre_id is distinct from old.torre_id or new.piso is distinct from old.piso or
     new.estante_id is distinct from old.estante_id or new.posicion is distinct from old.posicion then
    raise exception 'La topología física no se modifica' using errcode = '55000';
  end if;
  return new;
end;
$$;

create function public.registrar_codigo_ubicacion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_dueno bigint;
begin
  insert into public.ubicacion_codigos (codigo, compartimiento_id)
  values (new.codigo, new.id) on conflict (codigo) do nothing;
  select compartimiento_id into v_dueno
    from public.ubicacion_codigos where codigo = new.codigo;
  if v_dueno is distinct from new.id then
    raise exception 'El código ya está reservado para otra ubicación' using errcode = '23505';
  end if;
  if tg_op = 'UPDATE' and new.codigo is distinct from old.codigo then
    insert into public.cambios_codigo_ubicacion
      (compartimiento_id, codigo_anterior, codigo_nuevo, actor_id)
    values (new.id, old.codigo, new.codigo, (select auth.uid()));
  end if;
  return new;
end;
$$;
create trigger compartimientos_registrar_codigo
after insert or update on public.compartimientos
for each row execute function public.registrar_codigo_ubicacion();

create function public.impedir_modificacion_registro_ubicacion()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'El registro de códigos y la topología son permanentes' using errcode = '55000';
end;
$$;
create trigger estantes_topologia_fija before update or delete on public.estantes
for each row execute function public.impedir_modificacion_registro_ubicacion();
create trigger ubicacion_codigos_inmutables before update or delete on public.ubicacion_codigos
for each row execute function public.impedir_modificacion_registro_ubicacion();
create trigger cambios_codigo_inmutables before update or delete on public.cambios_codigo_ubicacion
for each row execute function public.impedir_modificacion_registro_ubicacion();

-- Un estante se configura junto con sus cuatro cajas, en una transacción.
-- La topología inmutable y el UNIQUE de posición conservan después ese total.
create function public.verificar_cuatro_cajas_estante()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.compartimientos where estante_id = new.id and tipo = 'caja') <> 4 then
    raise exception 'Cada estante requiere exactamente cuatro cajas' using errcode = '23514';
  end if;
  return new;
end;
$$;
create constraint trigger estantes_cuatro_cajas after insert on public.estantes
deferrable initially deferred for each row execute function public.verificar_cuatro_cajas_estante();

-- Defender también contra privilegios por defecto de Supabase.
alter table public.estantes enable row level security;
alter table public.ubicacion_codigos enable row level security;
alter table public.cambios_codigo_ubicacion enable row level security;
revoke all on table public.estantes, public.ubicacion_codigos, public.cambios_codigo_ubicacion
  from public, anon, authenticated;
revoke all on sequence public.cambios_codigo_ubicacion_id_seq from public, anon, authenticated;
grant select on table public.estantes, public.ubicacion_codigos, public.cambios_codigo_ubicacion to authenticated;
create policy "Cuenta Ingeagro lee estantes" on public.estantes for select to authenticated
  using ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);
create policy "Cuenta Ingeagro lee codigos de ubicacion" on public.ubicacion_codigos for select to authenticated
  using ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);
create policy "Cuenta Ingeagro lee cambios de codigo" on public.cambios_codigo_ubicacion for select to authenticated
  using ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);
revoke all on function public.normalizar_codigo_ubicacion(), public.registrar_codigo_ubicacion(),
  public.impedir_modificacion_compartimiento(), public.impedir_modificacion_registro_ubicacion(),
  public.verificar_cuatro_cajas_estante()
  from public, anon, authenticated;

commit;
