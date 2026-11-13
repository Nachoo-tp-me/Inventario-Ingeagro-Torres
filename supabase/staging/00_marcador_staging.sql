-- =====================================================================================================================
-- MARCADOR DE ENTORNO STAGING  (supabase/staging/00_marcador_staging.sql)
-- =====================================================================================================================
-- QUÉ ES
--   Crea la tabla public.entorno_staging con UNA fila (id = 1) que identifica esta base de datos como el proyecto de
--   pruebas aislado «ingeagro-v2-staging» y guarda la referencia de su proyecto Supabase (el <ref> de <ref>.supabase.co).
--   Los demás scripts de staging (datos sintéticos, usuarios de prueba) exigen este marcador antes de tocar nada, de modo
--   que NO puedan ejecutarse por error en otro proyecto.
--
-- NUNCA SE EJECUTA EN PRODUCCIÓN.
--   Este archivo no es una migración y vive fuera de supabase/migrations/. Solo se pega a mano en el SQL Editor del
--   proyecto de STAGING. Si el proyecto ya contiene la cuenta autorizada, productos o movimientos, el script aborta.
--
-- PASOS PARA EL OPERADOR (SQL Editor, rol postgres)
--   1. Confirme que está en el proyecto «ingeagro-v2-staging» (Project Settings > General > Reference ID).
--   2. Sustituya SOLO el literal '__REF_STAGING__' de la línea marcada «EDITAR» (20 caracteres a-z y 0-9: el Reference ID).
--   3. Pegue el archivo completo y ejecútelo UNA vez. Debe terminar mostrando una fila con el nombre y la referencia.
--
-- ORDEN: 8 migraciones V1 -> seed.sql (3 torres, 72 compartimientos) -> ESTE archivo -> 01_datos_sinteticos_v1.sql ->
--        script de usuarios -> pruebas V1 -> 4 migraciones V2 -> pruebas -> aprovisionamiento con etiquetas ficticias.
--   El marcador se crea ANTES de los usuarios de prueba a propósito: si la cuenta autorizada ya existe, se aborta.
--
-- GUARDAS (si alguna falla, se aborta con un mensaje claro y NO cambia nada)
--   * '__REF_STAGING__' sin editar o con formato distinto de ^[a-z0-9]{20}$.
--   * Ya existe public.entorno_staging (no se ejecuta dos veces).
--   * Faltan las migraciones V1 (no existe public.registrar_ajuste_fisico) o no hay exactamente 72 compartimientos
--     (falta ejecutar supabase/seed.sql).
--   * Existe en auth.users la cuenta autorizada d5211ae5-39c6-4365-ad35-e6f6bdcc8058 (indicio de proyecto ya en uso).
--   * Hay filas en public.productos o public.movimientos (indicio de datos reales).
--
-- ATOMICIDAD
--   Todo el trabajo (guardas + tabla + permisos + política + fila + trigger) va dentro de UN SOLO bloque DO: una única
--   sentencia que PostgreSQL ejecuta en una transacción propia, de modo que o queda todo creado o no cambia nada. Se evita
--   a propósito un BEGIN/COMMIT explícito para que un error no deje la sesión del editor en transacción abortada.
--
-- SEGURIDAD DEL MARCADOR
--   * RLS habilitado; sin permisos para public, anon ni authenticated salvo SELECT de authenticated, y solo la cuenta
--     autorizada lo ve (política con (select auth.uid())).
--   * service_role solo SELECT (el script de usuarios lee el marcador con la service key).
--   * Inmutable: un trigger impide UPDATE, DELETE y TRUNCATE; su función no es ejecutable por public, anon ni authenticated.
-- =====================================================================================================================

do $marcador$
declare
  -- ===== EDITAR: referencia del proyecto de staging (la del subdominio <ref>.supabase.co) ==========================
  v_ref constant text := '__REF_STAGING__';
  -- ================================================================================================================
  v_nombre constant text := 'ingeagro-v2-staging';
  v_cuenta constant uuid := 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058';
  v_n bigint;
begin
  -- Referencia editada y con formato válido.
  if v_ref is null or v_ref collate "C" !~ '^[a-z0-9]{20}$' then
    raise exception 'Referencia de staging sin editar o inválida («%»): edite v_ref con el Reference ID de 20 caracteres a-z0-9. No se hizo ningún cambio.', v_ref;
  end if;

  -- No repetir.
  if to_regclass('public.entorno_staging') is not null then
    raise exception 'Ya existe public.entorno_staging: el marcador no se crea dos veces. No se hizo ningún cambio.';
  end if;

  -- Migraciones V1 y seed aplicados.
  if to_regclass('public.productos') is null or to_regclass('public.movimientos') is null
     or to_regclass('public.compartimientos') is null
     or to_regprocedure('public.registrar_ajuste_fisico(uuid,bigint,integer,integer)') is null then
    raise exception 'Faltan las migraciones V1 (no existe public.registrar_ajuste_fisico o las tablas base): aplíquelas antes. No se hizo ningún cambio.';
  end if;
  select count(*) into v_n from public.compartimientos;
  if v_n <> 72 then
    raise exception 'Se esperaban exactamente 72 compartimientos y hay %: ejecute supabase/seed.sql (3 torres) antes. No se hizo ningún cambio.', v_n;
  end if;

  -- Indicios de producción o de proyecto ya en uso.
  if to_regclass('auth.users') is null then
    raise exception 'No existe auth.users: esto no parece un proyecto Supabase. No se hizo ningún cambio.';
  end if;
  if exists (select 1 from auth.users where id = v_cuenta) then
    raise exception 'La cuenta autorizada % ya existe en auth.users: indicio de producción o de staging ya iniciado; el marcador debe crearse ANTES de los usuarios. No se hizo ningún cambio.', v_cuenta;
  end if;
  if exists (select 1 from public.productos) or exists (select 1 from public.movimientos) then
    raise exception 'Hay filas en public.productos o public.movimientos: indicio de datos reales. No se hizo ningún cambio.';
  end if;

  -- Tabla del marcador.
  create table public.entorno_staging (
    id smallint primary key check (id = 1),
    nombre text not null check (nombre = 'ingeagro-v2-staging'),
    project_ref text not null check (project_ref ~ '^[a-z0-9]{20}$'),
    creado_en timestamptz not null default now()
  );
  comment on table public.entorno_staging is
    'Marcador del proyecto Supabase de pruebas ingeagro-v2-staging. Inmutable. NUNCA existe en producción.';

  -- Permisos: Supabase concede por defecto a anon, authenticated y service_role; se cierran y se reabre solo lo necesario.
  alter table public.entorno_staging enable row level security;
  revoke all on table public.entorno_staging from public, anon, authenticated, service_role;
  grant select on table public.entorno_staging to authenticated, service_role;
  create policy "Cuenta Ingeagro lee entorno staging" on public.entorno_staging for select to authenticated
    using ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);

  insert into public.entorno_staging (id, nombre, project_ref) values (1, v_nombre, v_ref);

  -- Inmutabilidad (se crea después de insertar la fila).
  create function public.impedir_modificacion_entorno_staging()
  returns trigger language plpgsql set search_path = '' as $fn$
  begin
    raise exception 'El marcador de entorno staging es permanente' using errcode = '55000';
  end;
  $fn$;
  revoke all on function public.impedir_modificacion_entorno_staging() from public, anon, authenticated, service_role;
  create trigger entorno_staging_inmutable before update or delete on public.entorno_staging
    for each row execute function public.impedir_modificacion_entorno_staging();
  create trigger entorno_staging_sin_truncate before truncate on public.entorno_staging
    for each statement execute function public.impedir_modificacion_entorno_staging();

  -- Comprobación final dentro de la misma transacción.
  if (select count(*) from public.entorno_staging where id = 1 and nombre = v_nombre and project_ref = v_ref) <> 1 then
    raise exception 'El marcador no quedó como se esperaba: se revierte todo';
  end if;
end;
$marcador$;

-- Resultado visible (solo se alcanza si el bloque anterior terminó bien).
select id, nombre, project_ref, creado_en from public.entorno_staging;
