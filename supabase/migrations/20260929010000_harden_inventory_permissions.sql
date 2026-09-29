-- Supabase concedió permisos directos por defecto a anon y authenticated.
-- Los triggers se ejecutan por sus tablas; estas funciones no son RPC públicas.
revoke execute on function
  public.actualizar_fecha_modificacion(),
  public.aplicar_movimiento(),
  public.crear_compartimientos_de_torre(),
  public.impedir_modificacion_compartimiento(),
  public.impedir_modificacion_movimiento()
from anon, authenticated;

revoke all on sequence
  public.compartimientos_id_seq,
  public.movimientos_id_seq
from anon, authenticated;
