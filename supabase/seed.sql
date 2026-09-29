-- Datos iniciales idempotentes. Supabase CLI ejecuta este archivo después de
-- las migraciones en `supabase start` y `supabase db reset`.

insert into public.categorias (nombre)
values
  ('Microcontroladores'),
  ('Sensores'),
  ('Motores'),
  ('Cables'),
  ('Conectores'),
  ('Fuentes'),
  ('Mecánica'),
  ('Herramientas'),
  ('Otros')
on conflict do nothing;

insert into public.torres (id)
values (1), (2), (3)
on conflict do nothing;

-- El trigger de torres crea automáticamente los 24 compartimientos de cada una.
