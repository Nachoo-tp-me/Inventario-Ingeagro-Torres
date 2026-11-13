// Prueba local ESTÁTICA (sin PostgreSQL, sin red) del aprovisionamiento ficticio de staging:
//   supabase/staging/02_aprovisionamiento_ficticio_staging.sql
// Comprueba que (1) la guarda del marcador de staging es la PRIMERA comprobación del bloque y no tiene ningún camino que la
// omita, (2) el cuerpo de validación e inserción del original psql está íntegro, línea a línea, y (3) los valores por defecto
// hacen fallar una ejecución sin editar. NO sustituye la ejecución real en el staging (Fase 4 de docs/staging/02-supabase-staging.md).
//   node --test tests/staging/aprovisionamiento-staging.local.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const leer = (ruta) => readFileSync(new URL(`../../${ruta}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const staging = leer("supabase/staging/02_aprovisionamiento_ficticio_staging.sql");
const original = leer("supabase/provisioning/provision_estantes_cajas.sql");

const sinComentarios = (sql) => sql.split("\n").map((l) => l.replace(/--.*$/, "").trim()).filter(Boolean);
const cuerpo = (sql, apertura, cierre) => {
  const lineas = sinComentarios(sql);
  const desde = lineas.findIndex((l) => l.startsWith(apertura));
  const hasta = lineas.findIndex((l, i) => i > desde && l.startsWith(cierre));
  assert.ok(desde >= 0 && hasta > desde, `No se encontró el bloque ${apertura} … ${cierre}`);
  return lineas.slice(desde + 1, hasta);
};
const bloqueStaging = cuerpo(staging, "do $provision$", "$provision$;");
const bloqueOriginal = cuerpo(original, "do $$", "$$;");
// Sentencias ejecutables tras el `begin` del bloque (sin el DECLARE).
const ejecutable = bloqueStaging.slice(bloqueStaging.indexOf("begin") + 1);
const posicion = (patron) => ejecutable.findIndex((l) => patron.test(l));

test("no hay metacomandos psql ni transacción explícita fuera del bloque DO", () => {
  assert.equal(sinComentarios(staging).filter((l) => l.startsWith("\\")).length, 0);
  assert.equal(sinComentarios(staging).filter((l) => /^(begin|commit|rollback)\s*;/i.test(l)).length, 0);
  assert.equal((staging.match(/^do \$provision\$/gm) ?? []).length, 1, "Debe haber un único bloque DO");
});

test("la guarda del marcador es la primera comprobación: antes de confirmar, leer etiquetas o escribir", () => {
  const primeraCondicion = ejecutable.findIndex((l) => /^(if|elsif)\b/.test(l));
  assert.match(ejecutable[primeraCondicion], /^if v_ref_esperada is null or v_ref_esperada collate "C" !~ '\^\[a-z0-9\]\{20\}\$' then$/);
  const sinTabla = posicion(/^if to_regclass\('public\.entorno_staging'\) is null then$/);
  const filaValida = posicion(/^if \(select count\(\*\) from public\.entorno_staging\) <> 1$/);
  assert.ok(sinTabla > primeraCondicion && filaValida > sinTabla, "Orden de la guarda incorrecto");
  assert.match(ejecutable[sinTabla + 1], /^raise exception 'SOLO STAGING: no existe public\.entorno_staging/);
  assert.match(ejecutable.slice(filaValida, filaValida + 4).join(" "),
    /where id = 1 and nombre = 'ingeagro-v2-staging' and project_ref = v_ref_esperada\) then raise exception 'SOLO STAGING/);
  // Antes de la guarda solo se fijan los tiempos de espera.
  assert.deepEqual(ejecutable.slice(0, primeraCondicion), ["perform set_config('lock_timeout', '5s', true);", "perform set_config('statement_timeout', '120s', true);"]);
  // Todo lo demás va después de la guarda completa.
  const finGuarda = filaValida + 4;
  for (const patron of [/^if v_confirmo <> 'APROVISIONAR_24_CAJAS' then$/, /v_etiquetas::jsonb/, /^insert into /, /^set constraints /]) {
    const i = posicion(patron);
    assert.ok(i > finGuarda, `${patron} aparece antes de terminar la guarda del marcador`);
  }
});

test("no existe ningún camino que aprovisione sin marcador", () => {
  const texto = ejecutable.join("\n");
  assert.doesNotMatch(texto, /to_regclass\('public\.entorno_staging'\) is not null/, "No debe haber ramas condicionadas a la existencia del marcador");
  assert.doesNotMatch(texto, /\belsif\b/, "No debe haber ramas alternativas");
  assert.doesNotMatch(texto, /exception when others then\s*(null|return)/i, "Ningún error se puede tragar");
  // Los únicos manejadores de excepción son el del parseo JSON (que vuelve a lanzar) del original.
  assert.equal((texto.match(/exception when/g) ?? []).length, 1);
});

test("el cuerpo del original psql está íntegro; solo cambian la lectura de entradas y el mensaje de confirmación", () => {
  const conjunto = new Set(bloqueStaging);
  const faltan = bloqueOriginal.filter((l) => !conjunto.has(l));
  assert.deepEqual(faltan, [
    "if current_setting('provision.confirmo') <> 'APROVISIONAR_24_CAJAS' then",
    "raise exception 'Confirmación inválida: use -v confirmo=APROVISIONAR_24_CAJAS';",
    "v_raw := current_setting('provision.etiquetas')::jsonb;",
  ]);
  assert.ok(conjunto.has("if v_confirmo <> 'APROVISIONAR_24_CAJAS' then"));
  assert.ok(conjunto.has("v_raw := v_etiquetas::jsonb;"));
});

test("las etiquetas deben ser ficticias (STG o PRUEBA) y los valores por defecto fallan sin cambios", () => {
  assert.ok(posicion(/~ '\^\(STG\|PRUEBA\)'\) <> 24 then$/) > posicion(/^end loop;$/), "La exigencia de etiquetas ficticias va tras validarlas");
  assert.match(staging, /v_ref_esperada constant text := '__REF_STAGING__';/);
  assert.match(staging, /v_confirmo text := 'NO_CONFIRMADO';/);
  assert.equal((staging.match(/"__COMPLETAR__"/g) ?? []).length, 24);
  // '__REF_STAGING__' no cumple ^[a-z0-9]{20}$: una ejecución sin editar se detiene en la primera condición.
  assert.doesNotMatch("__REF_STAGING__", /^[a-z0-9]{20}$/);
});

test("el script productivo psql sigue sin conocer el marcador de staging (no se modificó)", () => {
  assert.doesNotMatch(original, /entorno_staging|v_ref_esperada|STG\|PRUEBA/);
});
