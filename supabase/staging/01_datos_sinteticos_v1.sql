-- =====================================================================================================================
-- DATOS SINTÉTICOS V1 PARA STAGING  (supabase/staging/01_datos_sinteticos_v1.sql)
-- =====================================================================================================================
-- QUÉ ES
--   Crea 3 productos ficticios («PRUEBA ...») y movimientos históricos sobre el esquema V1 (compartimientos de torre), para
--   que, DESPUÉS de aplicar las 4 migraciones V2, se pruebe el backfill de ubicaciones y la compatibilidad con movimientos
--   históricos (sin solicitud_id ni códigos de ubicación capturados). No contiene ningún dato real.
--
-- SOLO STAGING. Exige public.entorno_staging con nombre 'ingeagro-v2-staging' (creada por 00_marcador_staging.sql); si no
--   existe, aborta sin cambios.
--
-- DEBE EJECUTARSE ANTES DE LAS MIGRACIONES V2. Exige el esquema V1: sin la columna movimientos.solicitud_id y sin la tabla
--   public.estantes. Si V2 ya está aplicada, aborta sin cambios.
--
-- NO SE REPITE: si ya existe alguno de los 3 productos sintéticos, aborta sin cambios.
--
-- ORDEN: 8 migraciones V1 -> seed.sql -> 00_marcador_staging.sql -> ESTE archivo -> script de usuarios -> pruebas V1 ->
--        4 migraciones V2 -> pruebas -> aprovisionamiento con etiquetas ficticias.
--
-- MOVIMIENTOS (se insertan en public.movimientos; el trigger aplicar_movimiento() aplica el stock; NO hay ningún insert
-- directo en public.inventario). Compartimientos localizados por código:
--   P1  PRUEBA Sensor ficticio (Sensores)          entrada 10 -> C111 ; traslado 3 C111 -> C112
--   P2  PRUEBA Motor ficticio (Motores)            entrada 5 -> C211 ; retiro 1 desde C211 ;
--                                                  ajuste +1 (destino C211) ; ajuste -1 (origen C211)
--   P3  PRUEBA Producto sin stock (Motores)        sin movimientos ni inventario
-- RESULTADO FINAL OBLIGATORIO (se comprueba dentro de la transacción; si no coincide se aborta y no queda nada):
--   P1: C111 = 7 y C112 = 3 (2 filas) ; P2: C211 = 4 (1 fila) ; P3: ninguna fila de inventario ; 6 movimientos en total.
--
-- ATOMICIDAD: un único bloque DO (una sola sentencia = una transacción). Sin BEGIN/COMMIT explícito para no dejar la
--   sesión del editor en transacción abortada si algo falla.
-- =====================================================================================================================

do $sinteticos$
declare
  v_p1 constant uuid := '5e000000-0000-4000-8000-000000000001';
  v_p2 constant uuid := '5e000000-0000-4000-8000-000000000002';
  v_p3 constant uuid := '5e000000-0000-4000-8000-000000000003';
  v_cat_sensores uuid;
  v_cat_motores uuid;
  v_c111 bigint;
  v_c112 bigint;
  v_c211 bigint;
begin
  -- Marcador de staging.
  if to_regclass('public.entorno_staging') is null then
    raise exception 'No existe public.entorno_staging: ejecute primero 00_marcador_staging.sql en el proyecto de staging. No se hizo ningún cambio.';
  end if;
  if not exists (select 1 from public.entorno_staging where id = 1 and nombre = 'ingeagro-v2-staging') then
    raise exception 'public.entorno_staging no identifica a ingeagro-v2-staging: no es el proyecto de staging. No se hizo ningún cambio.';
  end if;

  -- Esquema V1 completo y sin V2.
  if to_regclass('public.productos') is null or to_regclass('public.movimientos') is null
     or to_regclass('public.inventario') is null or to_regclass('public.compartimientos') is null
     or to_regprocedure('public.registrar_ajuste_fisico(uuid,bigint,integer,integer)') is null then
    raise exception 'Faltan las migraciones V1: aplíquelas antes. No se hizo ningún cambio.';
  end if;
  if to_regclass('public.estantes') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public'
                and table_name = 'movimientos' and column_name = 'solicitud_id') then
    raise exception 'Ya hay esquema V2 (public.estantes o movimientos.solicitud_id): estos datos deben crearse ANTES de las migraciones V2. No se hizo ningún cambio.';
  end if;

  -- No repetir.
  if exists (select 1 from public.productos where id in (v_p1, v_p2, v_p3)) then
    raise exception 'Ya existen los productos sintéticos: el script no se repite. No se hizo ningún cambio.';
  end if;

  -- Dependencias del seed: categorías y compartimientos.
  select id into v_cat_sensores from public.categorias where lower(btrim(nombre)) = 'sensores';
  select id into v_cat_motores from public.categorias where lower(btrim(nombre)) = 'motores';
  if v_cat_sensores is null or v_cat_motores is null then
    raise exception 'Faltan las categorías Sensores/Motores (migración del catálogo). No se hizo ningún cambio.';
  end if;
  select id into v_c111 from public.compartimientos where codigo = 'C111';
  select id into v_c112 from public.compartimientos where codigo = 'C112';
  select id into v_c211 from public.compartimientos where codigo = 'C211';
  if v_c111 is null or v_c112 is null or v_c211 is null then
    raise exception 'Faltan los compartimientos C111, C112 o C211: ejecute supabase/seed.sql. No se hizo ningún cambio.';
  end if;

  -- Productos ficticios (sin foto).
  insert into public.productos (id, nombre, categoria_id, descripcion, foto_ruta) values
    (v_p1, 'PRUEBA Sensor ficticio', v_cat_sensores, 'Dato sintético de staging. No es un producto real.', null),
    (v_p2, 'PRUEBA Motor ficticio', v_cat_motores, 'Dato sintético de staging. No es un producto real.', null),
    (v_p3, 'PRUEBA Producto sin stock', v_cat_motores, 'Dato sintético de staging sin stock. No es un producto real.', null);

  -- Movimientos históricos: el trigger movimientos_aplicar_stock actualiza public.inventario.
  -- clock_timestamp() da fechas crecientes y distintas, útiles para probar el orden del historial.
  insert into public.movimientos (producto_id, tipo, cantidad, origen_compartimiento_id, destino_compartimiento_id, fecha)
    values (v_p1, 'entrada', 10, null, v_c111, clock_timestamp());
  insert into public.movimientos (producto_id, tipo, cantidad, origen_compartimiento_id, destino_compartimiento_id, fecha)
    values (v_p1, 'traslado', 3, v_c111, v_c112, clock_timestamp());
  insert into public.movimientos (producto_id, tipo, cantidad, origen_compartimiento_id, destino_compartimiento_id, fecha)
    values (v_p2, 'entrada', 5, null, v_c211, clock_timestamp());
  insert into public.movimientos (producto_id, tipo, cantidad, origen_compartimiento_id, destino_compartimiento_id, fecha)
    values (v_p2, 'retiro', 1, v_c211, null, clock_timestamp());
  -- Ajuste positivo (destino) y ajuste negativo (origen): cubren las dos formas del tipo 'ajuste'. Neto 0 sobre el stock.
  insert into public.movimientos (producto_id, tipo, cantidad, origen_compartimiento_id, destino_compartimiento_id, fecha)
    values (v_p2, 'ajuste', 1, null, v_c211, clock_timestamp());
  insert into public.movimientos (producto_id, tipo, cantidad, origen_compartimiento_id, destino_compartimiento_id, fecha)
    values (v_p2, 'ajuste', 1, v_c211, null, clock_timestamp());

  -- Comprobación final dentro de la misma transacción.
  if (select count(*) from public.inventario where producto_id = v_p1) <> 2
     or (select cantidad from public.inventario where producto_id = v_p1 and compartimiento_id = v_c111) is distinct from 7
     or (select cantidad from public.inventario where producto_id = v_p1 and compartimiento_id = v_c112) is distinct from 3
     or (select count(*) from public.inventario where producto_id = v_p2) <> 1
     or (select cantidad from public.inventario where producto_id = v_p2 and compartimiento_id = v_c211) is distinct from 4
     or exists (select 1 from public.inventario where producto_id = v_p3)
     or (select count(*) from public.movimientos where producto_id in (v_p1, v_p2, v_p3)) <> 6
     or exists (select 1 from public.movimientos where producto_id = v_p3)
     or (select count(*) from public.productos where id in (v_p1, v_p2, v_p3) and foto_ruta is null) <> 3 then
    raise exception 'El resultado no es P1 C111=7/C112=3, P2 C211=4 y P3 sin stock: se revierte todo';
  end if;
end;
$sinteticos$;

-- Resultado visible (solo se alcanza si el bloque anterior terminó bien): stock sintético por producto y compartimiento.
select p.nombre, c.codigo, i.cantidad
  from public.productos p
  left join public.inventario i on i.producto_id = p.id
  left join public.compartimientos c on c.id = i.compartimiento_id
 where p.id in ('5e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000002',
                '5e000000-0000-4000-8000-000000000003')
 order by p.nombre, c.codigo;
