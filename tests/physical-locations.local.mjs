// SQL REAL en un clúster creado por este runner, nunca en una URL existente.
// Requisitos: Node >=22 y binarios PostgreSQL (probado con 17.11).
// PG_LOCAL_BIN apunta al directorio de initdb, pg_ctl, postgres y psql.
// PowerShell: $env:PG_LOCAL_BIN='<tools>\pgsql\bin'
// node --test tests/physical-locations.local.mjs
// No lee .env ni acepta host, URL, contraseña o directorio de datos externo.
// Conserva logs/datos sintéticos en Temp para revisión y detiene el servidor.
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
-- Estructuras mínimas de plataforma para reproducir TODAS las migraciones
-- existentes, incluidas las políticas de Storage. No son datos de producción.
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,
  file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
-- Simular defaults amplios de Supabase: las migraciones deben revocarlos.
alter default privileges in schema public grant all on tables to anon,authenticated;
alter default privileges in schema public grant all on sequences to anon,authenticated;
`;

test("Bloques 1/2/4: migraciones, stock, códigos, RLS y concurrencia en PostgreSQL desechable", async t => {
  assert.ok(process.env.PG_LOCAL_BIN, "Set PG_LOCAL_BIN to portable/local PostgreSQL binaries. No remote fallback.");
  for (const name of ["initdb", "pg_ctl", "postgres", "psql"]) await access(executable(name));
  const directory = await mkdtemp(path.join(tmpdir(), "ingeagro-locations-sql-"));
  const data = path.join(directory, "data");
  const log = path.join(directory, "postgres.log");
  const marker = "ingeagro_local_" + path.basename(directory).replace(/[^a-zA-Z0-9]/g, "");
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^PG/i.test(key) || /SUPABASE/i.test(key) || /^PATH$/i.test(key)) delete env[key];
  }
  env.PATH = process.env.PG_LOCAL_BIN + path.delimiter + (process.env.PATH ?? process.env.Path ?? "");
  env.PGCLIENTENCODING = "UTF8";
  const run = (name, args, input) => {
    // En Windows, el daemon puede heredar pipes de pg_ctl y mantenerlos abiertos
    // después de salir pg_ctl. Su salida va al logfile, no a pipes del runner.
    const result = spawnSync(executable(name), args, { env, input, encoding: "utf8", windowsHide: true,
      stdio: name === "pg_ctl" ? "ignore" : "pipe", timeout: 90_000 });
    assert.equal(result.error, undefined, `${name} process error; artifacts: ${directory}`);
    assert.equal(result.status, 0, `${name} failed: ${result.error?.message ?? ""}\n${result.stderr}\n${result.stdout}`);
    return (result.stdout ?? "").trim();
  };
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const owner = "ingeagro_test_owner";
  const args = database => ["-X", "-qAt", "-h", "127.0.0.1", "-p", String(port), "-U", owner,
    "-d", database, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
  const sql = (database, input) => run("psql", args(database), input);
  const sqlFile = async (database, file) => sql(database, await readFile(path.join(root, file), "utf8"));
  const summary = output => output.split(/\r?\n/).filter(line => line.startsWith("PASS ")).join("\n");
  const sqlAsync = (database, input) => new Promise(resolve => {
    const child = spawn(executable("psql"), args(database), { env, windowsHide: true, stdio: "pipe" });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => { stderr += error.message; });
    child.on("close", status => resolve({ status, stdout, stderr }));
    child.stdin.end("set statement_timeout='10s';\n" + input);
  });
  const untilLocked = async (database, key) => {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      if (sql(database, `select exists(select 1 from pg_locks where locktype='advisory' and objid=${key} and granted);`) === "t") return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Concurrent transaction did not reach its lock barrier.");
  };
  const overlap = async (database, first, second, key, expectedSecondStatus = 0) => {
    const pending = sqlAsync(database, `begin; ${first}; select pg_advisory_xact_lock(${key}); select pg_sleep(0.6); commit;`);
    await untilLocked(database, key);
    const next = sqlAsync(database, second);
    const [a, b] = await Promise.all([pending, next]);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(b.status, expectedSecondStatus, b.stderr);
    return b;
  };

  try {
    t.diagnostic(run("postgres", ["--version"]));
    run("initdb", ["-D", data, "-U", owner, "-A", "trust", "--encoding=UTF8", "--locale=C"]);
    run("pg_ctl", ["-D", data, "-l", log, "-w", "-t", "20", "start", "-o",
      `-h 127.0.0.1 -p ${port} -c cluster_name=${marker}`]);
    // Comprobar identidad del servidor ANTES de cualquier SQL de esquema.
    assert.equal(sql("postgres", "select current_setting('cluster_name')||'|'||host(inet_server_addr())||'|'||inet_server_port();"), `${marker}|127.0.0.1|${port}`);
    assert.equal(sql("postgres", "select current_setting('data_directory');").replaceAll("\\", "/").toLowerCase(), data.replaceAll("\\", "/").toLowerCase());
    t.diagnostic(`ISOLATED: 127.0.0.1:${port}; cluster=${marker}; artifacts=${directory}`);
    sql("postgres", bootstrap);
    const migrations = (await readdir(path.join(root, "supabase/migrations"))).filter(name => name.endsWith(".sql")).sort();
    const expansion = ["20261014000000_physical_locations_and_code_registry.sql", "20261014010000_movement_location_code_snapshots.sql"];
    const renaming = "20261014020000_authorized_box_code_rename.sql";
    for (const migration of [...expansion, renaming]) assert.ok(migrations.includes(migration));
    const previous = migrations.filter(name => !expansion.includes(name) && name !== renaming);

    // Dos bases nuevas independientes prueban reproducibilidad, no reejecución
    // artificial de una migración ya aplicada.
    for (const database of ["locations_a", "locations_b"]) {
      await t.test(`${database}: base anterior y migraciones incrementales`, async () => {
        sql("postgres", `create database ${database} template template0;`);
        sql(database, databaseBootstrap);
        for (const migration of previous) await sqlFile(database, "supabase/migrations/" + migration);
        await sqlFile(database, "supabase/seed.sql");
        await sqlFile(database, "tests/physical-locations.before.sql");
        for (const migration of expansion) {
          if (database === "locations_a") {
            // Forzar un fallo al FINAL de cada migración y comprobar rollback
            // real de DDL, funciones, datos y permisos antes de aplicarla bien.
            const source = await readFile(path.join(root, "supabase/migrations", migration), "utf8");
            assert.match(source, /\ncommit;\s*$/);
            const failed = spawnSync(executable("psql"), args(database), { env, encoding: "utf8", windowsHide: true,
              input: source.replace(/\ncommit;\s*$/, "\nselect 1/0;\ncommit;\n"), timeout: 90_000 });
            assert.equal(failed.error, undefined);
            assert.equal(failed.status, 3, failed.stderr);
            assert.match(failed.stderr, /22012/);
            if (migration === expansion[0]) {
              assert.equal(sql(database, "select to_regclass('public.estantes') is null;"), "t");
              assert.equal(sql(database, "select attgenerated from pg_attribute where attrelid='public.compartimientos'::regclass and attname='codigo';"), "s");
            } else {
              assert.equal(sql(database, "select count(*) from pg_attribute where attrelid='public.movimientos'::regclass and attname='codigo_origen' and not attisdropped;"), "0");
            }
          }
          await sqlFile(database, "supabase/migrations/" + migration);
        }
        if (database === "locations_a") t.diagnostic("PASS rollback real de ambas migraciones ante fallo final forzado");
        if (database === "locations_a") {
          const source = await readFile(path.join(root, "supabase/migrations", renaming), "utf8");
          const failed = spawnSync(executable("psql"), args(database), { env, encoding: "utf8", windowsHide: true,
            input: source.replace(/\ncommit;\s*$/, "\nselect 1/0;\ncommit;\n"), timeout: 90_000 });
          assert.equal(failed.status, 3, failed.stderr);
          assert.match(failed.stderr, /22012/);
          assert.equal(sql(database, "select to_regprocedure('public.renombrar_codigo_caja(bigint,text,text)') is null;"), "t");
          t.diagnostic("PASS rollback de función y permisos del Bloque 4 ante fallo de migración");
        }
        await sqlFile(database, "supabase/migrations/" + renaming);
        t.diagnostic(sql(database, "select version();"));
      });
      await t.test(`${database}: escenario 96, restricciones y seguridad`, async () => {
        t.diagnostic(summary(await sqlFile(database, "tests/physical-locations.sql")));
      });
      await t.test(`${database}: regresión SQL de stock existente`, async () => {
        await sqlFile(database, "tests/stock-transactions.sql");
      });
      await t.test(`${database}: stock común, siete operaciones y rollback`, async () => {
        t.diagnostic(summary(await sqlFile(database, "tests/stock-locations.sql")));
      });
      await t.test(`${database}: mapa confirmado A/B y posiciones 2x2`, async () => {
        t.diagnostic(summary(await sqlFile(database, "tests/physical-locations.map.sql")));
      });
      await t.test(`${database}: RPC de renombrado, mapa, auditoría, permisos y rollback`, async () => {
        t.diagnostic(summary(await sqlFile(database, "tests/box-code-rename.sql")));
      });
      await t.test(`${database}: búsqueda de códigos actuales/históricos y RLS`, async () => {
        t.diagnostic(summary(await sqlFile(database, "tests/location-search.sql")));
      });
      await t.test(`${database}: historial común, instantáneas, renombrados y RLS`, async () => {
        t.diagnostic(summary(await sqlFile(database, "tests/history.sql")));
      });
      await t.test(`${database}: exportaciones de ubicaciones, joins y RLS`, async () => {
        t.diagnostic(summary(await sqlFile(database, "tests/exports.sql")));
      });
    }

    const database = "locations_a";
    const box = code => `(select id from public.compartimientos where codigo='${code}')`;
    const product = suffix => "00000000-0000-0000-0000-" + String(suffix).padStart(12, "0");
    const addProduct = suffix => sql(database, `insert into public.productos(id,nombre,categoria_id)
      values('${product(suffix)}','TEST CONCURRENCIA ${suffix}',(select id from public.categorias where nombre='Otros'));`);

    await t.test("concurrencia: reserva única, perdedor sin auditoría parcial", async () => {
      const result = await overlap(database,
        "update public.compartimientos set codigo='TEST_CONCURRENT' where codigo='TEST_E1_P1'",
        "update public.compartimientos set codigo='TEST_CONCURRENT' where codigo='TEST_E1_P2'", 74001, 3);
      assert.match(result.stderr, /23505/);
      assert.equal(sql(database, "select count(*) from public.cambios_codigo_ubicacion where codigo_nuevo='TEST_CONCURRENT';"), "1");
      assert.equal(sql(database, "select codigo from public.compartimientos where id=(select compartimiento_id from public.ubicacion_codigos where codigo='TEST_E1_P2');"), "TEST_E1_P2");
    });
    await t.test("concurrencia: renombrado primero, movimiento captura código nuevo", async () => {
      addProduct(301);
      const id = sql(database, "select id from public.compartimientos where codigo='TEST_E1_P3';");
      await overlap(database,
        "update public.compartimientos set codigo='TEST_SNAPSHOT_NEW' where codigo='TEST_E1_P3'",
        `${authorized} insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id)
         values('${product(301)}','entrada',1,${id});`, 74002);
      assert.equal(sql(database, `select codigo_destino from public.movimientos where producto_id='${product(301)}';`), "TEST_SNAPSHOT_NEW");
    });
    await t.test("concurrencia: movimiento primero conserva código anterior", async () => {
      addProduct(302);
      const first = `${authorized} insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id)
        values('${product(302)}','entrada',1,${box("TEST_E1_P4")})`;
      await overlap(database, first,
        "update public.compartimientos set codigo='TEST_AFTER_MOVE' where codigo='TEST_E1_P4'", 74003);
      assert.equal(sql(database, `select codigo_destino from public.movimientos where producto_id='${product(302)}';`), "TEST_E1_P4");
    });
    await t.test("concurrencia: dos retiros, un éxito y rollback del otro", async () => {
      addProduct(303);
      sql(database, `${authorized} insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id)
        values('${product(303)}','entrada',5,${box("TEST_E1_P2")});`);
      const withdrawal = `${authorized} insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id)
        values('${product(303)}','retiro',4,${box("TEST_E1_P2")})`;
      const result = await overlap(database, withdrawal, withdrawal, 74004, 3);
      assert.match(result.stderr, /23514/);
      assert.equal(sql(database, `select cantidad from public.inventario where producto_id='${product(303)}';`), "1");
      assert.equal(sql(database, `select count(*) from public.movimientos where producto_id='${product(303)}' and tipo='retiro';`), "1");
    });
    await t.test("concurrencia: ajustes de caja, uno confirma y otro rechaza lectura obsoleta", async () => {
      addProduct(304);
      sql(database, `${authorized} insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id)
        values('${product(304)}','entrada',5,${box("TEST_E2_P1")});`);
      const adjustment = physical => `${authorized} select public.registrar_ajuste_fisico('${product(304)}',${box("TEST_E2_P1")},${physical},5)`;
      const result = await overlap(database, adjustment(4), adjustment(7), 74005, 3);
      assert.match(result.stderr, /40001/);
      assert.equal(sql(database, `select cantidad from public.inventario where producto_id='${product(304)}';`), "4");
      assert.equal(sql(database, `select count(*) from public.movimientos where producto_id='${product(304)}' and tipo='ajuste';`), "1");
    });
    await t.test("concurrencia: dos traslados comparten origen, sin duplicar cantidades", async () => {
      addProduct(305);
      sql(database, `${authorized} insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id)
        values('${product(305)}','entrada',5,${box("TEST_E2_P2")});`);
      const transfer = destination => `${authorized} insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id)
        values('${product(305)}','traslado',4,${box("TEST_E2_P2")},${destination})`;
      const result = await overlap(database, transfer(box("TEST_E6_P4")), transfer(box("C111")), 74006, 3);
      assert.match(result.stderr, /23514/);
      assert.equal(sql(database, `select cantidad from public.inventario where producto_id='${product(305)}' and compartimiento_id=${box("TEST_E2_P2")};`), "1");
      assert.equal(sql(database, `select cantidad from public.inventario where producto_id='${product(305)}' and compartimiento_id=${box("TEST_E6_P4")};`), "4");
      assert.equal(sql(database, `select count(*) from public.inventario where producto_id='${product(305)}' and compartimiento_id=${box("C111")};`), "0");
      assert.equal(sql(database, `select sum(cantidad) from public.inventario where producto_id='${product(305)}';`), "5");
      assert.equal(sql(database, `select count(*) from public.movimientos where producto_id='${product(305)}' and tipo='traslado';`), "1");
    });
    await t.test("RPC concurrente: misma caja, un éxito y lectura obsoleta sin auditoría parcial", async () => {
      const id = sql(database, "select id from public.compartimientos where codigo='TEST_E3_P1';");
      const rename = code => `${authorized} select * from public.renombrar_codigo_caja(${id},'TEST_E3_P1','${code}')`;
      const result = await overlap(database, rename("RPC_WINNER"), rename("RPC_LOSER"), 74007, 3);
      assert.match(result.stderr, /40001/);
      assert.equal(sql(database, "select count(*) from public.cambios_codigo_ubicacion where codigo_nuevo='RPC_WINNER';"), "1");
      assert.equal(sql(database, "select count(*) from public.ubicacion_codigos where codigo='RPC_LOSER';"), "0");
    });
    await t.test("RPC concurrente con movimiento: renombrar primero captura etiqueta nueva", async () => {
      addProduct(306);
      const id = sql(database, "select id from public.compartimientos where codigo='TEST_E3_P2';");
      await overlap(database, `${authorized} select * from public.renombrar_codigo_caja(${id},'TEST_E3_P2','RPC_BEFORE_MOVE')`,
        `${authorized} insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id) values('${product(306)}','entrada',3,${id})`, 74008);
      assert.equal(sql(database, `select codigo_destino from public.movimientos where producto_id='${product(306)}';`), "RPC_BEFORE_MOVE");
      assert.equal(sql(database, `select cantidad from public.inventario where producto_id='${product(306)}';`), "3");
    });
    await t.test("RPC concurrente con movimiento: movimiento primero conserva etiqueta anterior", async () => {
      addProduct(307);
      const id = sql(database, "select id from public.compartimientos where codigo='TEST_E3_P3';");
      await overlap(database, `${authorized} insert into public.movimientos(producto_id,tipo,cantidad,destino_compartimiento_id) values('${product(307)}','entrada',4,${id})`,
        `${authorized} select * from public.renombrar_codigo_caja(${id},'TEST_E3_P3','RPC_AFTER_MOVE')`, 74009);
      assert.equal(sql(database, `select codigo_destino from public.movimientos where producto_id='${product(307)}';`), "TEST_E3_P3");
      assert.equal(sql(database, `select cantidad from public.inventario where producto_id='${product(307)}';`), "4");
    });
    await t.test("conservación final de filas anteriores y consistencia de códigos", () => {
      assert.equal(sql(database, `select count(*) from test_support.movimientos_antes b join public.movimientos m using(id)
        where to_jsonb(b)=to_jsonb(m)-'codigo_origen'-'codigo_destino';`), "2");
      assert.equal(sql(database, `select count(*) from test_support.inventario_antes b join public.inventario i using(producto_id,compartimiento_id)
        where b.cantidad=i.cantidad;`), "2");
      assert.equal(sql(database, `select count(*) from public.compartimientos c left join public.ubicacion_codigos r
        on r.codigo=c.codigo and r.compartimiento_id=c.id where r.codigo is null;`), "0");
      assert.equal(sql(database, "select count(*) from public.compartimientos;"), "96");
    });
  } finally {
    // Solo la carpeta privada creada arriba; nunca pg_ctl contra PGDATA externo.
    if (existsSync(path.join(data, "postmaster.pid"))) run("pg_ctl", ["-D", data, "-w", "-t", "20", "stop", "-m", "fast"]);
  }
});
