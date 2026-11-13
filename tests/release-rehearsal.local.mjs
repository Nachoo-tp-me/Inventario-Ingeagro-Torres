// Ensayo LOCAL de la publicación in-place (PostgreSQL desechable, sin red). Reproduce producción V1 con datos ficticios y comprueba:
//  1) estado-produccion.sql y huella-datos.sql son SELECT válidos y describen V1 exacta;
//  2) pg_dump/pg_restore (como respaldo-produccion.ps1 y restauracion-prueba.ps1) reproducen la misma huella;
//  3) las 6 migraciones pendientes NO cambian la huella de datos (productos, stock, ubicaciones, movimientos, usuarios, fotos);
//  4) tras migrar, el estado refleja V2 con PT409 en el ajuste físico.
// Requiere PG_LOCAL_BIN. No representa permisos reales de Supabase en auth/storage (son esbozos locales).
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { databaseBootstrap, root, startCluster } from "./helpers/pg-local.mjs";

const plataforma = `
create table auth.users(id uuid primary key, email text, created_at timestamptz not null default now());
alter table storage.objects add column metadata jsonb;
`;
const datos = `
insert into auth.users(id,email,created_at) values
 ('d5211ae5-39c6-4365-ad35-e6f6bdcc8058','cuenta@ejemplo.test','2026-01-01T00:00:00Z'),
 ('00000000-0000-4000-8000-0000000000aa','otra@ejemplo.test','2026-01-02T00:00:00Z');
insert into public.categorias(id,nombre) values ('10000000-0000-4000-8000-000000000001','Ficticia A'),('10000000-0000-4000-8000-000000000002','Ficticia B');
insert into public.productos(id,nombre,categoria_id,descripcion,foto_ruta) values
 ('20000000-0000-4000-8000-000000000001','Producto ficticio 1','10000000-0000-4000-8000-000000000001','uno','productos/a.webp'),
 ('20000000-0000-4000-8000-000000000002','Producto ficticio 2','10000000-0000-4000-8000-000000000002',null,null),
 ('20000000-0000-4000-8000-000000000003','Producto ficticio 3','10000000-0000-4000-8000-000000000002','tres','productos/c.jpg');
insert into public.movimientos(producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id,fecha)
select '20000000-0000-4000-8000-000000000001'::uuid,'entrada',10,null::bigint,(select id from public.compartimientos where codigo='C111'),'2026-02-01T10:00:00Z'::timestamptz
union all select '20000000-0000-4000-8000-000000000001','traslado',4,(select id from public.compartimientos where codigo='C111'),(select id from public.compartimientos where codigo='C212'),'2026-02-02T10:00:00Z'
union all select '20000000-0000-4000-8000-000000000003','entrada',7,null,(select id from public.compartimientos where codigo='C364'),'2026-02-03T10:00:00Z'
union all select '20000000-0000-4000-8000-000000000003','retiro',2,(select id from public.compartimientos where codigo='C364'),null,'2026-02-04T10:00:00Z';
insert into storage.objects(bucket_id,name,metadata) values
 ('product-images','productos/a.webp','{"size":1234}'),('product-images','productos/c.jpg','{"size":5678}');
`;

test("Publicación in-place: verificación, respaldo/restauración y huella invariante a las 6 migraciones", async (t) => {
  const pg = await startCluster(t, "release");
  t.after(() => pg.stop());
  const migraciones = (await readdir(path.join(root, "supabase/migrations"))).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(migraciones.length, 14);
  const v1 = migraciones.slice(0, 8), pendientes = migraciones.slice(8);
  assert.deepEqual(pendientes.map((f) => f.slice(0, 14)), ["20260930060000", "20261014000000", "20261014010000", "20261014020000", "20261020000000", "20261020010000"]);

  // Producción V1 simulada.
  pg.sql("postgres", "create database prod template template0;");
  pg.sql("prod", databaseBootstrap + plataforma);
  for (const f of v1) await pg.sqlFile("prod", "supabase/migrations/" + f);
  await pg.sqlFile("prod", "supabase/seed.sql");
  pg.sql("prod", datos);

  const leer = async (db, archivo) => JSON.parse(await pg.sqlFile(db, "supabase/release/" + archivo));
  // Sin historial de la CLI: el estado lo dice y la consulta del historial NO se debe lanzar (fallaría sin efectos).
  assert.equal((await leer("prod", "estado-produccion.sql")).hay_historial, false);
  pg.sql("prod", "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key);"
    + `insert into supabase_migrations.schema_migrations values ${v1.map((f) => `('${f.slice(0, 14)}')`).join(",")};`);
  assert.deepEqual((await leer("prod", "historial-produccion.sql")).versiones, v1.map((f) => f.slice(0, 14)));
  const e1 = await leer("prod", "estado-produccion.sql");
  assert.equal(e1.hay_historial, true);
  assert.equal(e1.tablas_v1, 6); assert.equal(e1.rpc_ajuste, true); assert.equal(e1.ajuste_usa_40001, true); assert.equal(e1.ajuste_usa_pt409, false);
  assert.equal(e1.bucket_privado, true); assert.equal(e1.cuenta_autorizada, true); assert.equal(e1.registro_staging, false);
  assert.equal(e1.pg14_o_superior, true); assert.equal(e1.codigo_generado, true); assert.equal(e1.codigos_no_cxyz, 0); assert.equal(e1.compartimientos, 72);
  assert.deepEqual([e1.v2_estantes, e1.v2_ubicacion_codigos, e1.v2_renombrar, e1.v2_columnas_movimientos], [false, false, false, 0]);

  const antes = await leer("prod", "huella-datos.sql");
  assert.equal(antes.productos, 3); assert.equal(antes.productos_foto, 2); assert.equal(antes.stock_total, 15);
  assert.equal(antes.inventario_filas, 3); assert.equal(antes.movimientos, 4); assert.equal(antes.usuarios_auth, 2); assert.equal(antes.fotos_storage, 2);

  // Respaldo y restauración como en respaldo-produccion.ps1 / restauracion-prueba.ps1 (esbozo de plataforma antes de restaurar).
  const dir = await mkdtemp(path.join(tmpdir(), "ingeagro-release-dump-"));
  const conn = ["-h", "127.0.0.1", "-p", String(pg.port), "-U", "ingeagro_test_owner", "-d", "prod"];
  pg.run("pg_dump", [...conn, "-Fc", "-n", "public", "-f", path.join(dir, "publico.dump")]);
  pg.run("pg_dump", [...conn, "-Fc", "-t", "auth.users", "-t", "storage.buckets", "-t", "storage.objects", "-f", path.join(dir, "auth_storage.dump")]);
  pg.sql("postgres", "create database restaurada template template0;");
  // El volcado de public trae su propio CREATE SCHEMA public: la base desechable elimina el public vacío por defecto.
  pg.sql("restaurada", "drop schema public; create schema auth; create schema storage; create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;");
  const restore = ["-h", "127.0.0.1", "-p", String(pg.port), "-U", "ingeagro_test_owner", "-d", "restaurada", "--no-owner", "--no-acl"];
  pg.run("pg_restore", [...restore, path.join(dir, "auth_storage.dump")]);
  pg.run("pg_restore", [...restore, path.join(dir, "publico.dump")]);
  assert.deepEqual(await leer("restaurada", "huella-datos.sql"), antes, "la restauración debe reproducir exactamente la huella");

  // Las 6 migraciones pendientes, en orden, sobre la "producción" con datos.
  for (const f of pendientes) await pg.sqlFile("prod", "supabase/migrations/" + f);
  assert.deepEqual(await leer("prod", "huella-datos.sql"), antes, "V2 no debe cambiar ningún dato de negocio");
  const e2 = await leer("prod", "estado-produccion.sql");
  assert.equal(e2.ajuste_usa_pt409, true); assert.equal(e2.ajuste_usa_40001, false);
  assert.deepEqual([e2.v2_estantes, e2.v2_ubicacion_codigos, e2.v2_renombrar, e2.v2_columnas_movimientos], [true, true, true, 3]);
  assert.equal(pg.sql("prod", "select count(*) from public.ubicacion_codigos;"), "72");
  assert.equal(pg.sql("prod", "select count(*) from public.movimientos where codigo_origen is null and codigo_destino is null and solicitud_id is null;"), "4",
    "los movimientos históricos conservan columnas nuevas vacías");
});
