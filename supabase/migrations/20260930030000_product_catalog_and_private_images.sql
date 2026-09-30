-- Bloque 4: escritura mínima del catálogo para la cuenta compartida.
grant insert, update on table public.productos to authenticated;
grant insert on table public.categorias to authenticated;

create policy "Cuenta Ingeagro crea productos"
  on public.productos for insert to authenticated
  with check ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);

create policy "Cuenta Ingeagro edita productos"
  on public.productos for update to authenticated
  using ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid)
  with check ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);

create policy "Cuenta Ingeagro crea categorias"
  on public.categorias for insert to authenticated
  with check ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);

-- Las categorías del seed local también deben existir en cloud.
insert into public.categorias (nombre)
values ('Microcontroladores'), ('Sensores'), ('Motores'), ('Cables'),
       ('Conectores'), ('Fuentes'), ('Mecánica'), ('Herramientas'), ('Otros')
on conflict do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Cuenta Ingeagro lee fotos de productos"
  on storage.objects for select to authenticated
  using (bucket_id = 'product-images'
    and (select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);

create policy "Cuenta Ingeagro sube fotos de productos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images'
    and (select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);

create policy "Cuenta Ingeagro reemplaza fotos de productos"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images'
    and (select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid)
  with check (bucket_id = 'product-images'
    and (select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);

create policy "Cuenta Ingeagro elimina fotos de productos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images'
    and (select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);
