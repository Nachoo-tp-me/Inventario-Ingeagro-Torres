-- Aprovisionamiento UNICO de los 6 estantes y las 24 cajas físicas (total esperado: 72 + 24 = 96 ubicaciones).
--
-- NO es una migración: vive fuera de supabase/migrations/ para que ninguna herramienta lo ejecute automáticamente.
-- Lo ejecuta una persona, una sola vez por entorno, con una conexión administrativa, DESPUÉS de aplicar todas las migraciones
-- y de revisar el runbook (docs/runbook-despliegue-v2.md). No contiene etiquetas: las 24 etiquetas REALES son obligatorias.
--
--   psql "<conexión administrativa>" -X -v ON_ERROR_STOP=1 \
--     -v confirmo=APROVISIONAR_24_CAJAS \
--     -v etiquetas='["<24 etiquetas reales>"]' \
--     -f supabase/provisioning/provision_estantes_cajas.sql
--
-- Orden de las 24 etiquetas: estante 1 (posiciones 1, 2, 3, 4), estante 2 (1..4), ... estante 6 (1..4).
-- Posiciones físicas 2x2: 1 superior izquierda, 2 superior derecha, 3 inferior izquierda, 4 inferior derecha.
-- Cada etiqueta: 1 a 24 caracteres A-Z, 0-9, «_» o «-», empezando por letra o dígito, sin ser «C» + dígitos (reservado a torres).
--
-- Todo ocurre en UNA transacción: o quedan los 6 estantes y las 24 cajas, o no cambia nada. Una segunda ejecución falla sin
-- modificaciones. Respeta los triggers y las restricciones del Bloque 1 (cuatro cajas por estante, IDs permanentes, registro de
-- códigos). Las cajas reciben IDs 73..96 solo si la secuencia de ubicaciones no se ha consumido antes; los IDs no se fijan aquí.
\set ON_ERROR_STOP on
\if :{?confirmo}
\else
  \echo 'ERROR: falta -v confirmo=APROVISIONAR_24_CAJAS. No se hizo ningún cambio.'
  select 'abortado: faltan variables de aprovisionamiento'::int;
\endif
\if :{?etiquetas}
\else
  \echo 'ERROR: faltan las 24 etiquetas reales (-v etiquetas=...). No se hizo ningún cambio.'
  select 'abortado: faltan las etiquetas reales'::int;
\endif

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select set_config('provision.confirmo', :'confirmo', true) as _confirmo,
       set_config('provision.etiquetas', :'etiquetas', true) as _etiquetas \gset

do $$
declare
  v_raw jsonb;
  v_labels text[] := '{}';
  v_item jsonb;
  v_label text;
  v_position integer := 0;
  v_shelf integer;
  v_slot integer;
begin
  if current_setting('provision.confirmo') <> 'APROVISIONAR_24_CAJAS' then
    raise exception 'Confirmación inválida: use -v confirmo=APROVISIONAR_24_CAJAS';
  end if;

  -- Esquema listo: migraciones de ubicaciones físicas Y de idempotencia aplicadas.
  if to_regclass('public.estantes') is null or to_regclass('public.ubicacion_codigos') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                    and table_name = 'compartimientos' and column_name = 'tipo')
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                    and table_name = 'movimientos' and column_name = 'solicitud_id') then
    raise exception 'Aplique primero TODAS las migraciones (ubicaciones físicas, snapshots, renombrado e idempotencia)';
  end if;

  -- Estado previo: 72 compartimientos de torre y ningún estante ni caja (una segunda ejecución se detiene aquí).
  if (select count(*) from public.compartimientos where tipo = 'compartimiento') <> 72 then
    raise exception 'Se esperaban 72 compartimientos de torre';
  end if;
  if exists (select 1 from public.estantes) or exists (select 1 from public.compartimientos where tipo = 'caja') then
    raise exception 'Ya existen estantes o cajas: el aprovisionamiento no se repite y no se modificó nada';
  end if;

  -- Entrada: exactamente 24 cadenas, ya sin placeholders.
  begin
    v_raw := current_setting('provision.etiquetas')::jsonb;
  exception when others then
    raise exception 'Las etiquetas deben ser un arreglo JSON de 24 cadenas';
  end;
  if jsonb_typeof(v_raw) <> 'array' or jsonb_array_length(v_raw) <> 24 then
    raise exception 'Se requieren EXACTAMENTE 24 etiquetas reales (recibidas: %)',
      case when jsonb_typeof(v_raw) = 'array' then jsonb_array_length(v_raw)::text else 'no es un arreglo' end;
  end if;
  for v_item in select value from jsonb_array_elements(v_raw) loop
    v_position := v_position + 1;
    if jsonb_typeof(v_item) <> 'string' then
      raise exception 'La etiqueta % no es una cadena', v_position;
    end if;
    v_label := pg_catalog.upper(pg_catalog.btrim(v_item #>> '{}') collate "C");
    if v_label collate "C" !~ '^[A-Z0-9][A-Z0-9_-]{0,23}$' then
      raise exception 'Etiqueta % inválida o sin completar: «%»', v_position, v_item #>> '{}';
    end if;
    if v_label collate "C" ~ '^C[0-9]+$' then
      raise exception 'La etiqueta % («%») está reservada a torres', v_position, v_label;
    end if;
    if v_label = any (v_labels) then
      raise exception 'La etiqueta % («%») está repetida', v_position, v_label;
    end if;
    if exists (select 1 from public.ubicacion_codigos where codigo = v_label) then
      raise exception 'La etiqueta % («%») ya está reservada por otra ubicación', v_position, v_label;
    end if;
    v_labels := v_labels || v_label;
  end loop;

  for v_shelf in 1..6 loop
    insert into public.estantes (id) values (v_shelf);
    for v_slot in 1..4 loop
      insert into public.compartimientos (tipo, estante_id, posicion, codigo)
      values ('caja', v_shelf, v_slot, v_labels[(v_shelf - 1) * 4 + v_slot]);
    end loop;
  end loop;

  -- Estado final comprobado dentro de la misma transacción.
  if (select count(*) from public.estantes) <> 6
     or (select count(*) from public.compartimientos where tipo = 'caja') <> 24
     or (select count(*) from public.compartimientos) <> 96
     or exists (select 1 from public.estantes e where (select count(*) from public.compartimientos c where c.estante_id = e.id) <> 4)
     or (select count(*) from public.ubicacion_codigos) <> 96 then
    raise exception 'El estado final no es 6 estantes, 24 cajas y 96 ubicaciones: se revierte todo';
  end if;
end;
$$;

commit;
\echo 'OK: 6 estantes y 24 cajas aprovisionados (96 ubicaciones físicas).'
