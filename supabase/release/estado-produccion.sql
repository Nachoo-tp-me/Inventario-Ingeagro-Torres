-- ESTADO DEL ESQUEMA DE PRODUCCIÓN (solo lectura, una sola sentencia SELECT, sin datos personales).
-- Responde: ¿es exactamente V1 (8 migraciones) y cumple las condiciones que exigen las 6 migraciones pendientes?
select json_build_object(
  'postgres',                 current_setting('server_version'),
  'rol',                      current_user,
  'hay_historial',            to_regclass('supabase_migrations.schema_migrations') is not null,
  -- V1 presente
  'tablas_v1',                (select count(*) from pg_tables where schemaname = 'public'
                                 and tablename in ('categorias','productos','torres','compartimientos','inventario','movimientos')),
  'rpc_ajuste',               to_regprocedure('public.registrar_ajuste_fisico(uuid,bigint,integer,integer)') is not null,
  'ajuste_usa_40001',         coalesce(position('40001' in pg_get_functiondef(to_regprocedure('public.registrar_ajuste_fisico(uuid,bigint,integer,integer)'))) > 0, false),
  'ajuste_usa_pt409',         coalesce(position('PT409' in pg_get_functiondef(to_regprocedure('public.registrar_ajuste_fisico(uuid,bigint,integer,integer)'))) > 0, false),
  'bucket_privado',           (select not public from storage.buckets where id = 'product-images'),
  'politicas_public',         (select count(*) from pg_policies where schemaname = 'public'),
  'politicas_storage_fotos',  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
                                 and (qual ilike '%product-images%' or with_check ilike '%product-images%')),
  'cuenta_autorizada',        exists (select 1 from auth.users where id = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'),
  'registro_staging',         to_regclass('public.entorno_staging') is not null,
  -- Guardas que exige 20261014000000 (si alguna falla, esa migración aborta sin cambios)
  'pg14_o_superior',          current_setting('server_version_num')::int >= 140000,
  'codigo_generado',          exists (select 1 from pg_attribute where attrelid = 'public.compartimientos'::regclass
                                        and attname = 'codigo' and attgenerated = 's' and not attisdropped),
  'codigos_no_cxyz',          (select count(*) from public.compartimientos
                                 where codigo is distinct from ('C' || torre_id::text || piso::text || posicion::text)),
  'compartimientos',          (select count(*) from public.compartimientos),
  -- V2 todavía ausente (si algo existe, hay deriva: detener)
  'v2_estantes',              to_regclass('public.estantes') is not null,
  'v2_ubicacion_codigos',     to_regclass('public.ubicacion_codigos') is not null,
  'v2_renombrar',             to_regprocedure('public.renombrar_codigo_caja(bigint,text,text)') is not null,
  'v2_columnas_movimientos',  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'movimientos'
                                 and column_name in ('codigo_origen','codigo_destino','solicitud_id')),
  -- Riesgos de la ventana de despliegue
  'api_tx_largas',            (select count(*) from pg_stat_activity where usename = 'authenticator' and now() - xact_start > interval '30 seconds'),
  'conexiones_api',           (select count(*) from pg_stat_activity where usename = 'authenticator')
) as estado;
