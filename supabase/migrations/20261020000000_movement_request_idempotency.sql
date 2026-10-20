-- C2b: idempotencia de movimientos de inventario.
-- Una solicitud logica (entrada, retiro o traslado) lleva un UUID generado una vez por el cliente. La restriccion UNIQUE hace
-- que PostgreSQL rechace una segunda fila con el mismo UUID: el trigger AFTER INSERT public.aplicar_movimiento() no llega a
-- ejecutarse para la fila rechazada, por lo que el stock nunca se aplica dos veces. Los triggers, las politicas RLS, la
-- inmutabilidad de movimientos y la RPC de ajuste fisico no cambian.
--
-- Aditiva y retrocompatible: la columna admite NULL (movimientos historicos y clientes V1 siguen con NULL; en una
-- restriccion UNIQUE los NULL no colisionan). NO se usa NULLS NOT DISTINCT. Esta migracion debe instalarse ANTES de desplegar
-- la aplicacion que envia solicitud_id. Sin transaccion explicita: la gestiona el mecanismo de migraciones.
alter table public.movimientos
  add column solicitud_id uuid,
  add constraint movimientos_solicitud_id_key unique (solicitud_id);

grant insert (solicitud_id) on table public.movimientos to authenticated;
