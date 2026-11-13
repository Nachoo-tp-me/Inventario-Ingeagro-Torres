-- HUELLA DE DATOS DE NEGOCIO (solo lectura, una sola sentencia SELECT).
-- Solo usa columnas que existen en V1 y que V2 NO modifica: el resultado debe ser IDÉNTICO en
--   (a) producción antes de migrar, (b) el respaldo restaurado en local y (c) producción después de migrar.
-- No devuelve datos personales: solo recuentos, sumas y md5 de filas ordenadas.
select json_build_object(
  'categorias',       (select count(*) from public.categorias),
  'productos',        (select count(*) from public.productos),
  'productos_foto',   (select count(*) from public.productos where foto_ruta is not null),
  'inventario_filas', (select count(*) from public.inventario),
  'stock_total',      (select coalesce(sum(cantidad), 0) from public.inventario),
  'compartimientos',  (select count(*) from public.compartimientos),
  'movimientos',      (select count(*) from public.movimientos),
  'mov_por_tipo',     (select coalesce(json_object_agg(tipo, n order by tipo), '{}'::json)
                         from (select tipo, count(*) n from public.movimientos group by tipo) t),
  'ultimo_mov',       (select max(fecha) from public.movimientos),
  'usuarios_auth',    (select count(*) from auth.users),
  'fotos_storage',    (select count(*) from storage.objects where bucket_id = 'product-images'),
  'md5_categorias',   (select md5(coalesce(string_agg(row_to_json(c)::text, E'\n' order by c.id), '')) from public.categorias c),
  'md5_productos',    (select md5(coalesce(string_agg(row_to_json(p)::text, E'\n' order by p.id), '')) from public.productos p),
  'md5_inventario',   (select md5(coalesce(string_agg(row_to_json(i)::text, E'\n' order by i.producto_id, i.compartimiento_id), '')) from public.inventario i),
  'md5_ubicaciones',  (select md5(coalesce(string_agg(c.id::text || '|' || c.codigo, E'\n' order by c.id), '')) from public.compartimientos c),
  'md5_movimientos',  (select md5(coalesce(string_agg(concat_ws('|', m.id, m.producto_id, m.tipo, m.cantidad, m.origen_compartimiento_id,
                         m.destino_compartimiento_id, m.fecha), E'\n' order by m.id), '')) from public.movimientos m),
  'md5_usuarios',     (select md5(coalesce(string_agg(concat_ws('|', u.id, u.email, u.created_at), E'\n' order by u.id), '')) from auth.users u),
  'md5_fotos',        (select md5(coalesce(string_agg(o.name || '|' || coalesce(o.metadata->>'size', ''), E'\n' order by o.name), ''))
                         from storage.objects o where o.bucket_id = 'product-images')
) as huella;
