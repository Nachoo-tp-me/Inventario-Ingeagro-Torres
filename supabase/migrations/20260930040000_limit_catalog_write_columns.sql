-- Solo se pueden escribir los campos del formulario. Los IDs, timestamps y
-- columnas generadas existentes no pueden alterarse mediante la API.
revoke insert, update on table public.productos from authenticated;
grant insert (id, nombre, categoria_id, descripcion, foto_ruta)
  on table public.productos to authenticated;
grant update (nombre, categoria_id, descripcion, foto_ruta)
  on table public.productos to authenticated;

revoke insert on table public.categorias from authenticated;
grant insert (nombre) on table public.categorias to authenticated;
