-- =====================================================================================================================
-- Aprovisionamiento FICTICIO de los 6 estantes y las 24 cajas, EXCLUSIVO DEL PROYECTO DE STAGING «ingeagro-v2-staging»
-- (total esperado: 72 + 24 = 96 ubicaciones).  Archivo: supabase/staging/02_aprovisionamiento_ficticio_staging.sql
-- =====================================================================================================================
-- SOLO STAGING. Antes de leer o escribir cualquier otra cosa, el bloque EXIGE public.entorno_staging (creado por
-- 00_marcador_staging.sql) con exactamente una fila id = 1, nombre = 'ingeagro-v2-staging' y project_ref IGUAL a la
-- referencia que el operador escribe en v_ref_esperada. Si el marcador no existe, no es válido o no coincide, aborta sin
-- cambios. NO EXISTE ningún camino que aprovisione un proyecto sin marcador: este archivo NO sirve para producción.
--
-- PRODUCCIÓN: usar únicamente supabase/provisioning/provision_estantes_cajas.sql (psql), versión canónica probada en
-- PostgreSQL desechable (tests/provisioning.local.mjs), que este bloque no modifica. Este archivo existe porque el SQL Editor
-- del panel no admite metacomandos psql (\set, \if, \gset, -v); su validación y su inserción son las del original, más las
-- guardas de staging. NO se ha ejecutado en PostgreSQL: solo se comprobó estáticamente
-- (tests/staging/aprovisionamiento-staging.local.test.mjs).
--
-- NO es una migración: vive fuera de supabase/migrations/ y no se registra en el historial de migraciones.
-- Se ejecuta UNA vez, DESPUÉS de las 12 migraciones, con 24 etiquetas FICTICIAS (prefijo STG o PRUEBA, obligatorio).
--
-- CÓMO USARLO (SQL Editor del proyecto de STAGING, rol postgres; trabajar sobre una copia fuera del repo)
--   1. Edite SOLO las tres líneas marcadas «EDITAR» dentro del bloque DECLARE:
--        v_ref_esperada -> cambie '__REF_STAGING__' por el Reference ID del staging (20 caracteres a-z0-9)
--        v_confirmo     -> cambie 'NO_CONFIRMADO' por 'APROVISIONAR_24_CAJAS'
--        v_etiquetas    -> sustituya las 24 cadenas '__COMPLETAR__' por 24 etiquetas ficticias STG-… (orden indicado abajo)
--   2. Pegue el archivo completo y ejecútelo UNA vez. Sin editar, falla sin cambiar nada.
--
-- Orden de las 24 etiquetas: estante 1 (posiciones 1, 2, 3, 4), estante 2 (1..4), ... estante 6 (1..4).
-- Posiciones físicas 2x2: 1 superior izquierda, 2 superior derecha, 3 inferior izquierda, 4 inferior derecha.
-- Cada etiqueta: 1 a 24 caracteres A-Z, 0-9, «_» o «-», empezando por letra o dígito, sin ser «C» + dígitos (reservado a
-- torres). Se normaliza con upper(btrim()) collate "C" (las minúsculas se aceptan y se pasan a mayúsculas).
--
-- Todo ocurre en UNA transacción: o quedan los 6 estantes y las 24 cajas, o no cambia nada. Una segunda ejecución falla sin
-- modificaciones. Respeta los triggers y las restricciones del Bloque 1 (cuatro cajas por estante, IDs permanentes, registro
-- de códigos). Las cajas reciben IDs 73..96 solo si la secuencia de ubicaciones no se ha consumido antes; los IDs no se
-- fijan aquí.
--
-- DIFERENCIAS EXACTAS RESPECTO AL ORIGINAL psql (solo la forma de recibir entradas y de delimitar la transacción)
--   1. Entradas: en lugar de -v confirmo / -v etiquetas + set_config + \gset, son dos literales (v_confirmo, v_etiquetas) al
--      principio del DECLARE, con valores por defecto que hacen fallar una ejecución sin editar.
--   2. Se eliminan los bloques \if :{?confirmo} / :{?etiquetas} (las variables siempre existen aquí); los dos defectos
--      cubren ese caso: 'NO_CONFIRMADO' -> «Confirmación inválida»; '__COMPLETAR__' -> «inválida o sin completar».
--   3. Transacción: el original usa begin; set local ...; do ...; commit;. Aquí es UN SOLO bloque DO (una sentencia = una
--      transacción, sin BEGIN/COMMIT explícito para que un fallo no deje la sesión del editor en transacción abortada).
--      lock_timeout 5s y statement_timeout 120s se fijan con set_config(..., true) (equivale a SET LOCAL) al inicio del
--      bloque. lock_timeout actúa desde ahí; statement_timeout ya no reinicia el temporizador de la sentencia en curso
--      (limitación del protocolo), así que rige el límite del propio editor para esta ejecución.
--   4. NUEVO: «set constraints all immediate» al final, dentro de la transacción. estantes_cuatro_cajas y
--      compartimientos_codigo_dueno_fk son DEFERRABLE INITIALLY DEFERRED; así sus fallos se detectan (con su mensaje) antes
--      de terminar, no al cerrar la transacción. En el original se comprobaban al COMMIT.
--   5. El mensaje final \echo 'OK: ...' se sustituye por un SELECT visible tras el bloque (solo se alcanza si todo salió bien).
--   6. El texto del error de confirmación cita el literal v_confirmo en lugar de «-v confirmo».
--   7. NUEVO (guarda de staging, PRIMERA comprobación del bloque): v_ref_esperada editada y con formato ^[a-z0-9]{20}$;
--      public.entorno_staging existe; tiene exactamente 1 fila; id = 1, nombre = 'ingeagro-v2-staging' y
--      project_ref = v_ref_esperada. Cualquier fallo aborta antes de leer etiquetas o escribir.
--   8. NUEVO: las 24 etiquetas deben empezar por STG o PRUEBA (ficticias).
--   Todo el cuerpo de validación (esquema, 72 compartimientos, sin estantes/cajas previos, arreglo de 24 cadenas,
--   normalización, formato, reservadas a torres, repetidas, ya reservadas, inserción 6x4, comprobación final) es idéntico
--   (lo comprueba la prueba local estática línea a línea).
-- =====================================================================================================================

do $provision$
declare
  -- ===== EDITAR 1/3: Reference ID del proyecto de STAGING (debe coincidir con public.entorno_staging.project_ref) ===
  v_ref_esperada constant text := '__REF_STAGING__';
  -- ===== EDITAR 2/3: confirmación exacta. Cambie 'NO_CONFIRMADO' por 'APROVISIONAR_24_CAJAS' ======================
  v_confirmo text := 'NO_CONFIRMADO';
  -- ===== EDITAR 3/3: 24 etiquetas FICTICIAS (prefijo STG o PRUEBA), arreglo JSON. Cada línea es un estante (pos. 1..4). =
  --   Sustituya cada '__COMPLETAR__' por una etiqueta. No toque las comillas dobles ni las comas. Sin dobles comillas ni
  --   comillas simples dentro de las etiquetas (no son caracteres válidos de todos modos).
  v_etiquetas text := '[
    "__COMPLETAR__", "__COMPLETAR__", "__COMPLETAR__", "__COMPLETAR__",
    "__COMPLETAR__", "__COMPLETAR__", "__COMPLETAR__", "__COMPLETAR__",
    "__COMPLETAR__", "__COMPLETAR__", "__COMPLETAR__", "__COMPLETAR__",
    "__COMPLETAR__", "__COMPLETAR__", "__COMPLETAR__", "__COMPLETAR__",
    "__COMPLETAR__", "__COMPLETAR__", "__COMPLETAR__", "__COMPLETAR__",
    "__COMPLETAR__", "__COMPLETAR__", "__COMPLETAR__", "__COMPLETAR__"
  ]';
  -- ===== FIN DE LAS ENTRADAS: no edite nada más abajo ==============================================================
  v_raw jsonb;
  v_labels text[] := '{}';
  v_item jsonb;
  v_label text;
  v_position integer := 0;
  v_shelf integer;
  v_slot integer;
begin
  -- Equivale a SET LOCAL del original (dentro de la transacción de este bloque).
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '120s', true);

  -- GUARDA DE STAGING (primera comprobación; nada se lee ni se escribe antes). Sin marcador válido y coincidente: abortar.
  if v_ref_esperada is null or v_ref_esperada collate "C" !~ '^[a-z0-9]{20}$' then
    raise exception 'SOLO STAGING: v_ref_esperada sin editar o inválida; ponga el Reference ID (20 caracteres a-z0-9) del proyecto de staging. No se hizo ningún cambio.';
  end if;
  if to_regclass('public.entorno_staging') is null then
    raise exception 'SOLO STAGING: no existe public.entorno_staging; este proyecto no es el staging marcado (¿producción?). No se hizo ningún cambio.';
  end if;
  if (select count(*) from public.entorno_staging) <> 1
     or not exists (select 1 from public.entorno_staging
                     where id = 1 and nombre = 'ingeagro-v2-staging' and project_ref = v_ref_esperada) then
    raise exception 'SOLO STAGING: el marcador public.entorno_staging no es válido o su project_ref no coincide con v_ref_esperada. No se hizo ningún cambio.';
  end if;

  if v_confirmo <> 'APROVISIONAR_24_CAJAS' then
    raise exception 'Confirmación inválida: ponga v_confirmo = APROVISIONAR_24_CAJAS';
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
    v_raw := v_etiquetas::jsonb;
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

  -- NUEVO (diferencia 8): en staging las 24 etiquetas deben ser ficticias (prefijo STG o PRUEBA).
  if (select count(*) from unnest(v_labels) as l(codigo) where l.codigo collate "C" ~ '^(STG|PRUEBA)') <> 24 then
    raise exception 'SOLO STAGING: las 24 etiquetas deben ser ficticias (prefijo STG o PRUEBA). No se hizo ningún cambio.';
  end if;

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

  -- NUEVO respecto al original: forzar ahora las restricciones diferidas (estantes_cuatro_cajas y
  -- compartimientos_codigo_dueno_fk) para que un fallo aborte el bloque con su mensaje y se revierta todo.
  set constraints all immediate;
end;
$provision$;

-- Resultado visible (solo se alcanza si el bloque anterior terminó bien): debe ser 6 | 24 | 96 | 96.
select (select count(*) from public.estantes) as estantes,
       (select count(*) from public.compartimientos where tipo = 'caja') as cajas,
       (select count(*) from public.compartimientos) as ubicaciones,
       (select count(*) from public.ubicacion_codigos) as codigos_registrados;

-- ---------------------------------------------------------------------------------------------------------------------
-- VERIFICACIÓN POSTERIOR (solo lectura; descomente y ejecute POR SEPARADO si quiere revisar el resultado):
--
-- select e.id as estante, e.grupo, c.posicion, c.id as ubicacion_id, c.codigo,
--        (r.compartimiento_id = c.id) as codigo_registrado
--   from public.estantes e
--   join public.compartimientos c on c.estante_id = e.id and c.tipo = 'caja'
--   left join public.ubicacion_codigos r on r.codigo = c.codigo
--  order by e.id, c.posicion;
--   -- Esperado: 24 filas (6 estantes x posiciones 1..4), codigo_registrado = true en todas, ubicacion_id 73..96.
-- ---------------------------------------------------------------------------------------------------------------------
