# 02 - Proyecto Supabase de pruebas (`ingeagro-v2-staging`): creación, orden de ejecución y pruebas

**Objetivo:** validar V2 (PostgREST + JWT, Auth, RLS, Storage y la app real) en un proyecto aislado, con datos **sintéticos**, antes de
tocar producción (runbook §6). Documento operativo, sin credenciales. No se ha ejecutado nada. Sustituya `<ref>` por la referencia del
proyecto staging (nunca por la de producción).

Archivos que se usan (los entregan otros agentes): `supabase/staging/00_marcador_staging.sql`,
`supabase/staging/01_datos_sinteticos_v1.sql`, `supabase/staging/02_aprovisionamiento_ficticio_staging.sql` (solo staging; aborta
sin marcador coincidente),
`scripts/staging/crear-usuarios-prueba.mjs`, `tests/staging/aceptacion.staging.mjs`.

## 1. Requisitos y coste

- Plan **Free**: sin coste. Máximo **2 proyectos activos** por cuenta/organización (producción cuenta como uno). Si el botón de crear
  pide pasar a Pro, **deténgase**: no mejore el plan ni borre/pause producción; pause o borre otro proyecto propio.
- Un proyecto Free se **pausa tras ~1 semana sin actividad**; se reanuda con **Resume project** (hasta 1 año). Free **no tiene respaldos
  diarios** (son de Pro): el staging es desechable y se recrea desde estos pasos.
- En el equipo de Nacho: Node.js **22 o superior** (`node --version`) para el script y las pruebas. Este documento no necesita Docker, `psql`
  ni Supabase CLI. Todo el SQL se ejecuta en el **SQL Editor** del panel.
- El staging es un **camino de un solo sentido**: el aprovisionamiento (E6) es irreversible por diseño. Si algo sale mal antes, se
  borra el proyecto y se repite desde §2.

## 2. Crear el proyecto

1. https://supabase.com/dashboard → **New project** → organización propia.
2. Nombre `ingeagro-v2-staging`. **Database password**: generar en el gestor de contraseñas propio (no compartir ni pegar en chats,
   repo ni terminal). Región: la misma que producción (visible en el proyecto de producción, solo lectura) para comportamiento
   similar. Plan: confirmar «Free / $0».
3. Opciones de seguridad que aparezcan al crear (Data API, RLS automático, exposición automática de tablas, etc.): deje **Data API
   activada** (la app la usa) y **anote cada opción elegida**; los valores por defecto pueden diferir de los de producción y afectar los
   privilegios por defecto. Las migraciones declaran sus propios `grant/revoke`, pero cualquier diferencia debe registrarse.
4. **Authentication → Sign In / Providers**: desactivar **Allow new users to sign up** (igual que `enable_signup = false` de producción). El
   proveedor Email queda activo (el login es correo + contraseña). Anonymous sign-ins debe seguir apagado.
5. Dónde está cada dato (copiarlo del panel al terminal cuando se pida; **nunca a un archivo versionado**):

| Dato | Pantalla (puede variar) | ¿Secreto? |
|---|---|---|
| Reference ID (`<ref>`) | Project Settings → General; también el subdominio de la URL | No |
| Project URL `https://<ref>.supabase.co` | Project Settings → Data API (o botón **Connect**) | No |
| Publishable key (`sb_publishable_…`; clave `anon` en «Legacy») | Project Settings → API Keys | No (va al navegador) |
| Secret key (`sb_secret_…`; `service_role` en «Legacy») | Project Settings → API Keys | **SÍ**: solo para el script de usuarios |
| Contraseña de base de datos | Se fijó al crear; se puede resetear en Project Settings → Database | **SÍ** |

   La secret key/`service_role` solo se usa en `crear-usuarios-prueba.mjs`, en una variable de proceso, y se descarta al terminar.
6. Antes de **cada** `Run` en el SQL Editor compruebe que el proyecto abierto es `ingeagro-v2-staging` (nombre arriba a la izquierda y
   `<ref>` en la URL del navegador). Tiene también el proyecto productivo en el mismo panel.

## 3. Cómo ejecutar archivos SQL en el SQL Editor

> **Método propuesto para las migraciones del staging:** Supabase CLI según `04-migraciones-cli-staging.md` (historial automático,
> `--dry-run`, destino explícito). Si se aprueba, las migraciones **no** se pegan en el SQL Editor; esta sección queda solo como
> referencia para consultas de verificación.

- **New query** → pegar el archivo **completo** → **Run**. Si hay texto seleccionado, Run ejecuta **solo la selección**: pulse una vez fuera
  del texto antes de ejecutar. Rol por defecto (`postgres`).
- Una migración por pestaña, en el orden de §4. Resultado esperado: «Success. No rows returned». Si el editor avisa de operaciones
  destructivas (`drop policy` en `20260930010000`), confirmar solo si el proyecto es el staging.
- **Transacciones:** las 8 migraciones V1 y `20261020000000` **no** traen transacción propia: péguelas envueltas en `begin;` (primera
  línea) … `commit;` (última línea). Las tres `20261014*` ya traen `begin/commit`: **no** las envuelva. Los scripts de
  `supabase/staging/` (incluido el aprovisionamiento ficticio) son un único bloque `DO` (atómico por sí mismo): péguelos tal cual.
- Si una ejecución falla, la transacción se revierte (gracias al punto anterior): repita la consulta de verificación de la fase
  anterior para confirmar que no quedó nada a medias, corrija la causa y vuelva a ejecutar el mismo archivo. No salte migraciones.
- **Caché de esquema de PostgREST:** al terminar **cada fase** de §4 ejecute `notify pgrst, 'reload schema';` y espere ~10 s antes
  de lanzar pruebas. Sin esto, la API puede seguir viendo el esquema anterior y dar falsos PGRST204/PGRST205.
- Si `20260930030000` fallara con `42501` sobre `storage.objects`/`storage.buckets` (permisos del esquema de Storage), cree el bucket
  `product-images` (privado, 5 MB, `image/jpeg`, `image/png`, `image/webp`) y las 4 políticas idénticas desde **Storage** en el panel,
  ejecute el resto del archivo y anótelo en los resultados.
- El SQL Editor **no** entiende metacomandos de `psql` (`\set`, `\if`, `\gset`): por eso existe
  `supabase/staging/02_aprovisionamiento_ficticio_staging.sql` (solo staging) y **no** debe pegarse `provision_estantes_cajas.sql` en
  el panel. El aprovisionamiento productivo se hará con ese script psql original; cómo ejecutarlo se decide en la fase de producción.
- Las migraciones así aplicadas **no** quedan registradas en `supabase_migrations.schema_migrations` (ver §8).

## 4. Orden exacto y verificación (solo lectura) por fase

Los archivos de migración están en `supabase/migrations/`. El orden cronológico es obligatorio (`20260930010000` elimina una política que
`20260930050000` vuelve a crear). Los conteos esperados salen de leer las migraciones; si algo no coincide, **detenerse** y no seguir.

### Fase 1 - Esquema V1 + semilla + marcador + datos sintéticos + usuarios

Ejecutar en este orden: `20260929000000_initial_inventory_schema`, `20260929010000_harden_inventory_permissions`,
`20260930000000_shared_account_read_access`, `20260930010000_limit_dashboard_read_access`,
`20260930020000_shared_account_category_read`, `20260930030000_product_catalog_and_private_images`,
`20260930040000_limit_catalog_write_columns`, `20260930050000_transactional_stock_operations`; luego `supabase/seed.sql`.

Después editar **un solo literal** `'__REF_STAGING__'` de `supabase/staging/00_marcador_staging.sql` (poner `<ref>`) y ejecutarlo. Aborta si
el literal sigue sin editar, si el marcador ya existe, si el UUID autorizado ya está en `auth.users` o si hay filas en `productos` o
`movimientos`. Después ejecutar `supabase/staging/01_datos_sinteticos_v1.sql`. **No guardar con commit la edición del literal**
(descartar el cambio del archivo en el repositorio o trabajar sobre una copia fuera del repo).

```sql
-- V1: debe dar categorias 9, torres 3, compartimientos 72, productos 3, movimientos > 0
select (select count(*) from public.categorias) categorias, (select count(*) from public.torres) torres,
       (select count(*) from public.compartimientos) compartimientos, (select count(*) from public.productos) productos,
       (select count(*) from public.movimientos) movimientos;
-- Marcador: nombre ingeagro-v2-staging y project_ref = <ref>
select * from public.entorno_staging;
-- Stock sintético esperado: P1 C111=7, C112=3; P2 C211=4; P3 sin filas con cantidad > 0
select p.nombre, c.codigo, i.cantidad from public.inventario i join public.productos p on p.id = i.producto_id
  join public.compartimientos c on c.id = i.compartimiento_id order by p.nombre, c.codigo;
-- Bucket privado: public = false, file_size_limit = 5242880, 3 tipos MIME
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'product-images';
-- RLS activo en las 6 tablas V1
select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;
-- Políticas públicas esperadas: categorias 2, productos 3, torres 1, compartimientos 1, inventario 1, movimientos 2, entorno_staging 1
select tablename, count(*) from pg_policies where schemaname = 'public' group by 1 order by 1;
-- Políticas de Storage esperadas: 4
select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'Cuenta Ingeagro%';
```

`entorno_staging` añade 1 política pública propia (lectura solo para el UUID autorizado): súmela a los conteos de políticas de `public`
de esta y de las fases siguientes (`entorno_staging` 1). La prueba de aceptación lee el marcador con la sesión del usuario **autorizado**
(la clave publicable por sí sola, sin sesión, no puede leerlo).

**Crear usuarios** (después del marcador; §6.1) y confirmar en **Authentication → Users**: el autorizado con id
`d5211ae5-39c6-4365-ad35-e6f6bdcc8058` y un ajeno con otro id, ambos con correo confirmado.

```sql
select id, email, email_confirmed_at is not null as confirmado from auth.users order by created_at;
```

**Pruebas E0/E1** (§7): app `main` local contra staging (E0) y `STAGING_ETAPA=v1` (E1: Auth + RLS con autorizado, ajeno y anónimo).

### Fase 2 - Tres migraciones V2 sin idempotencia

Ejecutar `20261014000000_physical_locations_and_code_registry`, `20261014010000_movement_location_code_snapshots` y
`20261014020000_authorized_box_code_rename`. **Todavía no** `20261020000000`.

```sql
-- estantes 0; ubicacion_codigos 72; todas las filas existentes son tipo 'compartimiento'
select (select count(*) from public.estantes) estantes, (select count(*) from public.ubicacion_codigos) codigos,
       (select count(*) from public.compartimientos where tipo = 'compartimiento') torre,
       (select count(*) from public.compartimientos where tipo = 'caja') cajas;
-- Debe devolver codigo_origen y codigo_destino y NO solicitud_id
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'movimientos' order by ordinal_position;
-- Políticas públicas: las 10 de V1 + entorno_staging (1) + estantes, ubicacion_codigos y cambios_codigo_ubicacion (1 cada una)
select tablename, count(*) from pg_policies where schemaname = 'public' group by 1 order by 1;
-- Función de renombrado presente
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('renombrar_codigo_caja', 'registrar_ajuste_fisico');
-- Los movimientos sintéticos anteriores conservan códigos NULL (histórico)
select count(*) filter (where codigo_destino is null and codigo_origen is null) sin_codigos, count(*) total from public.movimientos;
```

**Pruebas E2** (§7, etapa `v2-sin-idempotencia`): la app V2 debe fallar al registrar movimientos con **PGRST204 real** y mensaje de
incompatibilidad, sin degradar a movimientos sin UUID.

### Fase 3 - Idempotencia

Ejecutar `20261020000000_movement_request_idempotency`.

```sql
select column_name, data_type, is_nullable from information_schema.columns
  where table_schema = 'public' and table_name = 'movimientos' and column_name = 'solicitud_id';   -- uuid, YES
select conname from pg_constraint where conrelid = 'public.movimientos'::regclass and conname = 'movimientos_solicitud_id_key';
select grantee, privilege_type from information_schema.column_privileges   -- authenticated / INSERT
  where table_schema = 'public' and table_name = 'movimientos' and column_name = 'solicitud_id';
select count(*) from public.movimientos where solicitud_id is not null;     -- 0 antes de las pruebas
```

**Pruebas E3-E5** (§7, etapa `v2`): E3 `23505` real al repetir `solicitud_id`; E4 app **V1** sobre el esquema migrado; E5 Storage privado
(subida, URL firmada, reemplazo, borrado, límites del bucket, acceso de ajeno/anónimo). Cierre de fase (estructura lista para aprovisionar):

```sql
select (select count(*) from public.compartimientos where tipo = 'compartimiento') torre, (select count(*) from public.estantes) estantes;  -- 72, 0
```

### Fase 4 - Aprovisionamiento FICTICIO (irreversible)

Preparar `supabase/staging/02_aprovisionamiento_ficticio_staging.sql` **en una copia fuera del repo** (o sin commitear), editando
`v_ref_esperada` (el `<ref>` del staging), la confirmación y las **24 etiquetas ficticias** (formato `^[A-Z0-9][A-Z0-9_-]{0,23}$`, sin
«C»+dígitos), **obligatoriamente con prefijo `STG`**. Es **solo para staging**: aborta si `public.entorno_staging` no existe, no es válido
o su `project_ref` no coincide con `v_ref_esperada`. Producción usa únicamente `supabase/provisioning/provision_estantes_cajas.sql`
(psql, sin cambios). Etiquetas de ejemplo: `STG-E1-P1`,
`STG-E1-P2`, `STG-E1-P3`, `STG-E1-P4`, `STG-E2-P1` … `STG-E6-P4`. **Nunca** las etiquetas reales de producción. Ejecutar en el SQL Editor.

```sql
select (select count(*) from public.estantes) estantes,                                            -- 6
       (select count(*) from public.compartimientos where tipo = 'caja') cajas,                    -- 24
       (select count(*) from public.compartimientos) ubicaciones,                                  -- 96
       (select count(*) from public.ubicacion_codigos) codigos;                                    -- 96
select e.id as estante, count(*) as cajas from public.compartimientos c join public.estantes e on e.id = c.estante_id group by 1 order by 1;  -- 4 por estante
select min(id), max(id) from public.compartimientos where tipo = 'caja';                           -- normalmente 73..96
```

**Pruebas E6-E7** (§7, etapa `v2-aprovisionado`; E7 = humo de la UI V2 según runbook §4 con la app local apuntando al staging).

## 5. App local contra el staging

La app lee `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (valores no secretos). `.env.local` está ignorado por Git y
(al redactar esto) no existe en el repositorio. Desde PowerShell, en la raíz del repo:

```powershell
Get-ChildItem Env:NEXT_PUBLIC*                      # Debe estar vacío: una variable de proceso gana a .env.local
if (Test-Path .env.local) { Copy-Item .env.local .env.local.produccion }   # copia por si existía uno (también ignorado)
@"
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key del STAGING>
"@ | Set-Content -Encoding ascii .env.local        # ascii: sin BOM
Select-String -Path .env.local -Pattern 'SUPABASE_URL'   # comprobar que es <ref> staging
git status --short                                   # no debe aparecer .env.local
npm run dev                                          # reiniciar siempre tras cambiar .env.local
```

**Al terminar** (y antes de cualquier build o prueba local posterior): detener `npm run dev`, restaurar con
`Move-Item -Force .env.local.produccion .env.local` o eliminar `.env.local` si no existía, y repetir el `Select-String` para
confirmar que **no apunta al staging por error ni a producción sin querer**.

**V1 (E0/E4), opción sin tocar la rama del repo principal:** `git worktree add ../ingeagro-v1-staging main`, luego `npm ci` y su propio
`.env.local` (igual que arriba) dentro de esa carpeta. Al terminar: `git worktree remove ../ingeagro-v1-staging`. Es una opción, no se
ejecuta aquí; añade metadatos de worktree en `.git`.

## 6. Scripts en PowerShell (variables solo de proceso, nada en archivos)

Las variables `$env:` viven solo en esa ventana de PowerShell. `Read-Host` no guarda lo escrito en el historial de comandos.

### 6.1 Crear usuarios de prueba (una vez, tras el marcador)

```powershell
$env:STAGING_CONFIRM      = 'ingeagro-v2-staging'
$env:STAGING_PROJECT_REF  = '<ref>'
$env:STAGING_URL          = "https://$($env:STAGING_PROJECT_REF).supabase.co"      # exactamente así
function Pedir($t) { [System.Net.NetworkCredential]::new('', (Read-Host $t -AsSecureString)).Password }
$env:STAGING_SERVICE_KEY        = Pedir 'Secret/service key del STAGING'
$env:STAGING_AUTORIZADO_EMAIL   = 'autorizado@staging.invalid'      # ficticio
$env:STAGING_AUTORIZADO_PASSWORD = Pedir 'Contraseña autorizado'
$env:STAGING_AJENO_EMAIL        = 'ajeno@staging.invalid'
$env:STAGING_AJENO_PASSWORD     = Pedir 'Contraseña ajeno'
node scripts/staging/crear-usuarios-prueba.mjs
Remove-Item Env:STAGING_SERVICE_KEY      # las contraseñas se mantienen: las usan las pruebas de 6.2 (limpieza total al final)
```

Si el servidor rechaza el dominio `.invalid`, use un correo propio con alias (`tucorreo+autorizado@…`). Contraseñas distintas de las reales
y del gestor de producción. Ante un id duplicado, el comportamiento de GoTrue **no está documentado**: no reintente a ciegas; revise
**Authentication → Users** (borrar el usuario de prueba desde el panel y repetir) o recree el proyecto.

### 6.2 Pruebas de aceptación por etapa

```powershell
$env:STAGING_PUBLISHABLE_KEY = '<publishable key del STAGING>'     # no secreta
# (mantener STAGING_CONFIRM, STAGING_PROJECT_REF, STAGING_URL y las credenciales de ambos usuarios de 6.1)
$env:STAGING_ETAPA = 'v1'      # v1 | v2-sin-idempotencia | v2 | v2-aprovisionado
node --test tests/staging/aceptacion.staging.mjs
```

| Cuándo | `STAGING_ETAPA` | Cubre |
|---|---|---|
| Fin de fase 1 | `v1` | E0 (app `main` local, manual) y E1 (Auth + RLS) |
| Fin de fase 2 | `v2-sin-idempotencia` | E2: PGRST204 real |
| Fin de fase 3 | `v2` | E3: 23505 real; E4: V1 sobre esquema migrado (manual); E5: Storage privado |
| Fin de fase 4 | `v2-aprovisionado` | E6: 6 estantes / 24 cajas; E7: humo UI (runbook §4, manual) |

Las pruebas exigen el marcador antes de escribir y no usan la service key. Al terminar:
`Remove-Item Env:STAGING_* ; Remove-Item (Get-PSReadLineOption).HistorySavePath` solo si alguna vez escribió un valor sensible en
la línea de comandos (borra TODO el historial de PowerShell). Cerrar la ventana también descarta las variables.

## 7. Qué hacer si una etapa falla

No continúe a la siguiente fase. Anote el mensaje exacto y la consulta de verificación que no coincidió. Si el fallo es del staging (no de
la app), recréelo: Project Settings → General → **Delete project** (solo `ingeagro-v2-staging`, confirmando el nombre) y repita §2.

## 8. Historial de migraciones: SQL Editor frente a CLI

**Requisito (Nacho/Gepeto, 13-nov-2026):** cualquier aplicación futura de migraciones, por SQL Editor o por CLI, en staging o en
producción, debe dejar un **historial verificable** en `supabase_migrations.schema_migrations` (una fila por versión aplicada) que se
pueda contrastar con `npx supabase migration list` y con el esquema real (consultas de §4). Los scripts de `supabase/staging/` y el
aprovisionamiento no son migraciones y no se registran ahí; su evidencia es la salida de su `SELECT` final y `docs/staging/03-resultados.md`.

- **SQL Editor:** aplica el SQL pero **no escribe** por sí solo en `supabase_migrations.schema_migrations`. Para cumplir el requisito,
  cada migración pegada debe registrar su versión **dentro de la misma transacción** (`begin;` … migración … registro … `commit;`), de
  forma que migración e historial queden juntos o no quede ninguno. Antes de usarlo hay que fijar la definición exacta de la tabla que
  espera la versión del CLI que se usará después (sus columnas cambian entre versiones; [I] al menos `version`, `name`, `statements`):
  decisión pendiente, se resuelve antes de la Fase 1 del staging. Sin ese registro, **no** se usa SQL Editor para migraciones.
- **CLI** (`npx supabase link --project-ref <ref>` + `npx supabase db push`; necesita `SUPABASE_ACCESS_TOKEN` o contraseña de BD, y según la guía
  `managing-environments` no requiere Docker): compara los archivos locales con ese historial y aplica los que faltan. **Peligro en
  producción:** si las 8 migraciones V1 se aplicaron a mano (sin historial), `db push` las considerará pendientes e intentará
  reaplicarlas (fallarán o, peor, duplicarán efectos). Antes use siempre `npx supabase migration list` y `npx supabase db push --dry-run`.
- **Consultar qué consta en producción (solo lectura):** panel de producción → **Database → Migrations**, o en su SQL Editor:
  `select version, name from supabase_migrations.schema_migrations order by 1;`. Un error `relation ... does not exist` significa que
  nunca se usó el historial (todas aplicadas a mano o por otra vía). Compare además el esquema real (existencia de tablas/columnas) con
  las consultas de §4, porque el historial puede mentir o estar incompleto.
- **Recomendación para producción (decisión posterior de Nacho):** (a) usar CLI con enlace **explícito** y revisión de `--dry-run`; si V1 no
  consta en el historial, registrar primero las 8 versiones V1 como aplicadas con `npx supabase migration repair --status applied <versión>`
  (una por versión) y solo entonces `db push` las 4 V2; o (b) aplicar las 4 V2 por SQL Editor registrando cada versión en la misma
  transacción que su migración (comprobar antes con `information_schema.columns` las columnas reales de `supabase_migrations.schema_migrations`). No ejecute
  `migration repair` ni `link` contra producción como parte de este trabajo.

## 9. Respaldo de producción (el staging no lo necesita)

El aprovisionamiento es irreversible: el respaldo es la única vuelta atrás. En producción: **Database → Backups** (si es Free solo mostrará
una oferta de Pro; el plan se ve en la facturación de la organización). Opciones **sin Docker**, de menor a mayor garantía:

1. **CSV por tabla:** Table Editor → tabla → Export/«Download CSV» para `categorias`, `productos`, `torres`, `compartimientos`, `inventario`,
   `movimientos`. Verifique que el nº de filas coincide con `select count(*)` (los resultados del SQL Editor pueden estar limitados).
   Es restaurable solo a mano.
2. **Fotografías:** Storage → `product-images`: descargar los archivos; guardar junto con `productos.foto_ruta`. Verificar que no hay descarga
   masiva no está garantizada en el panel: cuente los archivos descargados frente a `select count(*) from storage.objects where bucket_id = 'product-images'`.
3. **`pg_dump` con herramientas cliente de PostgreSQL** (sin Docker; requiere instalar «Command Line Tools» de PostgreSQL, decisión de
   Nacho): conexión **session pooler** desde el botón **Connect** (la directa suele ser solo IPv6 en Free);
   `pg_dump "<uri>" --schema=public --no-owner -f respaldo-prod.sql`, archivo **fuera del repo**. Es el único con esquema + datos restaurables.
   `supabase db dump` normalmente exige Docker.
4. **Pro temporal** para obtener respaldos y restauración del panel: tiene coste; decisión explícita de Nacho.

Registre antes y después los conteos de tablas (`select count(*)` por tabla) y guarde el respaldo con fecha. Respaldos con datos reales:
guardar cifrados y fuera de Git.

## 10. Limpieza y pausa del staging

Al terminar todas las etapas y firmar el despliegue: (1) borrar `.env.local` de staging y `.env.local.produccion` si no se necesita
(§5); (2) borrar el worktree de V1 si se creó; (3) **Pausar** el staging (Project Settings → General → Pause project) o **borrarlo** cuando
ya no haga falta (Delete project). Pausarlo libera un cupo de los 2 activos. Si se pausa por falta de uso, se reanuda con **Resume
project**; datos sintéticos, sin valor que conservar. Cambie o elimine los usuarios de prueba y las claves si el proyecto se conserva.

## 11. NUNCA hacer

- `supabase config push` contra staging **ni** producción (el `config.toml` declara el `site_url` y redirecciones de producción).
- `supabase link` a producción, ni `db push`/`migration repair` contra producción durante estas pruebas.
- Pegar URL/claves/contraseñas en el repositorio, `.env.example`, issues, chats o commits (solo en `.env.local` ignorado y variables de proceso).
- Ejecutar scripts o pruebas de `staging` con `STAGING_URL` de producción (los scripts exigen `https://<ref>.supabase.co` y el marcador; no
  intente saltarlos).
- Poner la secret key/`service_role` en la app, en Netlify o en `.env.local`.
- Usar etiquetas reales de las 24 cajas, productos reales o correos reales en el staging.
- Ejecutar el SQL de `supabase/staging/` o el aprovisionamiento en el SQL Editor del proyecto productivo.
- Editar y commitear literales de `__REF_STAGING__` o etiquetas en los archivos del repositorio.
