import assert from "node:assert/strict";
import test from "node:test";
import { classifyReadError, errorLogCode, settleSection, summarizeShelves, summarizeTowers } from "../lib/home-summary-model.ts";

const box = (id, ocupado) => ({ id, ocupado });
const shelf = (id, grupo, occupiedFlags) => ({ id, nombre: `Estante ${id}`, grupo, cajas: occupiedFlags.map((flag, index) => box(id * 10 + index, flag)) });

test("Torres: totales provienen del resumen, con ceros válidos", () => {
  const summary = { torres: [{ id: 1 }, { id: 2 }, { id: 3 }], total: 72, ocupados: 5, disponibles: 67, productos: 9 };
  assert.deepEqual(summarizeTowers(summary), { torres: 3, compartimientos: 72, ocupados: 5, disponibles: 67, productos: 9 });
  assert.deepEqual(summarizeTowers({ torres: [{ id: 1 }], total: 24, ocupados: 0, disponibles: 24, productos: 0 }),
    { torres: 1, compartimientos: 24, ocupados: 0, disponibles: 24, productos: 0 });
  assert.deepEqual(summarizeTowers({ torres: [], total: 0, ocupados: 0, disponibles: 0, productos: 0 }),
    { torres: 0, compartimientos: 0, ocupados: 0, disponibles: 0, productos: 0 });
});

test("Estantes: cajas contadas por unidad propia, sin mezclar con compartimientos", () => {
  const shelves = [shelf(1, "A", [true, false, false, false]), shelf(2, "A", [true, true, false, false]), shelf(4, "B", [false, false, false, false])];
  assert.deepEqual(summarizeShelves(shelves), { estantes: 3, cajas: 12, ocupadas: 3, disponibles: 9, grupos: ["A", "B"] });
  assert.deepEqual(summarizeShelves([]), { estantes: 0, cajas: 0, ocupadas: 0, disponibles: 0, grupos: [] });
  assert.deepEqual(summarizeShelves([shelf(1, "B", [false, false, false, false])]).grupos, ["B"]);
});

test("clasificación: errores de acceso y autenticación nunca se degradan", () => {
  for (const code of ["PGRST301", "PGRST302", "PGRST303", "42501", "28000", "28P01"])
    assert.equal(classifyReadError({ message: "algo", details: "", hint: "", code }), "access", code);
  for (const message of ["JWT expired", "Invalid API key", "No API key found in request", "permission denied for table inventario", "new row violates row-level security policy", "Unauthorized"])
    assert.equal(classifyReadError({ message, code: "" }), "access", message);
});

test("clasificación: fallos de conexión/consulta recuperables", () => {
  for (const code of ["PGRST000", "PGRST001", "PGRST002", "PGRST003", "08006", "53300", "57014", "40001", "40P01"])
    assert.equal(classifyReadError({ message: "x", details: "", hint: "", code }), "recoverable", code);
  for (const message of ["TypeError: fetch failed", "FetchError: network timeout", "AbortError: The user aborted a request.", "Bad Gateway", "upstream request timeout", "ECONNRESET socket hang up"])
    assert.equal(classifyReadError({ message, details: "", hint: "", code: "" }), "recoverable", message);
  const network = new TypeError("fetch failed");
  assert.equal(classifyReadError(network), "recoverable");
});

test("clasificación: errores de programación, invariantes y desconocidos se propagan", () => {
  for (const code of ["42P01", "42703", "42883", "PGRST100", "PGRST200", "PGRST204", "23505", "22P02"])
    assert.equal(classifyReadError({ message: "x", details: "", hint: "", code }), "unexpected", code);
  assert.equal(classifyReadError(new Error("El estante no tiene sus cuatro posiciones físicas disponibles.")), "unexpected");
  assert.equal(classifyReadError(new TypeError("Cannot read properties of undefined (reading 'map')")), "unexpected");
  assert.equal(classifyReadError(new RangeError("fetch failed")), "unexpected");
  assert.equal(classifyReadError({ message: "algo raro sin código", code: "" }), "unexpected");
  assert.equal(classifyReadError("fetch failed"), "unexpected");
  assert.equal(classifyReadError(null), "unexpected");
  assert.equal(classifyReadError(undefined), "unexpected");
});

test("log mínimo: solo código o nombre, nunca mensaje ni datos", () => {
  assert.equal(errorLogCode({ code: "PGRST002", message: "Bearer abc.def.ghi secret", details: "fila 5" }), "PGRST002");
  assert.equal(errorLogCode({ code: "", message: "TypeError: fetch failed https://x.supabase.co?apikey=SECRET" }), "connection");
  assert.equal(errorLogCode(new TypeError("fetch failed token=SECRET")), "TypeError");
  assert.equal(errorLogCode({ code: "a b; DROP TABLE", message: "x" }), "connection");
  assert.equal(errorLogCode(null), "connection");
});

function harness() {
  const calls = { rethrow: 0, reported: [] };
  const internal = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
  return { calls, internal, options: {
    rethrow(error) { calls.rethrow++; if (error?.digest?.startsWith("NEXT_")) throw error; },
    report(code) { calls.reported.push(code); },
  } };
}

test("settleSection: éxito, fallo recuperable → error (nunca ceros) y propagaciones obligatorias", async () => {
  const { calls, internal, options } = harness();
  assert.deepEqual(await settleSection(async () => ({ total: 0 }), options), { status: "ready", data: { total: 0 } });
  assert.deepEqual(calls.reported, []);

  const failed = await settleSection(async () => { throw { message: "TypeError: fetch failed", details: "", hint: "", code: "" }; }, options);
  assert.deepEqual(failed, { status: "error" });
  assert.deepEqual(calls.reported, ["connection"]);
  assert.equal("data" in failed, false);

  const database = await settleSection(async () => { throw { message: "x", details: "", hint: "", code: "PGRST002" }; }, options);
  assert.deepEqual(database, { status: "error" });

  // Internos de Next (redirect, notFound…): re-lanzados por `rethrow`, sin informar.
  const before = calls.reported.length;
  await assert.rejects(() => settleSection(async () => { throw internal; }, options), error => error === internal);
  // Acceso: se re-lanza el mismo objeto.
  const access = { message: "JWT expired", details: "", hint: "", code: "PGRST301" };
  await assert.rejects(() => settleSection(async () => { throw access; }, options), error => error === access);
  // Programación/invariantes: se propaga.
  const bug = new Error("El estante no tiene sus cuatro posiciones físicas disponibles.");
  await assert.rejects(() => settleSection(async () => { throw bug; }, options), error => error === bug);
  const unknown = { message: "desconocido", code: "" };
  await assert.rejects(() => settleSection(async () => { throw unknown; }, options), error => error === unknown);
  assert.equal(calls.reported.length, before, "los errores propagados no se registran como fallo de sección");
});

test("settleSection: una lectura síncrona que lanza también se clasifica", async () => {
  const { options } = harness();
  const bug = new TypeError("x is not a function");
  await assert.rejects(() => settleSection(() => { throw bug; }, options), error => error === bug);
  assert.deepEqual(await settleSection(() => { throw { message: "Bad Gateway", code: "" }; }, options), { status: "error" });
});

test("dos lecturas independientes: el fallo de una no altera la otra", async () => {
  const { options } = harness();
  const [towers, shelves] = await Promise.all([
    settleSection(async () => { throw { message: "TypeError: fetch failed", code: "" }; }, options),
    settleSection(async () => summarizeShelves([shelf(1, "A", [true, false, false, false])]), options),
  ]);
  assert.deepEqual(towers, { status: "error" });
  assert.deepEqual(shelves, { status: "ready", data: { estantes: 1, cajas: 4, ocupadas: 1, disponibles: 3, grupos: ["A"] } });
});
