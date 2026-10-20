# UI V2 · UI00 y UI01

Base de revisión: `bb2618218ec0acda18be6f5d575c40e502169eb3`, rama `feat/estantes-cajas-v2`. Propuesta R2 aprobada; esta entrega se limita al sistema compartido. No implementa las composiciones de las pantallas ni cambia la convención de ocupación.

## UI00: referencia y contratos

Se verificaron las 86 capturas sintéticas originales contra su manifiesto. Se conservan intactas; sus 22 combinaciones originales ausentes no se consideran completadas por un fixture diferente. Se fijaron huellas de las ocho hojas CSS del commit base y una referencia adicional de componentes reales con datos sintéticos.

La referencia adicional utiliza CSS obtenido mediante `git show` del commit fijo y los mismos componentes/fixture para antes y después. En esta entrega no hay cambios de componentes, modelos o rutas. Sus 120 capturas anteriores están fuera del repositorio; no son snapshots nuevos aprobados para reemplazar B4. Se registra una deficiencia previa: el placeholder oscuro del catálogo alcanzaba 4,263:1 en ocho muestras repetidas. La fase de captura anterior registra esos fallos, sin presentarlos como PASS de contraste.

Invariantes conservadas: enlaces, valores de formulario, identidad de producto/ubicación, pinturas de ocupación, apertura y cierre de diálogos/menús, navegación y ausencia de envíos inesperados. El contador disponible de torre conserva también sus colores específicos. No se modificaron referencias ni aserciones del B4 histórico.

## UI01: cambios deliberados

- `app/theme.css` centraliza paleta y roles compartidos: fondo, superficies, texto, bordes de controles, marca, foco y mensajes. Los tokens operativos `--green`/`--red` y las pinturas Ocupado/Disponible se conservan.
- `app/globals.css` consume la tipografía y los radios compartidos, hereda fuente en textarea/select y define foco de buscador/campos. Títulos compartidos de 32/28 px, cuerpo de 16 px y navegación móvil de 12 px. No cambia orden, rejillas, rutas o breakpoints.
- `app/catalog.css` mantiene sus nombres de variables como alias de los tokens centrales; aplica controles, mensajes, foco, placeholder explícito en ambos temas y estados de botón. Un primario deshabilitado conserva su pintura aunque tenga hover.
- `app/stock.css` adapta únicamente presentación del disparador, radio del diálogo y color del foco. No cambia posicionamiento, top layer, scroll, Escape ni gestión del foco.

Paleta principal claro/oscuro: canvas `#F5F7F6 / #0D1D22`, superficie `#FFFFFF / #162F35`, secundaria `#EAF0EE / #203B42`, texto `#173638 / #ECF3F1`, secundario `#4E6267 / #B3C8C6`. Acción `#176F5D` sobre blanco; hover `#125B4D`, active `#0F4B40`. Foco `#176F5D / #70D8BA`; sobre la barra lateral oscura se usa el foco claro también en tema claro.

Tokens de espacio 4/8/12/16/24/32 px; radios de control/tarjeta/diálogo 8/12/14 px. Se aplican a las reglas compartidas modificadas; se conservan overrides específicos de pantallas para sus próximas subentregas. No se reescriben todas sus dimensiones o geometrías en UI01.

Se preparan duraciones de 160/220 ms para trabajos posteriores. Las transiciones normales existentes no se rediseñan. Con `prefers-reduced-motion: reduce` se reducen animaciones/transiciones y se elimina el scroll animado.

## B4: adaptación aditiva, sin sustituir referencias

`tests/light-contrast.browser.mjs` permanece intacto. Su `after` histórico exige geometría idéntica, pinturas operativas iguales y píxeles oscuros casi idénticos; sus aserciones AA solo cubren claro. No se ejecuta ese comparador para exigir a UI01 simultáneamente nuevos tokens y los antiguos píxeles.

Se añade `tests/ui-foundation.browser.mjs`: contraste de texto/placeholder sobre fondos efectivos rasterizados en **ambos temas**, identidad semántica y pinturas operativas conservadas. Añade foco de controles/buscador, hover/active, deshabilitado, herencia tipográfica y reducción de movimiento. Geometría y PNG se registran para revisión; no se aprueban automáticamente ni se comparan como igualdad exacta de todos los píxeles.

Una comparación solicitada requiere `before.json` y `before-revision.json` válidos y coincidentes con la revisión explícita. Su ausencia produce un error; nunca se transforma silenciosamente en una prueba independiente. El modo `contrast` es independiente y se selecciona expresamente.

Referencias distintas: UI V2 `bb261821`; B4 histórico `8286c39`; exportaciones `04602c9e`. No se cambian las bases históricas de otras pruebas. Una referencia visual V2 futura requiere aprobación explícita por región/estado, fixture, navegador y revisión. No se eliminan pruebas críticas, se actualizan snapshots automáticamente ni se amplían tolerancias para obtener PASS.

## Ejecución de la prueba nueva

Node >=22 y las herramientas externas ya utilizadas: esbuild 0.28.2, Playwright 1.64.0 y Chromium. La lectura PNG utiliza la API interna de Playwright; conservar esas versiones o revisar la importación al actualizar. No se agregan dependencias al proyecto.

```powershell
$env:FOUNDATION_TEST_TOOLS = '<directorio externo de herramientas>'
$env:FOUNDATION_ARTIFACTS = '<directorio externo de evidencias>/foundation'
$env:FOUNDATION_BASE_REF = 'bb2618218ec0acda18be6f5d575c40e502169eb3'
# Solo para preparar explícitamente la referencia anterior con el fixture acordado:
$env:FOUNDATION_PHASE = 'before'
node --test tests/ui-foundation.browser.mjs
# Comparar el código a revisar con esa referencia, sin sobrescribirla:
$env:FOUNDATION_PHASE = 'after'
node --test tests/ui-foundation.browser.mjs
```

La referencia se obtuvo antes de editar estilos. Para reconstruirla en etapas futuras deben conservarse también los componentes/fixture de esta revisión; leer CSS histórico con componentes nuevos no equivale a reconstruir una aplicación histórica completa.

## Validación y límites

- Tests de modelos: 44 PASS; lint y build PASS. Build con URL/key sintéticas de Supabase apuntando a loopback.
- Prueba UI01: 120 capturas por fase, 360/390/768/1280 px, claro/oscuro. Contraste computado, identidades y pinturas operativas: PASS.
- Regresiones existentes de menús, filtro B3 de carga, historial y exportaciones: 21 PASS, incluidos menús en Chromium/Firefox/WebKit y archivos CSV/XLSX/PNG sintéticos.
- Verificación adicional de ficha, carga, historial y exportaciones: 68 comprobaciones de composición/identidad/alcance, sin desbordamientos nuevos frente al mismo CSS base. Formulario a 320×600 alcanzable por scroll.
- Zoom nativo de Chromium al 200 %: diez casos, cinco vistas en ambos temas, viewport CSS de 640 px, DPR 2 y `visualViewport.scale=1`; sin desbordamiento horizontal en esas muestras. No equivale a una validación de zoom solo de texto en todos los motores.

**Problema heredado:** la ficha real de producto a 768 px ocupa 828 px de ancho, tanto antes como después. Se conserva como pendiente de UI05, sin ampliar esta entrega al rediseño de ficha.

Los fixtures no importan servicios productivos y bloquean solicitudes externas. No se confirmó ningún movimiento real ni se ejecutaron migraciones o baterías SQL. El contraste completo en todos los navegadores, lector de pantalla, teclado virtual real y PostgREST/JWT real quedan NO VERIFICADOS. Las capturas de R2 no sustituyen estas validaciones. Evidencias y reporte de ejecución se mantienen fuera del repositorio para la revisión de Gepeto.


# Cierre visual UI V2 (UI02–UI09)

> **Estado:** UI09a cerrado (`d0d8b51`). UI09b prepara herramientas y evidencias de referencias y compatibilidad; **queda pendiente de validación final** y de la aprobación humana de los candidatos. **Este documento no declara V2 lista para producción**: la auditoría independiente preproducción, coordinada por Gepeto, es el siguiente paso.

## Bloques visuales y commits locales

| Bloque | Contenido | Commit |
|---|---|---|
| UI00–UI01 | Referencias, tokens, temas, foco y movimiento reducido | `958096c` |
| UI02 | Confirmación de stock y diálogos | `e8da056` |
| UI03 | Estantes, cajas y códigos completos | `9e5d858` |
| UI04a | Navegación, barra lateral, barra superior y atajo de Exportaciones | `3e2d9ca` |
| UI04b | Inicio con resúmenes independientes de Torres y Estantes | `6c10bfc` |
| UI05a | Catálogo compacto y ficha stock-primero | `8f08fa2` |
| UI05b-1 / UI05b-2 | Estructura de formularios; errores accesibles y fotografías | `195b9dc` / `a049bd5` |
| UI06 | Carga rápida: pasos, foco y flujo quick integrado | `ca0455e` |
| UI07 | Historial: campos separados y códigos históricos/actuales | `7c3c495` |
| UI08 | Exportaciones: estados por formato y ayudas de compatibilidad | `00c4501` |
| UI09a | Legibilidad (≥ 12 px), singular/plural, densidad del Historial | `d0d8b51` |
| UI09b | Comparador de referencias, candidatos V2 y humo multi-motor | pendiente de validación final |

Todos son commits locales de `feat/estantes-cajas-v2`; no se ha hecho push, merge, deploy ni migración.

## Convención de ocupación

**Rojo = Ocupado; verde = Disponible.** No se usa ningún otro significado para esos colores (los tipos de movimiento, los formatos de exportación y los estados de formulario se distinguen por icono, texto y signo). Los estados operativos de ocupación son idénticos al baseline histórico en las 120 capturas de `ui-foundation`.

## Tokens y tipografía

Definidos en `app/theme.css` y consumidos por las hojas de pantalla:
- Texto: `--text-help` 12 px (mínimo de cualquier texto visible, protegido por `tests/css-readability.test.mjs` y `tests/readability.browser.mjs`), `--text-secondary` 14 px, `--text-body` 16 px, títulos 32 px (28 px en móvil).
- Espacio 4/8/12/16/24/32 px (`--space-1…8`); radios 8/12/14 px; fuente de códigos `--font-code`.
- Acción, foco (`--focus-ring`, `--focus-on-dark` sobre fondos oscuros), superficies y mensajes, en claro y oscuro.
- Duraciones 160/220 ms; con `prefers-reduced-motion: reduce` las transiciones y animaciones se reducen a ~0.

## Criterios responsive y de accesibilidad aplicados

- Anchos de comprobación: 320, 360, 390, 768, 1024 y 1280 px, en tema claro y oscuro (los bloques recientes) y 360/390/768/1280 en `ui-foundation`.
- Sin scroll horizontal; contraste de texto ≥ 4,5:1 (3:1 en texto grande y controles) medido sobre fondos efectivos; foco visible ≥ 3:1; objetivos táctiles ≥ 44 px (botones principales 48 px); texto ≥ 12 px.
- Errores asociados al campo (`aria-invalid`/`aria-describedby`), regiones `role="status"` persistentes sin anuncios duplicados, foco restaurado solo si se perdió, listas semánticas (`ul/li`) y `<time datetime>`.
- Singular/plural con `unitsLabel()` (`lib/product-presentation.ts`).

## Comandos de prueba

Node ≥ 22 con esbuild 0.28.2 y Playwright 1.64.0 (Chromium, Firefox y WebKit) instalados fuera del proyecto. Cada suite lee su propia variable de herramientas:

| Suite | Variable de herramientas |
|---|---|
| Mayoría de `tests/*.browser.mjs` | `SHELVES_TEST_TOOLS` |
| `ui-foundation.browser.mjs` | `FOUNDATION_TEST_TOOLS` + `FOUNDATION_ARTIFACTS` (carpeta externa) + `FOUNDATION_PHASE` |
| `stock-action-menu.browser.mjs` | `STOCK_MENU_TEST_TOOLS` |
| `inventory-search.integration.mjs` | `INVENTORY_SEARCH_TEST_TOOLS` |
| `product-form.browser.mjs` | `FORM_TEST_TOOLS` (o `SHELVES_TEST_TOOLS`) |

```powershell
npm test; npm run lint; npx tsc --noEmit
$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:9'; $env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_fake_local_key'; npm run build
$env:SHELVES_TEST_TOOLS='<tools>'; node --test tests/cross-engine.browser.mjs        # Chromium, Firefox y WebKit
$env:FOUNDATION_PHASE='contrast'; node --test tests/ui-foundation.browser.mjs       # PASS esperado
node tests/helpers/foundation-diff.mjs --before <before.json> --after <after.json> --md informe.md
```
Las pruebas usan datos sintéticos y servicios simulados, con el tráfico externo bloqueado; ninguna consulta a Supabase productivo.

## Cobertura real por motor

- **Chromium (Playwright):** todas las suites de navegador.
- **Firefox y WebKit de escritorio (Playwright):** `stock-action-menu` (menús), `stock-confirmation` (diálogos) y `cross-engine.browser.mjs` (Inicio, Catálogo, Carga rápida, Historial y Exportaciones a 390/1280 px, claro/oscuro: sin errores de página, sin desbordamiento, contraste, foco, controles alcanzables, regiones accesibles y movimiento reducido).
- **No verificado:** iPhone/Android reales, Safari/Firefox móviles, lector de pantalla, teclado virtual real, zoom del navegador y PostgREST/JWT aislado. WebKit de escritorio **no** equivale a un iPhone real; el humo multi-motor no sustituye un lector de pantalla.

## Estado de las referencias B4 / `ui-foundation`

- Referencia histórica: `before.json` + `before-revision.json` (commit base `bb26182`, grabada antes de UI01), 120 capturas = 14 escenas × 4 anchos × 2 temas (112) + 2 escenas de navegación móvil (`navigation-hover`, `navigation-focus`) × 2 anchos × 2 temas (8). Nunca se regenera ni se sobrescribe. No existen PNG «before» originales.
- Modo `contrast`: **PASS** (120 capturas, 0 fallos de contraste).
- Fase histórica `after`: **FAIL**, con 112 capturas que difieren en identidad (enlaces/campos/botones). No se declara PASS ni se modifica la referencia para forzarlo.
- Conciliación (`tests/helpers/foundation-diff.mjs` + `tests/fixtures/ui-v2-proposed-differences.json`): las 112 capturas (720 cambios de elemento) se explican con **9 reglas propuestas**, cada una con escenas y elementos exactos, bloque y commit responsable: enlace «Saltar al contenido», entrada «Exportaciones» y atajo de exportación (UI04a, `3e2d9ca`); nuevo texto de las tarjetas del catálogo (UI05a, `8f08fa2`); botón «Crear producto» (UI05b-1, `195b9dc`); «0 unidades» en las 18 cajas disponibles (UI03, `9e5d858`). Las reglas son **propuestas**, no una aprobación individual final.
- Estados operativos de ocupación: comparados por separado en las 120 capturas (la fase histórica aborta antes de comprobarlos cuando falla la identidad): **0 diferencias**.

### Procedimiento de conciliación y aprobación de candidatos V2

1. **Respaldo** de las referencias históricas fuera del repositorio con `SHA256SUMS`, verificado contra los originales.
2. **Candidato:** ejecutar el runner histórico sin modificarlo con `FOUNDATION_PHASE=after` en una carpeta **nueva** que contenga copias de `before.json`/`before-revision.json`; produce `after.json` y las 120 capturas desde el HEAD actual (termina en FAIL por la identidad histórica; ese resultado se conserva). Se registra la procedencia (HEAD, hash del runner, versiones, comando) y los hashes.
3. **Reconstrucción del «antes»:** clon local en `bb26182` + copia sin cambios del runner + `FOUNDATION_PHASE=before` en carpeta nueva; se verifica contra el `before.json` original (identidad, estados operativos y geometría idénticos; algunos hashes de PNG difieren por rasterizado).
4. **Clasificación:** `foundation-diff.mjs` clasifica cada cambio de identidad por captura frente a las reglas propuestas; una diferencia **sin explicar o una diferencia operativa bloquea** el cierre.
5. **Hoja de contacto** antes/después (390 y 1280 px, claro y oscuro) para revisión humana, idealmente con Wally.
6. **Promoción:** requiere autorización independiente de Gepeto/Nacho y acta de revisión visual. Hasta entonces el candidato **no** es referencia oficial y no existe la fase `FOUNDATION_PHASE=v2`.

## Riesgos y pendientes antes de producción (no resueltos)

- Auditoría independiente de arquitectura, seguridad, integración y preparación para producción (Opus 5.5 High, coordinada por Gepeto).
- Integración real aislada PostgREST/JWT y streaming real de Next del dashboard.
- Fotografías: archivos huérfanos, limpieza solo en memoria y URLs firmadas de una hora.
- Exportaciones: la fecha del nombre de archivo es UTC (puede adelantarse un día respecto de la hora de Chile) y la instantánea no es transaccional.
- Límites de error: `app/(workspace)/error.tsx` usa `reset` mientras que Historial y Estantes usan `retry`; revisar el comportamiento esperado.
- Configuración de branch deploys de Netlify antes de cualquier push.
- `tests/app-navigation.browser.mjs` contiene una espera fija de 300 ms.
- Densidad del Historial: 8.894 px con 50 traslados a 390 px (7.302 px antes de UI07) tras UI09a.
- Verificación en dispositivos reales, lector de pantalla, teclado móvil y zoom.
