# Runbook de despliegue V2 y checklist previo a publicar

Documento operativo. **No se ha ejecutado nada contra producción.** Cada paso lo ejecuta una persona autorizada; este repositorio no
contiene credenciales, URLs de producción ni etiquetas reales de cajas.

## 0. Estado técnico (resumen)

- Rama `feat/estantes-cajas-v2`, solo commits locales (sin push). UI00–UI09, C1, C2a, C2b y el aprovisionamiento están implementados y
  probados con servicios simulados y con **PostgreSQL 17.11 desechable**.
- **No validado** (no hay Docker ni Supabase CLI en este equipo): PostgREST + JWT reales, Storage real, Auth real y Next real conectado a un
  Supabase aislado. Ver §6.

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
`20261014000000_physical_locations_and_code_registry`, `20261014010000_movement_location_code_snapshots`,
`20261014020000_authorized_box_code_rename` y **`20261020000000_movement_request_idempotency`** (columna `solicitud_id` NULL + UNIQUE; sin
`NULLS NOT DISTINCT`; sin transacción propia: la gestiona el mecanismo de migraciones).

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

## 6. Qué falta validar en un Supabase aislado (BLOQUEANTE antes de publicar)

Requiere Docker + Supabase CLI (`supabase start`) o un proyecto Supabase de pruebas **sin datos reales**, con usuarios sintéticos:

- `supabase db reset`/`db push` aplicando las 11 migraciones y `seed.sql`.
- PostgREST + JWT reales: forma real del error `23505`, grant por columna `INSERT (solicitud_id)`, RLS con usuario autorizado, ajeno y anónimo.
- Storage real: subida, lectura firmada (1 h), reemplazo y borrado de fotografías privadas con los límites del bucket.
- Next real conectado a ese stack: Inicio con streaming por sección, catálogo, Carga rápida, Historial y Exportaciones.
- Compatibilidad de la app V1 con el esquema migrado.

## 7. Pendientes clasificados

| Pendiente | Clase |
|---|---|
| Comprobar Netlify (branch deploys / previews / variables) antes de cualquier push (P1-2) | **BLOQUEANTE** |
| Etiquetas reales de las 24 cajas y ejecución del aprovisionamiento (P1-1) | **BLOQUEANTE** |
| Validación PostgREST/JWT/Storage/Next reales en Supabase aislado (P1-3) y compatibilidad V1 | **BLOQUEANTE** |
| Respaldo y ventana de mantenimiento | **BLOQUEANTE** |
| Aprobación humana de referencias visuales V2 (Wally/Gepeto/Nacho) y reglas de diferencias | POSTPRODUCCIÓN |
| Firefox/WebKit en dispositivos reales, lector de pantalla, teclado móvil, zoom | POSTPRODUCCIÓN (recomendado antes de difundir) |
| Fecha UTC en el nombre de los archivos exportados; instantánea de exportación no transaccional | POSTPRODUCCIÓN |
| Fotografías: archivos huérfanos por abandono entre «subir» y «guardar», limpieza solo en memoria, URL firmadas de 1 h | POSTPRODUCCIÓN |
| Exigir `solicitud_id` en la base de datos cuando V1 se retire | POSTPRODUCCIÓN |
| Espera fija de 300 ms en `tests/app-navigation.browser.mjs`; densidad del Historial | POSTPRODUCCIÓN |
