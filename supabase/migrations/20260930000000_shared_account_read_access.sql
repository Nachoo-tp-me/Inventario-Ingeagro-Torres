-- Bloque 2: acceso de lectura exclusivo para la cuenta compartida de Ingeagro.
-- El UUID de Auth es una identidad pública, no una contraseña ni una clave API.
-- Los permisos de escritura se definirán al implementar las operaciones de inventario.

grant select on table public.categorias, public.productos, public.torres,
  public.compartimientos, public.inventario, public.movimientos
  to authenticated;

create policy "Cuenta Ingeagro lee categorias"
  on public.categorias for select to authenticated
  using ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);

create policy "Cuenta Ingeagro lee productos"
  on public.productos for select to authenticated
  using ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);

create policy "Cuenta Ingeagro lee torres"
  on public.torres for select to authenticated
  using ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);

create policy "Cuenta Ingeagro lee compartimientos"
  on public.compartimientos for select to authenticated
  using ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);

create policy "Cuenta Ingeagro lee inventario"
  on public.inventario for select to authenticated
  using ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);

create policy "Cuenta Ingeagro lee movimientos"
  on public.movimientos for select to authenticated
  using ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);
