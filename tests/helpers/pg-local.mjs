// Clúster PostgreSQL DESECHABLE para pruebas SQL reales: se crea en Temp, escucha solo en 127.0.0.1 en un puerto libre, nunca
// recibe host/URL/contraseña/directorio externos y se detiene al terminar. Requiere PG_LOCAL_BIN (binarios locales, p. ej. 17.11).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { access, mkdtemp, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const authorized = 'set role authenticated; set "request.jwt.claim.sub"=\'d5211ae5-39c6-4365-ad35-e6f6bdcc8058\';';
const executable = name => path.join(process.env.PG_LOCAL_BIN, name + (process.platform === "win32" ? ".exe" : ""));

export const bootstrap = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
`;
// Estructuras mínimas de plataforma (auth.uid, schema storage) para reproducir TODAS las migraciones. No son datos de producción.
export const databaseBootstrap = `
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

export async function startCluster(t, prefix) {
  assert.ok(process.env.PG_LOCAL_BIN, "Set PG_LOCAL_BIN to portable/local PostgreSQL binaries. No remote fallback.");
  for (const name of ["initdb", "pg_ctl", "postgres", "psql"]) await access(executable(name));
  const directory = await mkdtemp(path.join(tmpdir(), `ingeagro-${prefix}-`));
  const data = path.join(directory, "data");
  const log = path.join(directory, "postgres.log");
  const marker = `ingeagro_${prefix}_` + path.basename(directory).replace(/[^a-zA-Z0-9]/g, "");
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
  // Ejecuta un archivo con variables psql y devuelve estado/salida SIN lanzar: sirve para comprobar fallos esperados.
  const psqlFile = (database, file, vars = {}) => {
    const variables = Object.entries(vars).flatMap(([key, value]) => ["-v", `${key}=${value}`]);
    const result = spawnSync(executable("psql"), [...args(database), ...variables, "-f", path.join(root, file)], { env, encoding: "utf8", windowsHide: true, timeout: 90_000 });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  const stop = () => { if (existsSync(path.join(data, "postmaster.pid"))) run("pg_ctl", ["-D", data, "-w", "-t", "20", "stop", "-m", "fast"]); };
  run("postgres", ["--version"]);
  run("initdb", ["-D", data, "-U", owner, "-A", "trust", "--encoding=UTF8", "--locale=C"]);
  run("pg_ctl", ["-D", data, "-l", log, "-w", "-t", "20", "start", "-o", `-h 127.0.0.1 -p ${port} -c cluster_name=${marker}`]);
  assert.equal(run("psql", args("postgres"), "select current_setting('cluster_name')||'|'||host(inet_server_addr())||'|'||inet_server_port();"), `${marker}|127.0.0.1|${port}`);
  t.diagnostic(`ISOLATED: 127.0.0.1:${port}; cluster=${marker}; artifacts=${directory}`);
  sql("postgres", bootstrap);
  const migrate = async database => {
    sql("postgres", `create database ${database} template template0;`);
    sql(database, databaseBootstrap);
    for (const name of (await readdir(path.join(root, "supabase/migrations"))).filter(file => file.endsWith(".sql")).sort()) await sqlFile(database, "supabase/migrations/" + name);
    await sqlFile(database, "supabase/seed.sql");
  };
  return { run, sql, sqlFile, psqlFile, migrate, stop, directory, port };
}
