# 01 - Verificación de Netlify antes del primer `git push` de V2 (solo lectura)

**Quién:** Nacho (dueño del sitio en Netlify). **Cuándo:** ANTES de cualquier `git push` de `feat/estantes-cajas-v2` y antes de abrir
ningún Pull Request. **Qué es:** una revisión de solo lectura del panel; no se cambia nada hasta llegar al árbol de decisión (§4).
Este documento no se ha ejecutado: la tabla de §3 está vacía a propósito.

## 1. Por qué es bloqueante

- La rama V2 ya existe en GitHub hasta el commit `6c10bfc`; hay 13 commits locales más sin subir. Si Netlify construye ramas o
  Pull Requests, el siguiente `push` (o abrir un PR) dispara un despliegue automático **sin que nadie lo pida**.
- Las variables `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` se **incrustan en el JavaScript durante el build**. Si
  el contexto de ese despliegue tiene los valores de producción, el sitio de la rama V2 queda conectado al Supabase **productivo**.
- Consecuencias concretas:
  - Base productiva **sin migrar** (estado actual): la app V2 busca `estantes`, `ubicacion_codigos` y `movimientos.solicitud_id`; las
    lecturas fallan y entrada/retiro/traslado se rechazan por incompatibilidad de esquema. **Pero NO es inocuo:** el ajuste
    físico (RPC de V1), crear/editar productos y categorías, y subir/borrar fotografías **sí funcionan** contra la base productiva
    sin migrar y escribirían datos reales. (El runbook `docs/runbook-despliegue-v2.md` §1 lo subestima; prevalece esta nota.)
  - Base **parcialmente migrada** (por ejemplo, ya con idempotencia pero sin aprovisionar, o durante el despliegue real): una vista
    previa antigua o con código intermedio puede **escribir movimientos reales** desde una URL de pruebas que nadie vigila.
  - La URL de un branch deploy/preview es predecible (`<rama>--<sitio>.netlify.app`) y el login de Supabase está abierto a quien
    llegue; solo el UUID autorizado ve datos, pero el riesgo es operar sobre datos reales desde un entorno de pruebas.
- Indicio previo (no prueba): `https://feat-estantes-cajas-v2--inventario-ingeagro-torres.netlify.app/login` devolvió 404. Un 404 también
  ocurre si hubo build fallido, si la rama usa otro nombre de subdominio o si el despliegue se retiró. Solo el panel lo confirma.

## 2. Qué mirar en el panel (https://app.netlify.com)

Los nombres de menú de Netlify cambian de vez en cuando. Si no encuentra el texto exacto, busque el concepto (en negrita) y anote
cómo se llama hoy. Todo es lectura: **no pulse Save, Edit, Stop, Delete ni Unlink**.

### 2.1 Contextos de despliegue

Sitio `inventario-ingeagro-torres` → **Site configuration** → **Build & deploy** → **Continuous deployment** → sección
**Branches and deploy contexts** (puede aparecer pulsando «Configure»; si hay un botón «Edit settings», solo mire, no guarde).

1. **Production branch**: debe ser `main`.
2. **Branch deploys**: valores posibles *None* / *All* / *Let me add individual branches*.
   Anote cuál está elegido. Si es *individual branches*, anote la lista completa de ramas y si aparece `feat/estantes-cajas-v2`.
3. **Deploy Previews**: construcción automática para Pull Requests (opciones del tipo «Any pull request against your production
   branch», «Automatically build deploy previews for all pull requests» o «None/Disable»). Anote la opción vigente.
4. **Build status** (misma página): anote si los builds están «Active» o detenidos. No lo cambie.

### 2.2 Historial real de despliegues

Pestaña **Deploys** del sitio. Use el filtro/selector de contexto (o los chips «Production deploys», «Deploy Previews», «Branch
deploys»; si no hay filtro, mire el origen que muestra cada fila: *Production: main*, *Branch deploy: <rama>*, *Deploy Preview #n*).

- ¿Existe alguna fila de **Branch deploy** o **Deploy Preview**? Anote rama/PR, fecha y estado (*Published*, *Failed*, *Skipped*).
- ¿Hay filas de `feat/estantes-cajas-v2`, aunque estén *Failed*? Un build fallido demuestra que Netlify **sí** escucha esa rama.
- En GitHub (solo lectura), pestaña **Pull requests** del repositorio: anote si hay algún PR abierto o cerrado de la rama V2.

### 2.3 Variables de entorno por contexto

**Site configuration** → **Environment variables** (en UIs antiguas: Build & deploy → Environment).

Para `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, abra el detalle de cada variable y anote:

- **Scopes**: marcados *Builds*, *Functions*, *Runtime* (y cualquier otro). El README exige Builds + Functions/Runtime.
- Modo de valor: «Same value for all deploy contexts» o **«Different value for each deploy context»**.
- Si es por contexto, hay filas **Production**, **Deploy Previews**, **Branch deploys** (y a veces *Local development*). **El valor
  de «Branch deploys» se aplica tanto a las vistas previas como a los branch deploys según la configuración del sitio; compare
  siempre los tres contextos.**
- Comparación **sin copiar valores a ningún sitio**: use el icono del ojo/«Show value» solo en pantalla y anote **«igual a
  producción» / «distinto de producción» / «no definida»**. Para la URL basta comparar los primeros 6-8 caracteres del subdominio
  (`https://abcdefgh…supabase.co`) entre contextos. No pegue valores en chats, issues, commits ni este documento.
- Anote también cualquier **otra** variable (no debería haber más; el README declara solo estas dos). Una `service_role` o una
  contraseña de base de datos sería un hallazgo grave: avisar sin copiarla.

### 2.4 Acceso de visitantes

**Site configuration** → **Access & security** → **Visitor access** (puede llamarse *Password protection* o *Site protection*, y
algunas opciones son de planes de pago; si no existe en el plan Free, anótelo como «no disponible»). Anote si hay protección
configurada para **Deploy Previews / Branch deploys** y si producción está en **Public** (el README exige Public en producción). Esto
no sustituye desactivar los despliegues; solo limita quién puede abrir las URL.

## 3. Tabla de resultados (rellenar y guardar fuera del repositorio si contiene datos sensibles)

| # | Punto | Dónde | Resultado | Fecha/hora |
|---|---|---|---|---|
| 1 | Rama de producción | 2.1 | `main` / otra: ____ | |
| 2 | Branch deploys | 2.1 | None / All / individuales: ____ | |
| 3 | ¿`feat/estantes-cajas-v2` está en la lista? | 2.1 | sí / no / n.a. | |
| 4 | Deploy Previews para PR | 2.1 | opción: ____ | |
| 5 | Builds activos | 2.1 | activos / detenidos | |
| 6 | Filas de Branch deploy en Deploys | 2.2 | ninguna / cuáles: ____ | |
| 7 | Filas de Deploy Preview en Deploys | 2.2 | ninguna / cuáles: ____ | |
| 8 | Filas de la rama V2 (aunque fallidas) | 2.2 | ninguna / estado: ____ | |
| 9 | PR de la rama V2 en GitHub | 2.2 | ninguno / #__ | |
| 10 | URL var.: Scopes | 2.3 | ____ | |
| 11 | URL var.: modo | 2.3 | mismo valor / distinto por contexto | |
| 12 | URL: Branch deploys vs Production | 2.3 | igual / distinto / no definida | |
| 13 | URL: Deploy Previews vs Production | 2.3 | igual / distinto / no definida | |
| 14 | Clave publicable: Branch deploys vs Prod. | 2.3 | igual / distinto / no definida | |
| 15 | Clave publicable: Deploy Previews vs Prod. | 2.3 | igual / distinto / no definida | |
| 16 | Otras variables presentes | 2.3 | ninguna / nombres (sin valores): ____ | |
| 17 | Visitor access de producción | 2.4 | Public / otra / no existe | |
| 18 | Visitor access de previews/branch deploys | 2.4 | ninguna / cuál / no existe | |

## 4. Árbol de decisión

1. **Filas 2, 4, 6, 7 y 8 limpias** (Branch deploys = *None*, previews desactivadas, ningún despliegue no productivo en la lista):
   riesgo bajo. Aun así, tras el primer `push` abra **Deploys** a los 2-5 minutos y confirme que no apareció ningún build nuevo
   distinto de `main`.
2. **Branch deploys = *All*, o la rama V2 está en la lista, o los Deploy Previews están activos**:
   1. Si las variables de esos contextos son **iguales a producción** (filas 12-15) o no se pueden comparar → **acción de Nacho
      antes de cualquier push**: poner *Branch deploys* en **None** y desactivar **Deploy Previews** (Continuous deployment →
      Branches and deploy contexts → Edit settings → Save). Después, repetir la lectura y marcar la tabla.
   2. Si son **distintas** y apuntan a un proyecto que **no** es el productivo (comprobar en el panel de Supabase que ese proyecto no
      contiene los datos reales) → aceptable; documente cuál es. Sigue siendo preferible *None* hasta que exista staging (ver
      `02-supabase-staging.md`).
   3. Si no están definidas → el build fallará o saldrá sin Supabase; riesgo bajo, pero desactívelo igualmente para no ensuciar el
      historial.
3. **Ya existe un branch deploy o preview de la rama V2** (fila 6, 7 u 8 con *Published*): anote su URL y la fecha. Desactivar
   futuros builds **no elimina** lo ya publicado. Si usa las variables de producción, ábralo **sin iniciar sesión** para ver el
   login y no opere en él; elimine ese despliegue desde el panel solo si Netlify lo permite (opción *Delete deploy* en la
   página del despliegue) y cuando Nacho lo decida. Registre el hallazgo en el runbook.
4. **Freno de emergencia** si hay dudas: *Build status* → **Stop builds** detiene TODOS los builds, incluido producción (`main`), y se
   reactiva con **Activate builds**. Úselo solo temporalmente; es una acción de Nacho.
5. **No puede abrir alguna pantalla o los nombres no coinciden** → no continúe: capture la pantalla (sin valores de variables) y
   consulte antes de hacer `push`.

## 5. Configuración recomendada después (opcional, cuando exista staging)

- Variables **por contexto**: *Production* = valores productivos actuales (no tocar); *Branch deploys* y *Deploy Previews* = URL y clave
  **publicable del staging**. Así una vista previa de V2 nunca toca producción y permite la prueba E7 en una URL real.
- Nunca poner `service_role`/«secret key» ni la contraseña de base de datos en Netlify.
- Cambiar variables exige un nuevo build para que se incrusten (los `NEXT_PUBLIC_*` se resuelven en build).
- El repositorio no tiene `netlify.toml` y este trabajo no lo añade: toda esta configuración vive en el panel.

## 6. Resultado

Marque cuando termine: `[ ] Tabla completa  [ ] Árbol aplicado  [ ] Sin despliegues no productivos activos  [ ] Autorizo el push`.
La acción de subir la rama (`git push`) la decide y ejecuta Nacho; ningún agente la realiza.
