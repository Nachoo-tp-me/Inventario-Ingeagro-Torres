# Inventario Ingeagro Torres

Aplicación web para localizar productos y registrar inventario físico en torres. La V1 incluye catálogo con fotografías privadas, movimientos de stock, historial, búsqueda, carga rápida y exportación CSV, Excel y PNG. **Requiere conexión a Internet**; añadirla a la pantalla de inicio no habilita uso sin conexión.

## Stack y requisitos

- Next.js 16, React 19 y TypeScript.
- Supabase Cloud: Auth, PostgreSQL con RLS y Storage privado.
- Node.js 22 o superior y npm. Docker es necesario solo para `npm run test:db`.
- Una cuenta Supabase existente autorizada; el registro público está deshabilitado en Supabase Auth.

## Desarrollo local

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Completar `.env.local` con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` del proyecto Supabase. Son los dos únicos valores que necesita el navegador. **No incluir** `service_role`, contraseña de base de datos ni tokens personales. `.env.local` está ignorado por Git.

La aplicación se abre en `http://localhost:3000`. `allowedDevOrigins` permite usar la IP LAN del equipo durante el desarrollo; no concede acceso a datos sin login ni altera la seguridad de producción.

Comandos: `npm run build`, `npm run lint`, `npm test` y `npm run test:db`. Las migraciones reproducibles están en `supabase/migrations/`; `supabase/seed.sql` crea las categorías y las torres iniciales en una base nueva. No ejecutar un reset sobre el proyecto cloud con datos reales.

## Operación

- El código `Cxyz` indica torre `x`, piso `y` y posición `z`. Cada torre tiene pisos 6 a 1 y cuatro compartimientos por piso.
- **Rojo** significa ocupado con stock positivo; **verde**, disponible sin stock.
- Entrada, retiro, traslado y ajuste crean movimientos. El historial se conserva; no se editan directamente las cantidades del inventario.
- Carga rápida sigue las posiciones 1 → 2 → 3 → 4 y luego baja al piso siguiente. La última posición se guarda solo en el dispositivo.
- Exportar inventario descarga CSV, XLSX o PNG directamente al dispositivo. Los productos sin stock aparecen en CSV/XLSX con cantidad 0 y ubicación vacía. No se suben archivos exportados a Storage.

## Despliegue en Vercel

Importar este repositorio GitHub en Vercel como proyecto Next.js, con raíz en este directorio y `main` como rama de producción. Una integración Git activa despliega los futuros pushes a `main` automáticamente. Configurar en el entorno **Production** solo `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, y volver a desplegar si se modifican. No cargar `.env.local` a Vercel.

El plan gratuito Hobby de Vercel está limitado a uso personal no comercial. Un inventario de empresa requiere un plan elegible, como Pro; verificar el plan antes de publicar.

En Supabase Auth, mantener deshabilitado el registro de usuarios nuevos. Después de obtener la URL HTTPS definitiva, configurar **Authentication → URL Configuration → Site URL** con esa URL exacta. Si se usan redirecciones de correo, añadir esa URL exacta a **Redirect URLs** y, si hace falta para desarrollo, `http://localhost:3000/**`. El login actual usa correo y contraseña directamente y no depende de una ruta de callback. Mantener RLS, la identidad autorizada y el bucket privado existentes.

En Android o escritorio se puede usar la opción de instalación del navegador. En iPhone/iPad: Safari → Compartir → Añadir a pantalla de inicio. La V1 no tiene service worker ni caché de inventario: **siempre requiere Internet**.
