// P1-1: el script de aprovisionamiento de 6 estantes y 24 cajas, probado SOLO en PostgreSQL desechable con etiquetas ficticias.
// Requisitos: Node >=22 y binarios PostgreSQL locales. PG_LOCAL_BIN='<tools>\pgsql\bin'; node --test tests/provisioning.local.mjs
// El script de producción no contiene etiquetas: aquí se le pasan 24 etiquetas de prueba (PRUEBA_*) por variable psql.
import assert from "node:assert/strict";
import test from "node:test";
import { startCluster } from "./helpers/pg-local.mjs";

const SCRIPT = "supabase/provisioning/provision_estantes_cajas.sql";
const labels = Array.from({ length: 24 }, (_, index) => `PRUEBA_E${Math.floor(index / 4) + 1}_P${index % 4 + 1}`);
// JSON solo ASCII (\uXXXX): los argumentos de línea de comandos de Windows no son UTF-8; jsonb los decodifica igual.
const asciiJson = list => JSON.stringify(list).replace(/[\u0080-\uffff]/g, ch => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
const vars = (list = labels, confirmo = "APROVISIONAR_24_CAJAS") => ({ confirmo, etiquetas: asciiJson(list) });

test("P1-1: aprovisionamiento transaccional de 6 estantes y 24 cajas en PostgreSQL desechable", async t => {
  const cluster = await startCluster(t, "provisioning");
  try {
    await cluster.migrate("prov");
    const { sql, psqlFile } = cluster;
    const state = () => sql("prov", "select (select count(*) from public.estantes)||'|'||(select count(*) from public.compartimientos where tipo='caja')||'|'||(select count(*) from public.compartimientos)||'|'||(select count(*) from public.ubicacion_codigos)||'|'||(select count(*) from public.cambios_codigo_ubicacion);");
    assert.equal(state(), "0|0|72|72|0", "antes: solo las 72 ubicaciones de torre");

    await t.test("exige confirmación y las 24 etiquetas reales: sin variables o con valores inválidos falla sin tocar nada", () => {
      const noVars = psqlFile("prov", SCRIPT, {}); assert.notEqual(noVars.status, 0); assert.match(noVars.stdout + noVars.stderr, /falta -v confirmo|faltan variables/);
      const noLabels = psqlFile("prov", SCRIPT, { confirmo: "APROVISIONAR_24_CAJAS" }); assert.notEqual(noLabels.status, 0); assert.match(noLabels.stdout + noLabels.stderr, /faltan las 24 etiquetas/);
      const noConfirm = psqlFile("prov", SCRIPT, { etiquetas: JSON.stringify(labels) }); assert.notEqual(noConfirm.status, 0);
      const wrongConfirm = psqlFile("prov", SCRIPT, vars(labels, "SI")); assert.notEqual(wrongConfirm.status, 0); assert.match(wrongConfirm.stderr, /Confirmación inválida/);
      const bad = [
        [labels.slice(0, 23), /EXACTAMENTE 24/], [[...labels, "PRUEBA_EXTRA"], /EXACTAMENTE 24/], [Array(24).fill("__COMPLETAR__"), /inválida o sin completar/],
        [[...labels.slice(0, 23), labels[0]], /repetida/], [[...labels.slice(0, 23), "prueba_e1_p1"], /repetida/], [[...labels.slice(0, 23), "C101"], /reservada a torres/],
        [[...labels.slice(0, 23), "CAJA ESPACIO"], /inválida/], [[...labels.slice(0, 23), "ÑANDÚ"], /inválida/], [[...labels.slice(0, 23), ""], /inválida/],
        [[...labels.slice(0, 23), "X".repeat(25)], /inválida/], [[...labels.slice(0, 23), 7], /no es una cadena/], [[...labels.slice(0, 23), null], /no es una cadena/],
      ];
      for (const [list, message] of bad) { const result = psqlFile("prov", SCRIPT, vars(list)); assert.notEqual(result.status, 0, JSON.stringify(list).slice(0, 60)); assert.match(result.stderr, message); }
      const notArray = psqlFile("prov", SCRIPT, { confirmo: "APROVISIONAR_24_CAJAS", etiquetas: '{\"a\":1}' }); assert.notEqual(notArray.status, 0);
      assert.equal(state(), "0|0|72|72|0", "ninguna ejecución fallida modificó la base");
    });

    await t.test("requiere TODAS las migraciones (también la de idempotencia): sobre un esquema incompleto falla", () => {
      cluster.sql("postgres", "create database partial template template0;"); cluster.sql("partial", "create schema auth; create schema public2;");
      const result = psqlFile("partial", SCRIPT, vars()); assert.notEqual(result.status, 0);
    });

    let box1;
    await t.test("ejecución válida: 6 estantes, 24 cajas, 96 ubicaciones, posiciones y códigos en el orden indicado", () => {
      const result = psqlFile("prov", SCRIPT, vars([labels[0].toLowerCase(), ...labels.slice(1)])); // la minúscula se normaliza
      assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /OK: 6 estantes y 24 cajas aprovisionados/);
      assert.equal(state(), "6|24|96|96|0");
      assert.equal(sql("prov", "select string_agg(codigo, ',' order by estante_id, posicion) from public.compartimientos where tipo='caja';"), labels.join(","));
      assert.equal(sql("prov", "select count(*) from (select estante_id from public.compartimientos where tipo='caja' group by 1 having count(*)=4 and min(posicion)=1 and max(posicion)=4) s;"), "6");
      assert.equal(sql("prov", "select string_agg(id||':'||grupo, ',' order by id) from public.estantes;"), "1:A,2:A,3:A,4:B,5:B,6:B");
      assert.equal(sql("prov", "select min(id)||'-'||max(id) from public.compartimientos where tipo='caja';"), "73-96", "IDs permanentes nuevos a continuación de los 72 de torre");
      assert.equal(sql("prov", "select count(*) from public.compartimientos c join public.ubicacion_codigos r on r.codigo=c.codigo and r.compartimiento_id=c.id;"), "96");
      assert.equal(sql("prov", "select count(*) from public.compartimientos where tipo='compartimiento' and torre_id is not null;"), "72", "las torres no cambian");
      box1 = sql("prov", "select id from public.compartimientos where tipo='caja' and estante_id=1 and posicion=1;");
    });

    await t.test("segunda ejecución: falla sin ninguna modificación parcial (mismos IDs, códigos y totales)", () => {
      const before = sql("prov", "select md5(string_agg(id||codigo||coalesce(estante_id::text,'')||posicion, ',' order by id)) from public.compartimientos;");
      const again = psqlFile("prov", SCRIPT, vars()); assert.notEqual(again.status, 0); assert.match(again.stderr, /Ya existen estantes o cajas/);
      assert.equal(state(), "6|24|96|96|0");
      assert.equal(sql("prov", "select md5(string_agg(id||codigo||coalesce(estante_id::text,'')||posicion, ',' order by id)) from public.compartimientos;"), before);
      const other = psqlFile("prov", SCRIPT, vars(Array.from({ length: 24 }, (_, i) => `OTRAS_${i + 1}`))); assert.notEqual(other.status, 0, "ni siquiera con otras etiquetas");
      assert.equal(state(), "6|24|96|96|0");
    });

    await t.test("entorno aprovisionado: operaciones de stock, idempotencia, histórico/renombrado, RLS y fotografías privadas", async () => {
      sql("prov", "grant usage on schema storage to authenticated, anon; grant all on storage.objects to authenticated; grant select on storage.objects to anon;"); // permisos de plataforma de Supabase (simulados)
      const output = await cluster.sqlFile("prov", "tests/provisioning.integration.sql");
      const passes = output.split(/\r?\n/).filter(line => line.startsWith("PASS "));
      assert.equal(passes.length, 3, output); t.diagnostic(passes.join("\n"));
      assert.equal(state(), "6|24|96|96|0", "la prueba de integración se revirtió por completo");
      assert.ok(box1);
    });
  } finally { cluster.stop(); }
});
