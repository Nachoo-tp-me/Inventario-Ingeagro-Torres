-- El detalle de compartimientos muestra la categoría real del producto.
-- Solo la cuenta compartida puede leer categorías; no se habilita escritura.

grant select on table public.categorias to authenticated;

create policy "Cuenta Ingeagro lee categorias"
  on public.categorias for select to authenticated
  using ((select auth.uid()) = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'::uuid);
