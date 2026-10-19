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
