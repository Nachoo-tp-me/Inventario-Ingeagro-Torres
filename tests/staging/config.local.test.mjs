// Verificación LOCAL y SIN RED de la validación de configuración de staging y de los modos de fallo seguro de A5 y A7.
// No pertenece al patrón tests/*.test.mjs (está en tests/staging/): no altera las pruebas habituales (`npm test`).
//   node --test tests/staging/config.local.test.mjs
// Los subprocesos se lanzan con un entorno mínimo construido aquí (sin variables del usuario, sin .env*) y con una precarga
// (bloquear-red.mjs) que convierte cualquier intento de red en la marca RED_BLOQUEADA: así se demuestra que los scripts abortan
// ANTES de cualquier petición. Todos los valores son ficticios y evidentes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CONFIRMACION,
  describirError,
  redactar,
  validarConfigA5,
  validarConfigA7,
  validarMarcador,
} from "./config.mjs";

const raiz = fileURLToPath(new URL("../../", import.meta.url));
const A5 = path.join(raiz, "scripts", "staging", "crear-usuarios-prueba.mjs");
const A7 = path.join(raiz, "tests", "staging", "aceptacion.staging.mjs");
const BLOQUEO = pathToFileURL(path.join(raiz, "tests", "staging", "bloquear-red.mjs")).href;

const REF = "a".repeat(20);
const OTRA_REF = "b".repeat(20);
const SERVICIO = "sb_secret_FICTICIA_NO_REAL_000000";
const PUBLICABLE = "sb_publishable_FICTICIA_NO_REAL_000000";
const PASS_AUT = "clave-ficticia-autorizado-0001";
const PASS_AJE = "clave-ficticia-ajeno-00000002";
const SECRETOS = [SERVICIO, PUBLICABLE, PASS_AUT, PASS_AJE];

const comun = {
  STAGING_CONFIRM: CONFIRMACION,
  STAGING_PROJECT_REF: REF,
  STAGING_URL: `https://${REF}.supabase.co`,
  STAGING_AUTORIZADO_EMAIL: "autorizado.prueba@example.test",
  STAGING_AUTORIZADO_PASSWORD: PASS_AUT,
  STAGING_AJENO_EMAIL: "ajeno.prueba@example.test",
  STAGING_AJENO_PASSWORD: PASS_AJE,
};
const envA5 = { ...comun, STAGING_SERVICE_KEY: SERVICIO };
const envA7 = { ...comun, STAGING_PUBLISHABLE_KEY: PUBLICABLE, STAGING_ETAPA: "v2" };

const sinTexto = (resultado, texto) => assert.ok(!resultado.errores.join("\n").includes(texto), "Un mensaje de error contiene un valor de configuración");

// ---------- Funciones puras ----------

test("A5/A7: configuración válida ficticia aceptada", () => {
  const a5 = validarConfigA5(envA5);
  const a7 = validarConfigA7(envA7);
  assert.deepEqual(a5.errores, []);
  assert.deepEqual(a7.errores, []);
  assert.equal(a5.config.projectRef, REF);
  assert.equal(a7.config.etapa, "v2");
});

test("sin variables: ambas validaciones fallan y listan lo que falta sin inventar valores por defecto", () => {
  for (const validar of [validarConfigA5, validarConfigA7]) {
    const r = validar({});
    assert.equal(r.ok, false);
    assert.equal(r.config, null);
    const texto = r.errores.join("\n");
    for (const variable of ["STAGING_CONFIRM", "STAGING_PROJECT_REF", "STAGING_URL", "STAGING_AUTORIZADO_EMAIL", "STAGING_AJENO_PASSWORD"]) assert.match(texto, new RegExp(variable));
  }
});

test("STAGING_CONFIRM exacto, ref de 20 caracteres [a-z0-9] y URL exacta (sin barra ni ruta)", () => {
  for (const [cambio, variable] of [
    [{ STAGING_CONFIRM: "ingeagro-v2-staging " }, "STAGING_CONFIRM"],
    [{ STAGING_CONFIRM: "INGEAGRO-V2-STAGING" }, "STAGING_CONFIRM"],
    [{ STAGING_PROJECT_REF: "a".repeat(19) }, "STAGING_PROJECT_REF"],
    [{ STAGING_PROJECT_REF: "A".repeat(20) }, "STAGING_PROJECT_REF"],
    [{ STAGING_URL: `https://${OTRA_REF}.supabase.co` }, "STAGING_URL"],
    [{ STAGING_URL: `https://${REF}.supabase.co/` }, "STAGING_URL"],
    [{ STAGING_URL: `https://${REF}.supabase.co/rest/v1` }, "STAGING_URL"],
    [{ STAGING_URL: `http://${REF}.supabase.co` }, "STAGING_URL"],
    [{ STAGING_URL: "" }, "STAGING_URL"],
  ]) {
    for (const [validar, base] of [[validarConfigA5, envA5], [validarConfigA7, envA7]]) {
      const r = validar({ ...base, ...cambio });
      assert.equal(r.ok, false, JSON.stringify(Object.keys(cambio)));
      assert.match(r.errores.join("\n"), new RegExp(variable));
      sinTexto(r, OTRA_REF);
    }
  }
});

test("NEXT_PUBLIC_SUPABASE_URL contradictoria aborta; si coincide (o está vacía) no molesta", () => {
  for (const [validar, base] of [[validarConfigA5, envA5], [validarConfigA7, envA7]]) {
    const contradictoria = validar({ ...base, NEXT_PUBLIC_SUPABASE_URL: "https://cccccccccccccccccccc.supabase.co" });
    assert.equal(contradictoria.ok, false);
    assert.match(contradictoria.errores.join("\n"), /NEXT_PUBLIC_SUPABASE_URL/);
    sinTexto(contradictoria, "cccccccccccccccccccc");
    assert.equal(validar({ ...base, NEXT_PUBLIC_SUPABASE_URL: base.STAGING_URL }).ok, true);
    assert.equal(validar({ ...base, NEXT_PUBLIC_SUPABASE_URL: "" }).ok, true);
    assert.equal(validar({ ...base, SUPABASE_URL: "https://cccccccccccccccccccc.supabase.co" }).ok, false);
  }
});

test("usuarios: contraseñas >= 16 y distintas, correos distintos sin distinguir mayúsculas", () => {
  for (const [validar, base] of [[validarConfigA5, envA5], [validarConfigA7, envA7]]) {
    assert.equal(validar({ ...base, STAGING_AUTORIZADO_PASSWORD: "corta" }).ok, false);
    assert.equal(validar({ ...base, STAGING_AJENO_PASSWORD: "x".repeat(15) }).ok, false);
    assert.equal(validar({ ...base, STAGING_AJENO_PASSWORD: base.STAGING_AUTORIZADO_PASSWORD }).ok, false);
    assert.equal(validar({ ...base, STAGING_AJENO_EMAIL: base.STAGING_AUTORIZADO_EMAIL.toUpperCase() }).ok, false);
    assert.equal(validar({ ...base, STAGING_AJENO_EMAIL: "no-es-correo" }).ok, false);
    const sin = { ...base };
    delete sin.STAGING_AJENO_EMAIL;
    assert.equal(validar(sin).ok, false);
  }
});

test("A5: la clave de servicio no puede faltar, ser publicable ni igual a la publicable", () => {
  assert.equal(validarConfigA5({ ...envA5, STAGING_SERVICE_KEY: "" }).ok, false);
  assert.equal(validarConfigA5({ ...envA5, STAGING_SERVICE_KEY: PUBLICABLE }).ok, false);
  assert.equal(validarConfigA5({ ...envA5, STAGING_SERVICE_KEY: "clave-igual-0123456789", STAGING_PUBLISHABLE_KEY: "clave-igual-0123456789" }).ok, false);
  assert.equal(validarConfigA5({ ...envA5, STAGING_SERVICE_KEY: `${SERVICIO}\n` }).ok, false);
  const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.firmaFicticia`;
  assert.equal(validarConfigA5({ ...envA5, STAGING_SERVICE_KEY: jwt({ role: "anon", ref: REF }) }).ok, false, "JWT con rol anon");
  assert.equal(validarConfigA5({ ...envA5, STAGING_SERVICE_KEY: jwt({ role: "service_role", ref: OTRA_REF }) }).ok, false, "JWT de otro proyecto");
  assert.equal(validarConfigA5({ ...envA5, STAGING_SERVICE_KEY: jwt({ role: "service_role", ref: REF }) }).ok, true);
});

test("A7: clave secreta como publicable, clave de servicio en el entorno y etapa inválida abortan", () => {
  assert.equal(validarConfigA7({ ...envA7, STAGING_PUBLISHABLE_KEY: SERVICIO }).ok, false);
  assert.equal(validarConfigA7({ ...envA7, STAGING_PUBLISHABLE_KEY: "" }).ok, false);
  const conServicio = validarConfigA7({ ...envA7, STAGING_SERVICE_KEY: SERVICIO });
  assert.equal(conServicio.ok, false);
  assert.match(conServicio.errores.join("\n"), /STAGING_SERVICE_KEY/);
  sinTexto(conServicio, SERVICIO);
  assert.equal(validarConfigA7({ ...envA7, SUPABASE_SERVICE_ROLE_KEY: SERVICIO }).ok, false);
  for (const etapa of ["", "v3", "V2", undefined]) assert.equal(validarConfigA7({ ...envA7, STAGING_ETAPA: etapa }).ok, false, String(etapa));
  for (const etapa of ["v1", "v2-sin-idempotencia", "v2", "v2-aprovisionado"]) assert.equal(validarConfigA7({ ...envA7, STAGING_ETAPA: etapa }).ok, true, etapa);
});

test("ningún mensaje de error de configuración contiene claves ni contraseñas", () => {
  const casos = [
    validarConfigA5({ ...envA5, STAGING_URL: `https://${OTRA_REF}.supabase.co`, STAGING_AJENO_PASSWORD: PASS_AUT }),
    validarConfigA7({ ...envA7, STAGING_SERVICE_KEY: SERVICIO, STAGING_CONFIRM: "no" }),
  ];
  for (const caso of casos) for (const secreto of SECRETOS) sinTexto(caso, secreto);
});

test("marcador: exige una fila id=1, nombre y project_ref exactos", () => {
  const config = { projectRef: REF };
  const fila = { id: 1, nombre: CONFIRMACION, project_ref: REF, creado_en: "2026-01-01T00:00:00Z" };
  assert.equal(validarMarcador({ data: [fila], error: null }, config).ok, true);
  for (const resultado of [
    { data: [], error: null },
    { data: [fila, fila], error: null },
    { data: null, error: { code: "42P01", message: "no existe" } },
    { data: [{ ...fila, id: 2 }], error: null },
    { data: [{ ...fila, nombre: "produccion" }], error: null },
    { data: [{ ...fila, project_ref: OTRA_REF }], error: null },
    undefined,
  ]) assert.equal(validarMarcador(resultado, config).ok, false);
});

test("redactar/describirError ocultan secretos, JWT, claves y URLs firmadas, y no vuelcan headers", () => {
  const error = {
    code: "42501",
    status: 403,
    message: `fallo con ${SERVICIO} y ${PASS_AUT} en https://x.supabase.co/storage/v1/object/sign/b/a.png?token=eyJabcdefgh.ijklmnopqr.stu`,
    headers: { authorization: `Bearer ${SERVICIO}` },
    cause: { secreto: PUBLICABLE },
  };
  const texto = describirError(error, SECRETOS);
  for (const secreto of SECRETOS) assert.ok(!texto.includes(secreto), `se filtró ${secreto.slice(0, 8)}…`);
  assert.ok(!texto.includes("token=eyJ"), "se filtró una URL firmada");
  assert.match(texto, /code=42501/);
  assert.ok(!/headers|authorization|cause/i.test(texto));
  assert.ok(!redactar("eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.firma", []).includes("eyJhbGci"));
});

// ---------- Subprocesos: abortan ANTES de cualquier red ----------

function ejecutar(script, args, env) {
  const resultado = spawnSync(process.execPath, [...(script === A7 ? ["--test"] : []), script, ...args], {
    cwd: raiz,
    encoding: "utf8",
    timeout: 90_000,
    env: { SystemRoot: process.env.SystemRoot ?? "", NODE_OPTIONS: `--import=${BLOQUEO}`, ...env },
  });
  const salida = `${resultado.stdout ?? ""}\n${resultado.stderr ?? ""}`;
  return { codigo: resultado.status, salida, errorSpawn: resultado.error };
}

function sinFiltraciones(salida) {
  for (const secreto of SECRETOS) assert.ok(!salida.includes(secreto), "La salida contiene un secreto");
}

const escenarios = [
  ["(a) sin variables", {}],
  ["(b) STAGING_URL de otra ref", { STAGING_URL: `https://${OTRA_REF}.supabase.co` }],
  ["(c) NEXT_PUBLIC_SUPABASE_URL contradictoria", { NEXT_PUBLIC_SUPABASE_URL: "https://cccccccccccccccccccc.supabase.co" }],
];

for (const [nombre, script, base] of [["A5", A5, envA5], ["A7", A7, envA7]]) {
  for (const [descripcion, cambio] of escenarios) {
    test(`${nombre} ${descripcion}: aborta con error y ANTES de cualquier petición`, () => {
      const env = descripcion.startsWith("(a)") ? {} : { ...base, ...cambio };
      const r = ejecutar(script, [], env);
      assert.equal(r.errorSpawn, undefined, "el subproceso no pudo ejecutarse");
      assert.notEqual(r.codigo, 0, `salió con 0:\n${r.salida}`);
      assert.ok(!r.salida.includes("RED_BLOQUEADA"), `Hubo un intento de red antes de abortar:\n${r.salida}`);
      assert.match(r.salida, /Configuraci[oó]n de staging inv[aá]lida/);
      sinFiltraciones(r.salida);
    });
  }
}

test("A7 (d) con clave de servicio en el entorno: la suite FALLA y no toca la red", () => {
  const r = ejecutar(A7, [], { ...envA7, STAGING_SERVICE_KEY: SERVICIO });
  assert.notEqual(r.codigo, 0, r.salida);
  assert.ok(!r.salida.includes("RED_BLOQUEADA"), r.salida);
  assert.match(r.salida, /STAGING_SERVICE_KEY/);
  sinFiltraciones(r.salida);
});

test("A5 (d) con la clave de servicio igual a la publicable: aborta sin red", () => {
  const r = ejecutar(A5, [], { ...envA5, STAGING_PUBLISHABLE_KEY: SERVICIO });
  assert.equal(r.codigo, 2, r.salida);
  assert.ok(!r.salida.includes("RED_BLOQUEADA"), r.salida);
  sinFiltraciones(r.salida);
});

test("A5 (e) --dry-run con configuración válida ficticia: valida, sale 0 y NO conecta", () => {
  const r = ejecutar(A5, ["--dry-run"], envA5);
  assert.equal(r.codigo, 0, r.salida);
  assert.ok(!r.salida.includes("RED_BLOQUEADA"), `--dry-run intentó conectar:\n${r.salida}`);
  assert.match(r.salida, /NO se conect/);
  assert.match(r.salida, new RegExp(REF));
  sinFiltraciones(r.salida);
});

test("A5 --dry-run con configuración inválida sigue fallando; argumentos desconocidos se rechazan", () => {
  const invalido = ejecutar(A5, ["--dry-run"], { ...envA5, STAGING_URL: `https://${OTRA_REF}.supabase.co` });
  assert.equal(invalido.codigo, 2, invalido.salida);
  assert.ok(!invalido.salida.includes("RED_BLOQUEADA"));
  const raro = ejecutar(A5, ["--forzar"], envA5);
  assert.notEqual(raro.codigo, 0, raro.salida);
  assert.ok(!raro.salida.includes("RED_BLOQUEADA"));
});

test("control positivo A5: con configuración válida y sin --dry-run el PRIMER intento de red ocurre tras validar y falla con código != 0", () => {
  const r = ejecutar(A5, [], envA5);
  assert.notEqual(r.codigo, 0, r.salida);
  assert.match(r.salida, /RED_BLOQUEADA/, "El bloqueo de red no se activó: la verificación no demuestra nada");
  assert.match(r.salida, /Configuraci[oó]n v[aá]lida/);
  sinFiltraciones(r.salida);
});

test("control positivo A7: con configuración válida el primer intento de red es el inicio de sesión y NINGUNA prueba se ejecuta tras fallar la guarda", () => {
  const r = ejecutar(A7, [], envA7);
  assert.notEqual(r.codigo, 0, r.salida);
  assert.match(r.salida, /RED_BLOQUEADA/, "El bloqueo de red no se activó: la verificación no demuestra nada");
  assert.equal(r.salida.match(/^RED_BLOQUEADA: fetch/gm)?.length, 1, "Debe haber exactamente un intento de red (el inicio de sesión)");
  assert.match(r.salida, /No se pudo iniciar sesi[oó]n como usuario autorizado/);
  assert.ok(!r.salida.includes("✔"), "Alguna prueba se ejecutó con éxito tras fallar la guarda de arranque");
  assert.match(r.salida, /cancelled [1-9]\d*/);
  sinFiltraciones(r.salida);
});
