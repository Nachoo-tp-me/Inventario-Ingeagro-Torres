# Inventario Ingeagro Torres

Aplicación Next.js con TypeScript. Este repositorio contiene por ahora la base
del proyecto y el modelo de datos; la interfaz de inventario aún no está
implementada.

Requiere Node.js 22 o superior.

## Desarrollo

```bash
npm install
npm run dev
```

Validación: `npm run build` y `npm run lint`.

## Supabase

- La migración está en `supabase/migrations/` y el seed en `supabase/seed.sql`.
- El seed crea nueve categorías, las torres C1-C3 y 24 compartimientos por torre.
- Copiar `.env.example` a `.env.local` y completar la URL y la clave **publicable**
  desde el panel del proyecto Supabase. `.env.local` está ignorado por Git.
- Para una base local, usar Supabase CLI y Docker: `npx supabase@latest start`
  aplica las migraciones y el seed; `npx supabase@latest db reset` los vuelve a
  aplicar desde cero.
- No hay políticas RLS ni login todavía: la clave publicable no da acceso a las
  tablas. La política de acceso deberá definirse antes de usar datos en la UI.
