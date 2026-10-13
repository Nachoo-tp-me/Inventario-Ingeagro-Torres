import assert from "node:assert/strict";
import test from "node:test";
import { createSearchMetadataCache } from "../lib/search-metadata-cache.ts";

test("B3: reutiliza la instantánea y comparte una sola carga entre búsquedas concurrentes", async () => {
  let loads = 0;
  let finish;
  const cache = createSearchMetadataCache(15_000, () => 0);
  const load = () => { loads++; return new Promise(resolve => { finish = resolve; }); };
  const a = cache(load);
  const b = cache(load);
  await Promise.resolve();
  assert.equal(loads, 1);
  const rows = [{ id: "fake", nombre: "Módulo térmico" }];
  finish(rows);
  assert.equal(await a, rows);
  assert.equal(await b, rows);
  assert.equal(await cache(load), rows);
  assert.equal(loads, 1);
});

test("B3: el plazo empieza al completar la carga y se renueva solo bajo demanda", async () => {
  let clock = 0;
  let loads = 0;
  const cache = createSearchMetadataCache(15_000, () => clock);
  const load = async () => { loads++; clock += 300; return loads; };
  assert.equal(await cache(load), 1);
  clock = 15_299;
  assert.equal(await cache(load), 1);
  clock = 15_300;
  assert.equal(await cache(load), 2);
  assert.equal(loads, 2);
});

test("B3: no almacena fallos ni devuelve una instantánea vencida al fallar la renovación", async () => {
  let clock = 0;
  const cache = createSearchMetadataCache(10, () => clock);
  await assert.rejects(cache(async () => { throw new Error("fictitious failure"); }), /fictitious/);
  assert.equal(await cache(async () => "first"), "first");
  clock = 10;
  await assert.rejects(cache(async () => { throw new Error("refresh failure"); }), /refresh/);
  assert.equal(await cache(async () => "second"), "second");
});
