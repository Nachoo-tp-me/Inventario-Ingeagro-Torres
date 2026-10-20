// C2b: idempotencia de movimientos en PostgreSQL REAL desechable, incluida la concurrencia entre sesiones.
// Requisitos: Node >=22 y binarios PostgreSQL (probado con 17.11). PG_LOCAL_BIN apunta al directorio de initdb, pg_ctl,
// postgres y psql. PowerShell: $env:PG_LOCAL_BIN='<tools>\pgsql\bin'; node --test tests/movement-idempotency.local.mjs
// Crea su propio clúster en Temp (127.0.0.1, puerto libre), aplica TODAS las migraciones y seed.sql, y lo detiene al terminar.
// No lee .env ni acepta host, URL, contraseña o directorio de datos externos. Sin PostgREST/JWT: la identidad se simula con
// el claim de sesión (lo que PostgREST/JWT real se validará después con Supabase CLI aislado).
import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { access, mkdtemp, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const executable = name => path.join(process.env.PG_LOCAL_BIN, name + (process.platform === "win32" ? ".exe" : ""));
const authorized = 'set role authenticated; set "request.jwt.claim.sub"=\'d5211ae5-39c6-4365-ad35-e6f6bdcc8058\';';
const bootstrap = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
`;
const databaseBootstrap = `
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,
  file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
alter default privileges in schema public grant all on tables to anon,authenticated;
alter default privileges in schema public grant all on sequences to anon,authenticated;
`;

test("C2b: solicitud_id UNIQUE en PostgreSQL desechable (casos SQL y concurrencia)", async t => {
  assert.ok(process.env.PG_LOCAL_BIN, "Set PG_LOCAL_BIN to portable/local PostgreSQL binaries. No remote fallback.");
  for (const name of ["initdb", "pg_ctl", "postgres", "psql"]) await access(executable(name));
  const directory = await mkdtemp(path.join(tmpdir(), "ingeagro-idempotency-sql-"));
  const data = path.join(directory, "data");
  const log = path.join(directory, "postgres.log");
  const marker = "ingeagro_idem_" + path.basename(directory).replace(/[^a-zA-Z0-9]/g, "");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^PG/i.test(key) || /SUPABASE/i.test(key) || /^PATH$/i.test(key)) delete env[key];
  env.PATH = process.env.PG_LOCAL_BIN + path.delimiter + (process.env.PATH ?? process.env.Path ?? "");
  env.PGCLIENTENCODING = "UTF8";
  const run = (name, args, input) => {
    const result = spawnSync(executable(name), args, { env, input, encoding: "utf8", windowsHide: true, stdio: name === "pg_ctl" ? "ignore" : "pipe", timeout: 90_000 });
    assert.equal(result.error, undefined, `${name} process error; artifacts: ${directory}`);
    assert.equal(result.status, 0, `${name} failed: ${result.error?.message ?? ""}\n${result.stderr}\n${result.stdout}`);
    return (result.stdout ?? "").trim();
  };
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const owner = "ingeagro_test_owner";
  const args = database => ["-X", "-qAt", "-h", "127.0.0.1", "-p", String(port), "-U", owner, "-d", database, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
  const sql = (database, input) => run("psql", args(database), input);
  const sqlFile = async (database, file) => sql(database, await readFile(path.join(root, file), "utf8"));
  const sqlAsync = (database, input) => new Promise(resolve => {
    const child = spawn(executable("psql"), args(database), { env, windowsHide: true, stdio: "pipe" });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => { stderr += error.message; });
    child.on("close", status => resolve({ status, stdout, stderr }));
    child.stdin.end("set statement_timeout='20s';\n" + input);
  });
  const untilLocked = async (database, key) => {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      if (sql(database, `select exists(select 1 from pg_locks where locktype='advisory' and objid=${key} and granted);`) === "t") return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Concurrent transaction did not reach its lock barrier.");
  };
  // La primera sesión ejecuta su sentencia, retiene la transacción 0,6 s y termina con `ending`; la segunda arranca mientras tanto.
  const overlap = async (database, first, second, key, { ending = "commit", expectedSecondStatus = 0 } = {}) => {
    const pending = sqlAsync(database, `begin; ${first}; select pg_advisory_xact_lock(${key}); select pg_sleep(0.6); ${ending};`);
    await untilLocked(database, key);
    const next = sqlAsync(database, second);
    const [a, b] = await Promise.all([pending, next]);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(b.status, expectedSecondStatus, b.stderr);
    return { first: a, second: b };
  };

  try {
    t.diagnostic(run("postgres", ["--version"]));
    run("initdb", ["-D", data, "-U", owner, "-A", "trust", "--encoding=UTF8", "--locale=C"]);
    run("pg_ctl", ["-D", data, "-l", log, "-w", "-t", "20", "start", "-o", `-h 127.0.0.1 -p ${port} -c cluster_name=${marker}`]);
    assert.equal(sql("postgres", "select current_setting('cluster_name')||'|'||host(inet_server_addr())||'|'||inet_server_port();"), `${marker}|127.0.0.1|${port}`);
    t.diagnostic(`ISOLATED: 127.0.0.1:${port}; cluster=${marker}; artifacts=${directory}`);
    sql("postgres", bootstrap);
    const migrations = (await readdir(path.join(root, "supabase/migrations"))).filter(name => name.endsWith(".sql")).sort();
    assert.ok(migrations.includes("20261020000000_movement_request_idempotency.sql"));
    sql("postgres", "create database idem template template0;");
    const database = "idem";
    sql(database, databaseBootstrap);
    // Migración sin BEGIN/COMMIT propios ni SET LOCAL: su transacción la gestiona el mecanismo de migraciones.
    const migrationSource = await readFile(path.join(root, "supabase/migrations/20261020000000_movement_request_idempotency.sql"), "utf8");
    assert.doesNotMatch(migrationSource.replace(/--.*$/gm, ""), /\b(begin|commit|set\s+local)\b/i);
    assert.doesNotMatch(migrationSource.replace(/--.*$/gm, ""), /nulls\s+not\s+distinct/i);
    for (const migration of migrations) await sqlFile(database, "supabase/migrations/" + migration);
    await sqlFile(database, "supabase/seed.sql");

    await t.test("casos SQL: movimientos y saldos", async () => {
      const output = await sqlFile(database, "tests/movement-idempotency.sql");
      const passes = output.split(/\r?\n/).filter(line => line.startsWith("PASS "));
      assert.equal(passes.length, 4, output);
      t.diagnostic(passes.join("\n"));
    });

    const box = code => `(select id from public.compartimientos where codigo='${code}')`;
    const product = suffix => "00000000-0000-0000-0000-" + String(suffix).padStart(12, "0");
    const addProduct = suffix => sql(database, `insert into public.productos(id,nombre,categoria_id) values('${product(suffix)}','TEST IDEMPOTENCIA ${suffix}',(select id from public.categorias where nombre='Otros'));`);
    const uuid = digit => `${String(digit).repeat(8)}-${String(digit).repeat(4)}-4${String(digit).repeat(3)}-8${String(digit).repeat(3)}-${String(digit).repeat(12)}`;
    const entry = (p, id, quantity, to) => `${authorized} insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,destino_compartimiento_id) values('${id}','${product(p)}','entrada',${quantity},${to})`;
    const withdrawal = (p, id, quantity, from) => `${authorized} insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,origen_compartimiento_id) values('${id}','${product(p)}','retiro',${quantity},${from})`;
    const stock = p => sql(database, `select coalesce(sum(cantidad),0) from public.inventario where producto_id='${product(p)}';`);
    const movements = (p, id) => sql(database, `select count(*) from public.movimientos where producto_id='${product(p)}'${id ? ` and solicitud_id='${id}'` : ""};`);

    await t.test("dos INSERT concurrentes con el mismo UUID: uno gana, el otro espera y falla; un movimiento y un solo cambio de stock", async () => {
      addProduct(401);
      const { second } = await overlap(database, entry(401, uuid(1), 5, box("C111")), entry(401, uuid(1), 5, box("C111")), 75001, { expectedSecondStatus: 3 });
      assert.match(second.stderr, /23505/); assert.match(second.stderr, /movimientos_solicitud_id_key/);
      assert.equal(movements(401, uuid(1)), "1"); assert.equal(stock(401), "5", "el stock se aplicó una sola vez");
    });

    await t.test("dos retiros concurrentes con el mismo UUID: el duplicado falla por 23505 (no 23514) y el saldo no se descuenta dos veces", async () => {
      addProduct(402);
      sql(database, entry(402, uuid(2), 5, box("C111")));
      const { second } = await overlap(database, withdrawal(402, uuid(3), 4, box("C111")), withdrawal(402, uuid(3), 4, box("C111")), 75002, { expectedSecondStatus: 3 });
      assert.match(second.stderr, /23505/); assert.equal(movements(402, uuid(3)), "1"); assert.equal(stock(402), "1");
    });

    await t.test("dos retiros concurrentes con UUID distintos: sigue valiendo el control de stock (23514), sin saldo negativo", async () => {
      addProduct(403);
      sql(database, entry(403, uuid(4), 5, box("C111")));
      const { second } = await overlap(database, withdrawal(403, uuid(5), 4, box("C111")), withdrawal(403, uuid(6), 4, box("C111")), 75003, { expectedSecondStatus: 3 });
      assert.match(second.stderr, /23514/); assert.equal(stock(403), "1"); assert.equal(movements(403, uuid(6)), "0", "el UUID del intento fallido no quedó consumido");
      sql(database, withdrawal(403, uuid(6), 1, box("C111"))); // mismo UUID del intento fallido, ahora válido
      assert.equal(stock(403), "0"); assert.equal(movements(403, uuid(6)), "1");
    });

    await t.test("primer intento revertido y segundo con el mismo UUID en espera: el segundo se aplica una sola vez", async () => {
      addProduct(404);
      const { second } = await overlap(database, entry(404, uuid(7), 8, box("C111")), entry(404, uuid(7), 8, box("C111")), 75004, { ending: "rollback" });
      assert.equal(second.status, 0);
      assert.equal(movements(404, uuid(7)), "1"); assert.equal(stock(404), "8", "ni cero ni doble aplicación");
    });

    await t.test("misma solicitud con parámetros distintos en paralelo: gana una sola y la otra no cambia el stock", async () => {
      addProduct(405);
      const { second } = await overlap(database, entry(405, uuid(8), 5, box("C111")), entry(405, uuid(8), 9, box("C112")), 75005, { expectedSecondStatus: 3 });
      assert.match(second.stderr, /23505/);
      assert.equal(sql(database, `select cantidad||'@'||destino_compartimiento_id from public.movimientos where solicitud_id='${uuid(8)}';`), `5@${sql(database, "select id from public.compartimientos where codigo='C111';")}`);
      assert.equal(stock(405), "5");
    });

    await t.test("traslado repetido con el mismo UUID: una fila, origen y destino aplicados una vez", async () => {
      addProduct(406);
      sql(database, entry(406, uuid(9), 6, box("C111")));
      const once = `${authorized} insert into public.movimientos(solicitud_id,producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${product(406)}','traslado',4,${box("C111")},${box("C112")})`;
      sql(database, once);
      const again = await sqlAsync(database, once); assert.equal(again.status, 3); assert.match(again.stderr, /23505/);
      assert.equal(sql(database, `select cantidad from public.inventario where producto_id='${product(406)}' and compartimiento_id=${box("C111")};`), "2");
      assert.equal(sql(database, `select cantidad from public.inventario where producto_id='${product(406)}' and compartimiento_id=${box("C112")};`), "4");
      assert.equal(stock(406), "6", "conservación total"); assert.equal(movements(406, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), "1");
    });
  } finally {
    // Solo la carpeta privada creada arriba; nunca pg_ctl contra PGDATA externo.
    if (existsSync(path.join(data, "postmaster.pid"))) run("pg_ctl", ["-D", data, "-w", "-t", "20", "stop", "-m", "fast"]);
  }
});
