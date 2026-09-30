-- Bloque 2 solo consulta torres, compartimientos, inventario y productos.
-- Categorías e historial permanecen cerrados hasta sus funcionalidades futuras.

revoke select on table public.categorias, public.movimientos from authenticated;

drop policy "Cuenta Ingeagro lee categorias" on public.categorias;
drop policy "Cuenta Ingeagro lee movimientos" on public.movimientos;
