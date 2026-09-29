-- Modelo inicial. Las tablas quedan cerradas a las claves publicables hasta definir
-- una política de acceso para la aplicación en un bloque posterior.

create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) > 0),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create unique index categorias_nombre_unico_idx
  on public.categorias (lower(btrim(nombre)));

create table public.productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) > 0),
  -- No es único: permite advertir nombres parecidos sin prohibirlos.
  nombre_normalizado text generated always as (
    regexp_replace(lower(btrim(nombre)), '[^[:alnum:]]+', '', 'g')
  ) stored,
  categoria_id uuid not null references public.categorias(id) on delete restrict,
  descripcion text,
  -- Ruta opcional del objeto; la carga de fotos y el bucket se definirán después.
  foto_ruta text check (foto_ruta is null or length(btrim(foto_ruta)) > 0),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint productos_nombre_normalizado_no_vacio check (nombre_normalizado <> '')
);

create index productos_nombre_normalizado_idx
  on public.productos (nombre_normalizado);

create index productos_categoria_id_idx
  on public.productos (categoria_id);

create table public.torres (
  id smallint primary key check (id between 1 and 5),
  codigo text generated always as ('C' || id::text) stored unique
);

create table public.compartimientos (
  id bigint generated always as identity primary key,
  torre_id smallint not null references public.torres(id) on delete restrict,
  piso smallint not null check (piso between 1 and 6),
  posicion smallint not null check (posicion between 1 and 4),
  codigo text generated always as (
    'C' || torre_id::text || piso::text || posicion::text
  ) stored,
  constraint compartimientos_ubicacion_unica unique (torre_id, piso, posicion),
  constraint compartimientos_codigo_unico unique (codigo)
);

-- Cada torre se crea con sus 24 compartimientos en la misma transacción.
create function public.crear_compartimientos_de_torre()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.compartimientos (torre_id, piso, posicion)
  select new.id, piso.numero, posicion.numero
  from pg_catalog.generate_series(1, 6) as piso(numero)
  cross join pg_catalog.generate_series(1, 4) as posicion(numero);
  return new;
end;
$$;

create trigger torres_crear_compartimientos
after insert on public.torres
for each row execute function public.crear_compartimientos_de_torre();

-- La topología física es fija: no se editan ni eliminan compartimientos.
create function public.impedir_modificacion_compartimiento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Los compartimientos físicos no se editan ni eliminan'
    using errcode = '55000';
end;
$$;

create trigger compartimientos_topologia_fija
before update or delete on public.compartimientos
for each row execute function public.impedir_modificacion_compartimiento();

create table public.inventario (
  producto_id uuid not null references public.productos(id) on delete restrict,
  compartimiento_id bigint not null references public.compartimientos(id) on delete restrict,
  cantidad integer not null default 0 check (cantidad >= 0),
  primary key (producto_id, compartimiento_id)
);

-- Un compartimiento está ocupado solo si tiene alguna fila con cantidad > 0.
create index inventario_ocupado_idx
  on public.inventario (compartimiento_id) where cantidad > 0;

create table public.movimientos (
  id bigint generated always as identity primary key,
  producto_id uuid not null references public.productos(id) on delete restrict,
  tipo text not null check (tipo in ('entrada', 'retiro', 'traslado', 'ajuste')),
  cantidad integer not null check (cantidad > 0),
  origen_compartimiento_id bigint references public.compartimientos(id) on delete restrict,
  destino_compartimiento_id bigint references public.compartimientos(id) on delete restrict,
  fecha timestamptz not null default now(),
  constraint movimientos_ubicaciones_validas check (
    (tipo = 'entrada' and origen_compartimiento_id is null and destino_compartimiento_id is not null)
    or (tipo = 'retiro' and origen_compartimiento_id is not null and destino_compartimiento_id is null)
    or (tipo = 'traslado' and origen_compartimiento_id is not null
        and destino_compartimiento_id is not null
        and origen_compartimiento_id <> destino_compartimiento_id)
    -- Ajuste positivo: destino. Ajuste negativo: origen.
    or (tipo = 'ajuste' and num_nonnulls(origen_compartimiento_id, destino_compartimiento_id) = 1)
  )
);

create index movimientos_producto_fecha_idx
  on public.movimientos (producto_id, fecha desc);

create function public.actualizar_fecha_modificacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

create trigger categorias_actualizado_en
before update on public.categorias
for each row execute function public.actualizar_fecha_modificacion();

create trigger productos_actualizado_en
before update on public.productos
for each row execute function public.actualizar_fecha_modificacion();

-- Insertar un movimiento aplica el cambio de stock en la misma transacción.
-- Un retiro/traslado/ajuste negativo sin stock suficiente falla y no crea historial.
create function public.aplicar_movimiento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger movimientos_aplicar_stock
after insert on public.movimientos
for each row execute function public.aplicar_movimiento();

-- El historial se corrige con nuevos ajustes, no editando movimientos pasados.
create function public.impedir_modificacion_movimiento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Los movimientos son inmutables; registre un ajuste'
    using errcode = '55000';
end;
$$;

create trigger movimientos_solo_insercion
before update or delete on public.movimientos
for each row execute function public.impedir_modificacion_movimiento();

revoke execute on function public.actualizar_fecha_modificacion(),
  public.aplicar_movimiento(), public.impedir_modificacion_movimiento(),
  public.crear_compartimientos_de_torre(), public.impedir_modificacion_compartimiento()
  from public;

alter table public.categorias enable row level security;
alter table public.productos enable row level security;
alter table public.torres enable row level security;
alter table public.compartimientos enable row level security;
alter table public.inventario enable row level security;
alter table public.movimientos enable row level security;

-- No hay login ni políticas de acceso en este bloque. Una clave publicable no
-- puede leer o escribir estas tablas hasta definir grants y políticas RLS.
revoke all on table public.categorias, public.productos, public.torres,
  public.compartimientos, public.inventario, public.movimientos
  from anon, authenticated;
