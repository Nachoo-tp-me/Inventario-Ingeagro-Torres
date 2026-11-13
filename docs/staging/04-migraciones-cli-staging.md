# 04 - Migraciones del staging con Supabase CLI (propuesta para aprobación)

**Estado (12-nov-2026): SUPERADO por la ejecución real.** Las 14 migraciones se aplicaron en staging con un ejecutor PowerShell guardado
fuera del repositorio (`~\ingeagro-staging-cli\ejecutar-staging.ps1`), que verifica destino y hashes, nunca pone la contraseña en la URI
(la pasa solo por `PGPASSWORD` al proceso hijo), usa `--read-only` con SELECT para las comprobaciones y exige la confirmación interactiva
de la CLI en cada escritura (sin `--yes`). Este documento se conserva como referencia de la propuesta original; **no seguir** su §3 de
construir la URL con la contraseña.

Estado original: propuesta. Sustituye al SQL Editor **solo para las 12 migraciones**; el resto del flujo (etapas, pruebas, marcador)
sigue `02-supabase-staging.md`.

**Objetivo:** aplicar en `ingeagro-v2-staging` primero las 8 migraciones V1, después las V2, con historial correcto en
`supabase_migrations.schema_migrations`, `--dry-run` antes de cada `push`, destino staging explícito, sin Docker/WSL2 y sin tocar
ningún archivo del repositorio.

## 0. Hechos verificados de la CLI (12-nov-2026) y lo que se comprueba al instalar

| Hecho | Fuente | Estado |
|---|---|---|
| Última estable **v3.1.0** (9-nov-2026); asset `supabase_3.1.0_windows_amd64.zip`, SHA-256 `4881f8ee3019d159c7c5f276f90a14918dd8846b796f8c71e0dd8ff7efbe2267`; `checksums.txt` en la release | API pública de GitHub releases | Verificado |
| `db push`: por defecto apunta a la base **local**; remoto con `--remote=<ref\|branch\|url>`; `--dry-run` = «Print the migrations that would be applied, but don't actually apply them»; tras aplicar cada migración inserta una fila en el historial | Referencia CLI (supabase.com/docs/reference/cli) | Verificado |
| `--db-url`/`--linked` siguen funcionando en v3 pero se eliminan en v4: **no se usan** | Referencia `migration list` | Verificado |
| `--workdir`: «used exactly as given, with no ancestor directory search» | Flags globales | Verificado |
| Remoto pide confirmación (por defecto No) salvo `--yes`/`SUPABASE_YES` | Referencia `db push`/`db query` | Verificado |
| `db query [sql] -f <archivo> --read-only -o json\|table\|csv --remote=…`; `--read-only` usa una transacción que siempre se revierte | Referencia `db query` | Verificado |
| URL con caracteres reservados escapados (RFC 3986) | Referencia `migration list` y guía de conexión | Verificado |
| Plan Free: conexión directa solo IPv6; **session pooler** (puerto 5432) IPv4: `postgresql://postgres.<ref>:<pw>@aws-N-<region>.pooler.supabase.com:5432/postgres`; el host se copia del diálogo **Connect** | Guía «Connecting to Postgres» | Verificado |
| `db push`/`db query`/`migration list` **no requieren Docker** | Solo `db pull` lo menciona | **A comprobar** (paso 1.4) |
| Si cada migración va en su propia transacción | — | **No confirmado** (mitigado: staging vacío y desechable) |
| Si exige `supabase/config.toml` en el workdir con `--remote=<url>` | — | **No confirmado** (se crea uno mínimo, §2) |
| Columnas de `schema_migrations` | — | No hace falta: lo gestiona la CLI |

## 1. Instalar la CLI sin instalador, sin admin y sin tocar PATH (requiere tu aprobación: descarga)

```powershell
$CLI_DIR = "$env:USERPROFILE\tools\supabase-cli\3.1.0"
New-Item -ItemType Directory -Force $CLI_DIR | Out-Null
$zip = "$CLI_DIR\supabase_3.1.0_windows_amd64.zip"
Invoke-WebRequest 'https://github.com/supabase/cli/releases/download/v3.1.0/supabase_3.1.0_windows_amd64.zip' -OutFile $zip
# 1.1 Integridad: debe coincidir EXACTAMENTE (y con la línea del zip en checksums.txt de la release)
(Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -eq '4881f8ee3019d159c7c5f276f90a14918dd8846b796f8c71e0dd8ff7efbe2267'
Expand-Archive $zip -DestinationPath $CLI_DIR -Force
$SB = "$CLI_DIR\supabase.exe"          # se invoca siempre con ruta completa: no se modifica PATH
# 1.2 Versión
& $SB --version                          # esperado: 3.1.0
# 1.3 Comandos y flags realmente disponibles (copiar la salida al informe)
& $SB db push --help                     # debe listar --dry-run, --remote, --include-all, --include-seed
& $SB migration list --help              # debe listar --remote
& $SB db query --help                    # debe listar -f/--file, --read-only, -o, --remote
```

1.4 **Criterio de parada:** si el hash no coincide, si falta alguna flag, o si en cualquier momento un comando pide Docker, **detenerse**
y avisar. No se instala Docker ni WSL2, y no se usa `npx` (este equipo no tiene `npm`).

## 2. Directorio de trabajo aislado (fuera del repo, sin heredar `config.toml`)

El `supabase/config.toml` del repositorio declara `site_url` y redirecciones de **producción**. No se usa: se trabaja en una carpeta
propia con un `config.toml` mínimo **sin** sección `[auth]` y con la semilla desactivada, y siempre con `--workdir` explícito (sin
búsqueda hacia directorios superiores).

```powershell
$REPO = "$env:USERPROFILE\Desktop\Inventario-Ingeagro-Torres"
$WS   = "$env:USERPROFILE\ingeagro-staging-cli"          # fuera del repo
New-Item -ItemType Directory -Force "$WS\supabase\migrations", "$WS\sql" | Out-Null
Set-Content -Encoding ascii "$WS\supabase\config.toml" @'
# Config minima SOLO para aplicar migraciones al staging. Sin [auth]: no se hereda nada de produccion.
project_id = "ingeagro-v2-staging"
[db.seed]
enabled = false
'@
```

`Set-Location` **no** se cambia al repo para ejecutar la CLI. No se ejecuta nunca `supabase init`, `link`, `config push`, `db reset`,
`db pull`, ni `--include-all`/`--include-seed`/`--include-roles`/`--debug`/`--yes`.

## 3. Destino staging explícito y guardas (cada sesión de PowerShell)

```powershell
$REF      = '<Reference ID de ingeagro-v2-staging>'   # 20 caracteres a-z0-9
$REF_PROD = '<Reference ID de PRODUCCIÓN>'            # no es secreto; solo para bloquearlo
if ($REF -notmatch '^[a-z0-9]{20}$' -or $REF_PROD -notmatch '^[a-z0-9]{20}$' -or $REF -eq $REF_PROD) { throw 'REF inválida o igual a producción' }
$POOLER = Read-Host 'Host del session pooler del STAGING (Connect > Session pooler)'
if ($POOLER -notmatch '^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$') { throw 'Host de pooler inválido' }
$pw = [Net.NetworkCredential]::new('', (Read-Host 'Contraseña de BD del STAGING' -AsSecureString)).Password
$env:STG_DB_URL = "postgresql://postgres.$($REF):$([uri]::EscapeDataString($pw))@$($POOLER):5432/postgres"
Remove-Variable pw
function Assert-Staging {
  if ($env:STG_DB_URL -notmatch "^postgresql://postgres\.$($REF):" -or $env:STG_DB_URL -match $REF_PROD) { throw 'El destino NO es el staging' }
}
function Stg { Assert-Staging; & $SB --workdir $WS @args "--remote=$env:STG_DB_URL" }   # todos los comandos remotos pasan por aquí
function Assert-CopiasIntactas {
  if (git -C $REPO status --porcelain -- supabase/migrations) { throw 'supabase/migrations del repo tiene cambios' }
  foreach ($f in Get-ChildItem "$WS\supabase\migrations\*.sql") {
    if ((Get-FileHash $f).Hash -ne (Get-FileHash "$REPO\supabase\migrations\$($f.Name)").Hash) { throw "Copia distinta del repo: $($f.Name)" }
  }
}
```

La contraseña solo vive en `$env:STG_DB_URL` de esta ventana (no se escribe en archivos ni en el historial: el comando contiene el
nombre de la variable, no su valor). Al terminar: `Remove-Item Env:STG_DB_URL`. No usar `--debug` (podría registrar la URL).

## 4. Fase V1: solo las 8 migraciones V1

```powershell
# 4.1 Guarda de proyecto vacío (producción tiene tablas: aquí abortaría). Esperado: 0
Stg db query --read-only -o csv "select count(*) as tablas_public from pg_tables where schemaname = 'public'"
# 4.2 Copiar SOLO V1 (copias; los originales no se tocan) y comprobar que son idénticas
$V1 = '20260929000000_initial_inventory_schema', '20260929010000_harden_inventory_permissions',
      '20260930000000_shared_account_read_access', '20260930010000_limit_dashboard_read_access',
      '20260930020000_shared_account_category_read', '20260930030000_product_catalog_and_private_images',
      '20260930040000_limit_catalog_write_columns', '20260930050000_transactional_stock_operations'
$V1 | ForEach-Object { Copy-Item "$REPO\supabase\migrations\$_.sql" "$WS\supabase\migrations\" }
(Get-ChildItem "$WS\supabase\migrations\*.sql").Count      # esperado: 8
Assert-CopiasIntactas
# 4.3 Historial y simulación
Stg migration list                 # esperado: 8 en Local, ninguna en Remote
Stg db push --dry-run              # esperado: exactamente las 8 V1, en orden; nada más
# 4.4 Aplicar (responder «y» al prompt solo si el dry-run fue exactamente el esperado)
Stg db push
Stg migration list                 # esperado: 8 Local = 8 Remote, mismas versiones
Stg db query --read-only -o table "select version, name from supabase_migrations.schema_migrations order by version"
```

Si `db push` falla a mitad: **no** reintentar ni usar `migration repair`; anotar el error y recrear el proyecto staging (la atomicidad
por migración no está confirmada; en un staging vacío recrear es lo seguro).

## 5. Datos (no son migraciones: no entran en el historial)

Se ejecutan con `db query -f` sobre **copias** en `$WS\sql\`. A3, A4 y el aprovisionamiento son un único bloque `DO` (atómicos por sí
mismos); `seed.sql` es idempotente (`on conflict do nothing`).

```powershell
Copy-Item "$REPO\supabase\seed.sql", "$REPO\supabase\staging\01_datos_sinteticos_v1.sql" "$WS\sql\"
# Los .sql son UTF-8 SIN BOM con tildes: en PowerShell 5.1 Get-Content/Set-Content los corromperían (ANSI al leer, BOM al
# escribir). Se usan estas dos funciones para las copias editadas:
$UTF8 = [Text.UTF8Encoding]::new($false)
function LeerUtf8($p) { [IO.File]::ReadAllText($p, $UTF8) }
function EscribirUtf8($p, $t) { [IO.File]::WriteAllText($p, $t, $UTF8) }
# Sustituye EXACTAMENTE una línea de asignación (no toca comentarios); falla si no la encuentra una sola vez.
function Asignar($texto, $antes, $despues) {
  $n = ([regex]::Matches($texto, [regex]::Escape($antes))).Count
  if ($n -ne 1) { throw "Se esperaba exactamente 1 aparición de: $antes (hay $n)" }
  $texto.Replace($antes, $despues)
}
$m = LeerUtf8 "$REPO\supabase\staging\00_marcador_staging.sql"
$m = Asignar $m "v_ref constant text := '__REF_STAGING__';" "v_ref constant text := '$REF';"
EscribirUtf8 "$WS\sql\00_marcador_staging.sql" $m       # copia editada; el original queda intacto
Stg db query -f "$WS\sql\seed.sql"                     # 3 torres -> 72 compartimientos
Stg db query -f "$WS\sql\00_marcador_staging.sql"      # debe mostrar la fila del marcador con project_ref = $REF
Stg db query -f "$WS\sql\01_datos_sinteticos_v1.sql"   # debe mostrar P1 C111=7, C112=3; P2 C211=4; P3 sin stock
Stg db query "notify pgrst, 'reload schema'"
# Desde aquí, guarda adicional antes de cada push: el marcador debe existir y coincidir
function Assert-Marcador {
  $csv = Stg db query --read-only -o csv "select project_ref from public.entorno_staging where id = 1 and nombre = 'ingeagro-v2-staging'"
  if (-not ($csv -match "^$($REF)$")) { throw 'Marcador de staging ausente o distinto: NO continuar' }
}
Assert-Marcador
```

Luego, verificación V1 según `02-supabase-staging.md` §4 fase 1 (consultas con `Stg db query --read-only -o table "<consulta>"`),
usuarios (A5) y pruebas `STAGING_ETAPA=v1` + app `main` local (E0/E1). **No seguir si algo falla.**

## 6. Fase V2: las 4 migraciones, en dos tandas (3 + 1)

Se aplican en dos tandas para conservar la prueba E2 (PGRST204 real sin la columna `solicitud_id`). El historial final es idéntico al
de una sola tanda. Si se prefiere una sola tanda, copiar las 4 juntas y omitir E2.

```powershell
# 6.1 Tanda 1: tres migraciones de ubicaciones
Assert-Marcador
'20261014000000_physical_locations_and_code_registry', '20261014010000_movement_location_code_snapshots',
'20261014020000_authorized_box_code_rename' | ForEach-Object { Copy-Item "$REPO\supabase\migrations\$_.sql" "$WS\supabase\migrations\" }
Assert-CopiasIntactas
Stg db push --dry-run              # esperado: exactamente las 3 nuevas (NO las V1)
Stg db push
Stg migration list                 # esperado: 11 Local = 11 Remote
Stg db query "notify pgrst, 'reload schema'"
# -> verificación fase 2 de 02-supabase-staging.md y pruebas STAGING_ETAPA=v2-sin-idempotencia (E2)

# 6.2 Tanda 2: idempotencia
Assert-Marcador
Copy-Item "$REPO\supabase\migrations\20261020000000_movement_request_idempotency.sql" "$WS\supabase\migrations\"
Assert-CopiasIntactas
Stg db push --dry-run              # esperado: exactamente 1 (20261020000000)
Stg db push
Stg migration list                 # esperado: 12 Local = 12 Remote
Stg db query "notify pgrst, 'reload schema'"
# -> verificación fase 3 y pruebas STAGING_ETAPA=v2 (E3–E5)
```

## 7. Aprovisionamiento ficticio (no es migración)

```powershell
Assert-Marcador
# Copia editada del script SOLO STAGING: ref, confirmación y 24 etiquetas STG-E<estante>-P<posición>
$labels = (1..6 | ForEach-Object { $e = $_; 1..4 | ForEach-Object { '"STG-E{0}-P{1}"' -f $e, $_ } }) -join ', '
$sql = LeerUtf8 "$REPO\supabase\staging\02_aprovisionamiento_ficticio_staging.sql"     # funciones de §5
$sql = Asignar $sql "v_ref_esperada constant text := '__REF_STAGING__';" "v_ref_esperada constant text := '$REF';"
$sql = Asignar $sql "v_confirmo text := 'NO_CONFIRMADO';" "v_confirmo text := 'APROVISIONAR_24_CAJAS';"
if (([regex]::Matches($sql, "(?s)v_etiquetas text := '\[.*?\]';")).Count -ne 1) { throw 'Bloque de etiquetas no encontrado' }
$sql = [regex]::Replace($sql, "(?s)v_etiquetas text := '\[.*?\]';", "v_etiquetas text := '[$labels]';")
if ($sql -match '"__COMPLETAR__"') { throw 'Quedan etiquetas sin completar' }
EscribirUtf8 "$WS\sql\02_aprovisionamiento.sql" $sql
Stg db query -f "$WS\sql\02_aprovisionamiento.sql"     # esperado: 6 | 24 | 96 | 96
Stg migration list                                      # sigue en 12 = 12 (el aprovisionamiento no toca el historial)
```

Después: pruebas `STAGING_ETAPA=v2-aprovisionado` (E6) y humo UI (E7).

## 8. Historial correcto: qué se garantiza

- Las versiones registradas son los timestamps de los nombres de archivo del repo (copias byte a byte, comprobadas con hash), así que el
  historial del staging es directamente comparable con el de producción más adelante.
- Cada `push` va precedido de `--dry-run` y seguido de `migration list` y de la consulta a `schema_migrations`; se guardan las salidas
  (sin la URL) en `docs/staging/03-resultados.md`.
- Ningún script de datos entra en el historial; ninguna migración se aplica fuera de `db push`.

## 9. Riesgos residuales

1. Atomicidad por migración en `db push` no confirmada → mitigado: staging vacío; ante fallo se recrea.
2. Formato exacto de `-o csv` no confirmado → `Assert-Marcador` se ajusta tras la primera lectura (solo lectura) si difiere; si no
   puede confirmarse, comprobar el marcador visualmente con `-o table` antes de cada push.
3. `--remote=<url>` pone la URL (con contraseña) en la línea de comandos del proceso local mientras dura; no queda en archivos ni en el
   historial de PowerShell. Alternativa sin contraseña en argumentos: `link` + `SUPABASE_DB_PASSWORD`, pero escribe estado de enlace y
   requiere token de acceso; se descarta para staging.
4. Para **producción** este procedimiento no sirve tal cual (allí V1 puede no constar en el historial): se decidirá después con
   `migration list` en solo lectura.
