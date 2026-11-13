-- HISTORIAL DE MIGRACIONES (solo lectura, una sola sentencia SELECT). Ejecutar SOLO si estado-produccion.sql indica
-- hay_historial = true (si la tabla no existe, esta consulta falla sin efectos). Sustituye a `migration list` y a
-- `db push --dry-run` en la verificación previa: así no se invoca ninguna orden de la CLI que pudiera crear o alterar el historial.
select json_build_object(
  'versiones', (select coalesce(json_agg(version order by version), '[]'::json) from supabase_migrations.schema_migrations)
) as historial;
