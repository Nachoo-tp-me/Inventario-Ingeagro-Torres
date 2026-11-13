# Runbook de despliegue V2 y checklist previo a publicar

Documento operativo. **No se ha ejecutado nada contra producción.** Cada paso lo ejecuta una persona autorizada; este repositorio no
contiene credenciales, URLs de producción ni etiquetas reales de cajas.

## 0. Estado técnico (resumen)

- Rama `feat/estantes-cajas-v2`, solo commits locales (sin push). UI00–UI09, C1, C2a, C2b y el aprovisionamiento están implementados y
  probados con servicios simulados y con **PostgreSQL 17.11 desechable**.
- **Validado en Supabase Cloud de staging** (`ingeagro-v2-staging`, sin datos reales; 12-nov-2026), con las 14 migraciones aplicadas por
  Supabase CLI 3.1.0 en tres tandas y el historial verificado: aceptación real V1 35/35, V2 intermedia 39/39, V2 completa 45/45 y V2
  aprovisionada 51/51 (Auth, RLS con autorizado/ajeno/anónimo, grants por columna, movimientos, ajuste físico, PGRST204, idempotencia
  `23505`, renombrado, Storage privado). Herramientas en `docs/staging/`, `supabase/staging/`, `scripts/staging/` y `tests/staging/`.
- **Defecto real encontrado en staging y corregido con migraciones aditivas:** `registrar_ajuste_fisico` (V1) y `renombrar_codigo_caja`
  (V2) señalaban el conflicto con SQLSTATE `40001`; PostgREST 14 trata `40001` como transitorio y **reintenta en bucle** hasta el timeout
  del gateway (~126 s observados). Ahora usan `PT409` (HTTP 409, sin reintentos); la app V2 acepta `PT409` y `40001`. **La producción V1
  tiene la función con `40001`** (ver §2, paso 2).

## 1. Antes de empezar (acciones humanas, BLOQUEANTES)

1. **Netlify (P1-2):** comprobar en el panel de Netlify si existen *branch deploys* o *deploy previews* para `feat/estantes-cajas-v2` o para
   cualquier rama, y a qué proyecto/variables de Supabase apuntan. Una vista previa de la rama V2 conectada a Supabase **productivo**
   ejecutaría el código V2 contra una base sin migrar (los movimientos fallarían con incompatibilidad de esquema, por diseño). Desactivar o
   apuntar las vistas previas a un proyecto de pruebas antes de cualquier `push`. Este repositorio no tiene `netlify.toml`.
2. **Las 24 etiquetas reales** de las cajas (orden: estante 1 posiciones 1–4, estante 2 … estante 6) acordadas por escrito.
3. **Respaldo verificable** de la base productiva (punto de recuperación o volcado) y ventana de mantenimiento. El aprovisionamiento es
   permanente por diseño (estantes, IDs y códigos no se borran): su única reversión es restaurar el respaldo.
4. **Validación en un Supabase aislado** (§6) con las pruebas de PostgREST/JWT/Storage reales.

## 2. Orden de despliegue (la base de datos siempre ANTES que la aplicación)

| Paso | Qué | Dónde | Notas |
|---|---|---|---|
| 1 | Respaldo | Producción | Obligatorio. |
| 2 | Migraciones en orden (Supabase CLI: `supabase db push` desde un enlace explícito al proyecto) | Producción | Ver lista abajo. Todas son aditivas. |
| 3 | Comprobar esquema | Producción (solo lectura) | `movimientos.solicitud_id` existe; `estantes`, `ubicacion_codigos` existen; 72 compartimientos de torre. |
| 4 | Desplegar la aplicación V2 | Netlify | Con 0 estantes la interfaz está pensada para mostrar «No hay estantes registrados» (verificarlo en el entorno aislado antes). |
| 5 | Aprovisionar 6 estantes y 24 cajas | Producción | `supabase/provisioning/provision_estantes_cajas.sql` con las etiquetas reales (§3). Una sola vez. |
| 6 | Pruebas de humo (§4) | Producción | Con la cuenta autorizada. |

Migraciones, en este orden: `20260929000000_initial_inventory_schema`, `20260929010000_harden_inventory_permissions`,
`20260930000000_shared_account_read_access`, `20260930010000_limit_dashboard_read_access`, `20260930020000_shared_account_category_read`,
`20260930030000_product_catalog_and_private_images`, `20260930040000_limit_catalog_write_columns`,
`20260930050000_transactional_stock_operations` (determinar cuáles faltan en producción con `supabase migration list` contra el proyecto enlazado y aplicar solo las pendientes, siempre en este orden),
**`20260930060000_physical_adjustment_conflict_pt409`** (corrección del bucle de reintentos; compatible con la app V1, que mostrará su
mensaje genérico de error al instante en lugar de quedar colgada),
`20261014000000_physical_locations_and_code_registry`, `20261014010000_movement_location_code_snapshots`,
`20261014020000_authorized_box_code_rename`, **`20261020000000_movement_request_idempotency`** (columna `solicitud_id` NULL + UNIQUE; sin
`NULLS NOT DISTINCT`; sin transacción propia: la gestiona el mecanismo de migraciones) y **`20261020010000_box_code_rename_conflict_pt409`**.

Las 14 están validadas en este orden sobre Supabase Cloud (staging). Producción tiene hoy, según lo esperado, las 8 primeras: el `dry-run`
debe listar **exactamente** las 6 restantes; cualquier otra diferencia detiene el despliegue.

### Migración in-place: qué se conserva y por qué

Las 6 migraciones pendientes son **expansiones**; ninguna borra ni reescribe datos de negocio:

| Dato de producción | Efecto de V2 |
|---|---|
| Productos, categorías, fotografías (columnas y bucket `product-images`) | Ninguno: ninguna migración V2 toca esas tablas ni Storage. |
| Existencias (`inventario`) | Ninguno. |
| 72 compartimientos | Se conservan id, código y relaciones (`codigo` deja de ser generada con `DROP EXPRESSION`, que **retiene los valores**); se añade `tipo = 'compartimiento'`. Guarda inicial: si algún código no coincide con `Cxyz`, la migración aborta sin cambios. |
| Movimientos históricos | Se conservan; reciben columnas nuevas NULL (`codigo_origen`, `codigo_destino`, `solicitud_id`). El Historial V2 los muestra (probado en staging). |
| Usuarios y permisos (Auth, RLS con la cuenta autorizada) | Ninguno sobre Auth; las políticas V1 siguen; V2 añade políticas solo para sus tablas nuevas. |
| Registro de códigos | Se rellena `ubicacion_codigos` con los 72 códigos existentes (backfill verificado en staging: 72/72). |

Bloqueos: los `ALTER TABLE` toman bloqueo exclusivo breve sobre `compartimientos` y `movimientos` (`lock_timeout` 5 s: si hay actividad,
la migración falla limpia y se reintenta). Hacerlo en una ventana sin uso de la app.

### Respaldo previo (obligatorio, verificado antes de migrar)

El plan Free no incluye copias automáticas descargables. Respaldo mínimo, por una persona autorizada y fuera del repositorio:
1. Volcado lógico con `pg_dump` (cliente PostgreSQL 17, gratuito) de los esquemas `public` y `auth` (+ metadatos de `storage`) en formato
   custom, mediante el Session pooler de producción.
2. Descarga de todos los objetos del bucket `product-images` (los archivos no viven en la base).
3. **Verificación:** restaurar el volcado en un PostgreSQL local desechable y comparar recuentos (productos, inventario, movimientos,
   categorías, usuarios) y suma de existencias con producción; comprobar que el número de archivos descargados coincide con
   `storage.objects` del bucket.
4. Anotar los recuentos de referencia: deben coincidir exactamente tras la migración (V2 no cambia ninguno de ellos).

### Compatibilidad temporal con V1

- Las migraciones están diseñadas como expansión: la columna `solicitud_id` admite NULL, así que una app V1 que inserte movimientos sin
  UUID sigue funcionando; los movimientos históricos conservan NULL. **Debe confirmarse en el entorno aislado** que la app V1 desplegada
  funciona con el esquema ya migrado (no se ha podido probar aquí).
- **No aprovisionar cajas mientras V1 siga siendo la app activa:** V1 no conoce `tipo = 'caja'` ni filas con `torre_id` nulo y podría
  mostrarlas o fallar. Aprovisionar solo cuando V2 sea la única app desplegada.
- La app V2 contra una base **sin** la migración de idempotencia falla en entrada, retiro y traslado con un mensaje de incompatibilidad
  (nunca degrada a movimientos sin UUID). Por eso el paso 2 va antes que el 4.
- Más adelante, con V1 retirada, se puede evaluar exigir `solicitud_id` a nivel de base de datos (migración posterior).

## 3. Aprovisionamiento de estantes y cajas

```bash
psql "<conexión administrativa al entorno>" -X -v ON_ERROR_STOP=1 \
  -v confirmo=APROVISIONAR_24_CAJAS \
  -v etiquetas='["<24 etiquetas reales, entre comillas, separadas por comas>"]' \
  -f supabase/provisioning/provision_estantes_cajas.sql
```

- Sin `confirmo` y sin las 24 etiquetas el script **aborta sin cambios**. Rechaza: cantidad distinta de 24, placeholders, duplicadas,
  formato inválido, `C` + dígitos (reservado a torres) y códigos ya reservados.
- Una sola transacción: queda todo (6 estantes, 24 cajas, 96 ubicaciones, 96 códigos registrados) o nada. Una segunda ejecución falla sin
  modificar nada. Las cajas reciben IDs permanentes a continuación de las 72 de torre.
- Verificado únicamente en PostgreSQL desechable con etiquetas ficticias: `tests/provisioning.local.mjs` (6/6).

## 4. Pruebas de humo posteriores al despliegue (cuenta autorizada)

1. Inicio: resúmenes de Torres y Estantes (6 estantes, 24 cajas) y búsqueda global (producto, código actual e histórico).
2. Torres y Estantes: 72 compartimientos y 24 cajas en 2×2; abrir una caja.
3. Catálogo: crear un producto con fotografía (verificar que se ve y que es privada), editar y reemplazar la foto.
4. Carga rápida en una caja: entrada; repetir con la red cortada y comprobar «ya estaba registrado» sin duplicar.
5. Retiro, traslado (torre↔caja) y ajuste físico; el Historial refleja cada movimiento con los códigos correctos.
6. Renombrar una caja: el Historial conserva el código antiguo («actualmente …») y el código antiguo sigue encontrando la caja.
7. Exportaciones CSV, XLSX y PNG (hojas Inventario y Resumen; mapa con 72 + 24).
8. Con un usuario no autorizado o sin sesión: acceso denegado a datos y a fotografías.

## 5. Reversión

- Aplicación: volver al despliegue anterior en Netlify.
- Idempotencia: aditiva; si hiciera falta, `alter table public.movimientos drop constraint movimientos_solicitud_id_key, drop column solicitud_id;`
  (la app V2 dejaría de poder registrar movimientos).
- Aprovisionamiento: **no reversible por diseño**; restaurar el respaldo.

## 6. Validación en Supabase aislado (HECHA en staging, 12-nov-2026)

- 14 migraciones + `seed.sql` + datos ficticios + 6 estantes / 24 cajas `STG-…` aplicados con historial verificado.
- PostgREST + JWT reales (`23505`, `PGRST204`, `PT409`, grants por columna, RLS autorizado/ajeno/anónimo), Storage real y Auth real:
  aceptación 35/35, 39/39, 45/45 y 51/51.
- Compatibilidad V1 sobre el esquema migrado: movimientos sin `solicitud_id` (NULL) probados en las etapas V2 de la aceptación.
- Next real conectado a staging: arrancado localmente (`app-local-staging.ps1`, fuera del repo) y revisado a mano por Nacho.
- Pendiente: humo de interfaz de la app **V1 (`main`)** contra el esquema migrado, si se quiere cubrir la ventana entre migrar la base y
  desplegar V2.

## 7. Pendientes clasificados

| Pendiente | Clase |
|---|---|
| Comprobar Netlify (branch deploys / previews / variables) antes de cualquier push (P1-2) | **BLOQUEANTE** |
| Etiquetas reales de las 24 cajas y ejecución del aprovisionamiento (P1-1) | **BLOQUEANTE** |
| Validación PostgREST/JWT/Storage/Next reales en Supabase aislado (P1-3) y compatibilidad V1 | HECHO en staging (§6) |
| Aplicar `20260930060000` (PT409) en producción: corrige el bucle de reintentos que ya puede afectar a V1 | **BLOQUEANTE** (requiere autorización) |
| Respaldo y ventana de mantenimiento | **BLOQUEANTE** |
| Aprobación humana de referencias visuales V2 (Wally/Gepeto/Nacho) y reglas de diferencias | POSTPRODUCCIÓN |
| Firefox/WebKit en dispositivos reales, lector de pantalla, teclado móvil, zoom | POSTPRODUCCIÓN (recomendado antes de difundir) |
| Fecha UTC en el nombre de los archivos exportados; instantánea de exportación no transaccional | POSTPRODUCCIÓN |
| Fotografías: archivos huérfanos por abandono entre «subir» y «guardar», limpieza solo en memoria, URL firmadas de 1 h | POSTPRODUCCIÓN |
| Exigir `solicitud_id` en la base de datos cuando V1 se retire | POSTPRODUCCIÓN |
| Espera fija de 300 ms en `tests/app-navigation.browser.mjs`; densidad del Historial | POSTPRODUCCIÓN |
