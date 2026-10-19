import assert from "node:assert/strict";
import test from "node:test";
import { DESKTOP_LINKS, MOBILE_LINKS, isDesktopActive, isMobileActive, matchesSegment, sectionLabel } from "../lib/navigation-model.ts";

test("coincidencia por segmentos reales de ruta", () => {
  assert.equal(matchesSegment("/torres", "/torres"), true);
  assert.equal(matchesSegment("/torres/C1", "/torres"), true);
  assert.equal(matchesSegment("/torresX", "/torres"), false);
  assert.equal(matchesSegment("/productos-viejos", "/productos"), false);
  assert.equal(matchesSegment("/", "/"), true);
  assert.equal(matchesSegment("/torres", "/"), false);
});

test("escritorio: Torres y Estantes independientes y /ubicaciones sin entrada activa", () => {
  const active = pathname => DESKTOP_LINKS.filter(link => isDesktopActive(pathname, link.href)).map(link => link.href);
  assert.deepEqual(active("/torres/C2"), ["/torres"]);
  assert.deepEqual(active("/estantes/3"), ["/estantes"]);
  assert.deepEqual(active("/ubicaciones"), []);
  assert.deepEqual(active("/exportaciones"), ["/exportaciones"]);
  assert.deepEqual(active("/carga/ubicacion/73"), ["/carga"]);
  assert.deepEqual(active("/"), ["/"]);
});

test("móvil: cinco destinos y Ubicaciones agrupa /ubicaciones, /torres y /estantes", () => {
  assert.equal(MOBILE_LINKS.length, 5);
  const active = pathname => MOBILE_LINKS.filter(link => isMobileActive(pathname, link.href)).map(link => link.href);
  for (const pathname of ["/ubicaciones", "/torres", "/torres/C1", "/estantes", "/estantes/6"]) assert.deepEqual(active(pathname), ["/ubicaciones"], pathname);
  assert.deepEqual(active("/exportaciones"), []);
  assert.deepEqual(active("/productos/nuevo"), ["/productos"]);
  assert.deepEqual(active("/estantesX"), []);
});

test("etiqueta contextual por sección con respaldo general", () => {
  const cases = { "/": "Inicio", "/torres/C1": "Torres", "/estantes": "Estantes", "/ubicaciones": "Ubicaciones", "/productos/nuevo": "Productos",
    "/carga": "Carga rápida", "/historial": "Historial", "/exportaciones": "Exportaciones", "/otra-ruta": "Inventario" };
  for (const [pathname, label] of Object.entries(cases)) assert.equal(sectionLabel(pathname), label, pathname);
});
