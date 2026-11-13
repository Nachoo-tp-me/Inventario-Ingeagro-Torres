// A7: suite de ACEPTACIÓN contra un Supabase de STAGING aislado (PostgREST + JWT + Auth + Storage reales).
// Valida lo que el runbook (docs/runbook-despliegue-v2.md §4 y §6) marca como NO validado: forma real de los errores
// (23505, PGRST204, 42501, 40001...), grants por columna, RLS con usuario autorizado, ajeno y anónimo, RPC y Storage privado.
//
// NUNCA SE EJECUTÓ CONTRA SUPABASE REAL EN EL BLOQUE QUE LA CREÓ. Solo se verificaron, sin red, sus modos de fallo seguro
// (tests/staging/config.local.test.mjs). Las expectativas se derivaron de las migraciones y de stock-actions.ts; la primera
// ejecución real puede revelar diferencias y eso es justamente su objetivo.
//
// Cómo se ejecuta (PowerShell, Node >= 22, desde la raíz del repo). Las variables solo existen en ESTE proceso; no se leen .env*:
//   $env:STAGING_CONFIRM='ingeagro-v2-staging'
//   $env:STAGING_PROJECT_REF='<ref de 20 caracteres del proyecto de STAGING>'
//   $env:STAGING_URL="https://$($env:STAGING_PROJECT_REF).supabase.co"
//   $env:STAGING_PUBLISHABLE_KEY='<clave publicable (sb_publishable_...) de STAGING>'
//   $env:STAGING_AUTORIZADO_EMAIL='...'; $env:STAGING_AUTORIZADO_PASSWORD='...'   # usuario con el UUID autorizado (ver A5)
//   $env:STAGING_AJENO_EMAIL='...';      $env:STAGING_AJENO_PASSWORD='...'
//   $env:STAGING_ETAPA='v1' | 'v2-sin-idempotencia' | 'v2' | 'v2-aprovisionado'
//   Remove-Item Env:STAGING_SERVICE_KEY -ErrorAction SilentlyContinue               # NO debe estar presente
//   node --test tests/staging/aceptacion.staging.mjs
//
// Etapas (qué migraciones/datos tiene el proyecto en ese momento):
//   v1                    migraciones hasta 20260930050000 (sin ubicaciones físicas, sin snapshots, sin solicitud_id)
//   v2-sin-idempotencia   además 20261014000000, 20261014010000 y 20261014020000 (sin solicitud_id)
//   v2                    además 20261020000000 (solicitud_id UNIQUE); 0 estantes y 0 cajas
//   v2-aprovisionado      v2 + supabase/provisioning/provision_estantes_cajas.sql (6 estantes, 24 cajas, 96 ubicaciones)
//
// Garantías de seguridad:
//   - Si falta o es contradictoria la configuración, la suite FALLA (no se salta) y no toca la red ni crea clientes.
//   - Solo usa la clave publicable y sesiones normales (signInWithPassword); la presencia de una clave de servicio aborta.
//   - Antes de escribir nada inicia sesión como autorizado, lee public.entorno_staging y exige nombre='ingeagro-v2-staging' y
//     project_ref === STAGING_PROJECT_REF, y comprueba que existen los productos sintéticos PRUEBA (P1..P3). Si algo falla,
//     la suite aborta sin escribir.
//   - Escribe solo con productos sintéticos y cantidades pequeñas, razona por DIFERENCIAS (stock antes/después) y restaura el
//     stock con movimientos inversos en t.after. El historial (movimientos inmutables) conserva las pruebas: es esperable.
//   - Nunca imprime claves, contraseñas, tokens ni URLs firmadas.
// Supuestos sobre los datos de staging (agente 2): marcador public.entorno_staging (id=1); productos P1/P2/P3 con los UUID y
// nombres de abajo; compartimientos de torre C111, C112, C113 y C211 existentes (72 en total); al menos una categoría.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { after, before, describe, it, test } from "node:test";
import { deflateSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { UUID_AUTORIZADO, describirError, redactar, validarConfigA7, validarMarcador } from "./config.mjs";

const P1 = "5e000000-0000-4000-8000-000000000001";
const P2 = "5e000000-0000-4000-8000-000000000002";
const P3 = "5e000000-0000-4000-8000-000000000003";
const NOMBRES = { [P1]: "PRUEBA Sensor ficticio", [P2]: "PRUEBA Motor ficticio", [P3]: "PRUEBA Producto sin stock" };
const BUCKET = "product-images";
const CARPETA = "staging-pruebas";
const TABLAS_BASE = ["categorias", "productos", "torres", "compartimientos", "inventario", "movimientos"];
const TABLAS_V2 = ["estantes", "ubicacion_codigos", "cambios_codigo_ubicacion"];

let SECRETOS = [];
const fmt = (error) => describirError(error, SECRETOS);

// ---------- Utilidades puras ----------

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bloquePng(tipo, datos) {
  const longitud = Buffer.alloc(4);
  longitud.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([longitud, cuerpo, crc]);
}

/** PNG válido de 1x1 píxel (sintético, ~70 bytes). Colores distintos dan bytes distintos. */
function pngMinimo(r, g, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloquePng("IHDR", ihdr),
    bloquePng("IDAT", deflateSync(Buffer.from([0, r, g, b]))),
    bloquePng("IEND", Buffer.alloc(0)),
  ]);
}

// storage-js rellena statusCode con err.statusCode || err.code || status: puede ser un texto («InvalidMimeType»). Solo se usa si es número.
const httpDe = (error) => { const n = Number(error?.statusCode); return Number.isFinite(n) ? n : Number(error?.status); };
const textoError = (error) => `${error?.message ?? ""} ${error?.details ?? ""}`;

function exito(resultado, contexto) {
  if (resultado.error) throw new Error(`${contexto}: ${fmt(resultado.error)}`);
  return resultado.data;
}

/** Lectura denegada = error de permiso (42501 / 401 / 403) o 0 filas por RLS. Cualquier otro error NO es una denegación. */
function lecturaDenegada(resultado) {
  if (resultado.error) return resultado.error.code === "42501" && [401, 403].includes(resultado.status);
  return Array.isArray(resultado.data) && resultado.data.length === 0;
}

function assertDenegado(resultado, contexto) {
  assert.ok(resultado.error, `${contexto}: se esperaba un error de permiso y la operación NO falló (status ${resultado.status}).`);
  assert.equal(resultado.error.code, "42501", `${contexto}: ${fmt(resultado.error)}`);
  assert.ok([401, 403].includes(resultado.status), `${contexto}: status HTTP inesperado ${resultado.status}`);
}

function minimosPorTabla(etapa) {
  const aprovisionado = etapa === "v2-aprovisionado";
  return {
    categorias: [1, Infinity],
    productos: [3, Infinity],
    torres: [1, Infinity],
    compartimientos: aprovisionado ? [96, 96] : [72, 72],
    inventario: [3, Infinity],
    movimientos: [0, Infinity],
    estantes: aprovisionado ? [6, 6] : [0, 0],
    // Cada ejecución en v2-aprovisionado reserva para siempre códigos PRUEBA_… (ubicacion_codigos es inmutable): mínimo 96.
    ubicacion_codigos: aprovisionado ? [96, Infinity] : [72, 72],
    cambios_codigo_ubicacion: [0, Infinity],
  };
}

// ---------- Suite ----------

function registrarSuite(cfg) {
  SECRETOS = [cfg.publishableKey, cfg.autorizado.password, cfg.ajeno.password];
  const etapa = cfg.etapa;
  const V2 = etapa !== "v1";
  const SNAPSHOTS = V2; // codigo_origen/codigo_destino llegan con las migraciones de V2
  const IDEMPOTENCIA = etapa === "v2" || etapa === "v2-aprovisionado";
  const APROVISIONADO = etapa === "v2-aprovisionado";
  const COLUMNAS_MOV = ["id", "producto_id", "tipo", "cantidad", "origen_compartimiento_id", "destino_compartimiento_id"]
    .concat(SNAPSHOTS ? ["codigo_origen", "codigo_destino"] : [])
    .concat(IDEMPOTENCIA ? ["solicitud_id"] : [])
    .join(",");

  const ctx = {
    fatal: null,
    anon: null,
    aut: null,
    aje: null,
    comp: {},
    cajas: [],
    categoriaId: null,
    inventarioInicial: new Map(),
    objetos: new Set(),
  };
  const listo = () => {
    if (ctx.fatal) throw new Error(`Suite abortada antes de escribir: ${ctx.fatal.message}`);
  };
  const intrusos = () => [["ajeno", ctx.aje], ["anónimo", ctx.anon]];

  const nuevoCliente = () => createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // --- acceso a datos ---
  const stockDe = async (producto, ubicacion) => {
    const r = await ctx.aut.from("inventario").select("cantidad").eq("producto_id", producto).eq("compartimiento_id", ubicacion).maybeSingle();
    return exito(r, "leer stock")?.cantidad ?? 0;
  };
  // count exacto (no filas): PostgREST limita las filas devueltas (1000 por defecto) y tras muchas ejecuciones se superaría.
  const contarMovimientos = async (producto) => {
    const r = await ctx.aut.from("movimientos").select("id", { count: "exact", head: true }).eq("producto_id", producto);
    exito(r, "contar movimientos");
    assert.equal(typeof r.count, "number", "PostgREST no devolvió el recuento de movimientos");
    return r.count;
  };
  const insertarMov = (fila) => ctx.aut.from("movimientos").insert(fila).select(COLUMNAS_MOV).single();
  const entrada = (p, destino, n, extra = {}) => ({ producto_id: p, tipo: "entrada", cantidad: n, destino_compartimiento_id: destino, ...extra });
  const retiro = (p, origen, n, extra = {}) => ({ producto_id: p, tipo: "retiro", cantidad: n, origen_compartimiento_id: origen, ...extra });
  const traslado = (p, origen, destino, n, extra = {}) => ({ producto_id: p, tipo: "traslado", cantidad: n, origen_compartimiento_id: origen, destino_compartimiento_id: destino, ...extra });
  const rpcAjuste = (cli, p, ubicacion, fisica, esperada) => cli.rpc("registrar_ajuste_fisico", {
    p_producto_id: p, p_compartimiento_id: ubicacion, p_cantidad_fisica: fisica, p_cantidad_esperada: esperada,
  });
  const rpcRenombrar = (cli, id, esperado, nuevo) => cli.rpc("renombrar_codigo_caja", {
    p_ubicacion_id: id, p_codigo_esperado: esperado, p_codigo_nuevo: nuevo,
  });
  const filaRpc = (data) => (Array.isArray(data) ? data[0] : data);

  /** Registra el stock actual de los pares [producto, ubicación] y lo restaura en t.after con movimientos inversos. */
  const conRestauracion = async (t, pares) => {
    const antes = new Map();
    for (const [p, u] of pares) antes.set(`${p}|${u}`, await stockDe(p, u));
    t.after(async () => {
      for (const [p, u] of pares) {
        const diferencia = (await stockDe(p, u)) - antes.get(`${p}|${u}`);
        if (diferencia > 0) exito(await ctx.aut.from("movimientos").insert(retiro(p, u, diferencia)), "restaurar stock (retiro)");
        if (diferencia < 0) exito(await ctx.aut.from("movimientos").insert(entrada(p, u, -diferencia)), "restaurar stock (entrada)");
        const final = await stockDe(p, u);
        assert.equal(final, antes.get(`${p}|${u}`), "No se pudo restaurar el stock sintético a su valor inicial.");
      }
    });
    return antes;
  };

  const rutaNueva = (extension = "png") => {
    const ruta = `${CARPETA}/${randomUUID()}.${extension}`;
    ctx.objetos.add(ruta);
    return ruta;
  };
  const bucket = (cli) => cli.storage.from(BUCKET);
  const bytesDe = async (blob) => Buffer.from(await blob.arrayBuffer());

  describe(`Aceptación staging (etapa ${etapa}, proyecto ${cfg.projectRef})`, () => {
    // ---- Guardas previas a cualquier escritura ----
    before(async () => {
      try {
        ctx.anon = nuevoCliente();
        ctx.aut = nuevoCliente();
        ctx.aje = nuevoCliente();

        const sesionAut = await ctx.aut.auth.signInWithPassword({ email: cfg.autorizado.email, password: cfg.autorizado.password });
        if (sesionAut.error || !sesionAut.data?.session) throw new Error(`No se pudo iniciar sesión como usuario autorizado: ${fmt(sesionAut.error)}`);
        if (sesionAut.data.user?.id !== UUID_AUTORIZADO) throw new Error("El usuario autorizado no tiene el UUID fijo de la cuenta compartida; las políticas RLS no lo reconocerían (¿se ejecutó A5?).");

        // Marcador: sin él (o si no coincide) no se escribe nada.
        const marcador = await ctx.aut.from("entorno_staging").select("id,nombre,project_ref");
        const veredicto = validarMarcador(marcador, cfg);
        if (!veredicto.ok) throw new Error(`Marcador de staging no válido: ${veredicto.motivo}${marcador.error ? ` (${fmt(marcador.error)})` : ""}`);

        const sesionAje = await ctx.aje.auth.signInWithPassword({ email: cfg.ajeno.email, password: cfg.ajeno.password });
        if (sesionAje.error || !sesionAje.data?.session) throw new Error(`No se pudo iniciar sesión como usuario ajeno: ${fmt(sesionAje.error)}`);
        if (sesionAje.data.user?.id === UUID_AUTORIZADO) throw new Error("El usuario ajeno tiene el UUID autorizado: la prueba de aislamiento no tendría sentido.");

        // Datos sintéticos presentes (si no, probablemente NO es el staging esperado).
        const productos = exito(await ctx.aut.from("productos").select("id,nombre").in("id", [P1, P2, P3]), "leer productos sintéticos");
        for (const id of [P1, P2, P3]) {
          const producto = productos.find((p) => p.id === id);
          if (!producto || producto.nombre !== NOMBRES[id]) throw new Error(`Falta el producto sintético ${NOMBRES[id]} (${id}); cargue supabase/staging/01_datos_sinteticos_v1.sql.`);
        }
        const ubicaciones = exito(await ctx.aut.from("compartimientos").select("id,codigo").in("codigo", ["C111", "C112", "C113", "C211"]), "leer compartimientos");
        for (const u of ubicaciones) ctx.comp[u.codigo] = u.id;
        for (const codigo of ["C111", "C112", "C113", "C211"]) if (!ctx.comp[codigo]) throw new Error(`Falta el compartimiento ${codigo}.`);

        const categorias = exito(await ctx.aut.from("categorias").select("id").limit(1), "leer categorías");
        if (!categorias.length) throw new Error("No hay categorías en staging.");
        ctx.categoriaId = categorias[0].id;

        const inventario = exito(await ctx.aut.from("inventario").select("producto_id,compartimiento_id,cantidad").in("producto_id", [P1, P2, P3]), "leer inventario inicial");
        for (const fila of inventario) ctx.inventarioInicial.set(`${fila.producto_id}|${fila.compartimiento_id}`, fila.cantidad);

        if (APROVISIONADO) {
          ctx.cajas = exito(await ctx.aut.from("compartimientos").select("id,codigo,tipo,estante_id,posicion").eq("tipo", "caja").order("id"), "leer cajas");
          if (ctx.cajas.length < 4) throw new Error("La etapa v2-aprovisionado requiere al menos 4 cajas.");
        }
      } catch (error) {
        ctx.fatal = new Error(redactar(error?.message ?? String(error), SECRETOS));
        throw ctx.fatal;
      }
    });

    after(async () => {
      // Limpieza final de Storage: todo lo subido por esta ejecución, aunque un test haya fallado a medias.
      if (!ctx.aut || ctx.objetos.size === 0) return;
      const rutas = [...ctx.objetos];
      const borrado = await bucket(ctx.aut).remove(rutas);
      if (borrado.error) throw new Error(`No se pudo limpiar Storage: ${fmt(borrado.error)}`);
      const restantes = await bucket(ctx.aut).list(CARPETA, { limit: 1000 });
      if (restantes.error) throw new Error(`No se pudo verificar la limpieza de Storage: ${fmt(restantes.error)}`);
      const nombres = new Set((restantes.data ?? []).map((o) => `${CARPETA}/${o.name}`));
      const huerfanos = rutas.filter((r) => nombres.has(r));
      assert.equal(huerfanos.length, 0, `Quedaron ${huerfanos.length} objetos de prueba en Storage.`);
    });

    // ---- 1. Auth real ----
    describe("1. Auth real", () => {
      it("login correcto del usuario autorizado y del ajeno", (t) => {
        listo();
        t.diagnostic(`etapa ${etapa}: V2=${V2} snapshots=${SNAPSHOTS} idempotencia=${IDEMPOTENCIA} aprovisionado=${APROVISIONADO}`);
        // Las sesiones se abrieron en before(); aquí se comprueba que son utilizables.
        return Promise.all([ctx.aut.auth.getSession(), ctx.aje.auth.getSession()]).then(([a, b]) => {
          assert.ok(a.data.session?.access_token, "El usuario autorizado no tiene sesión.");
          assert.ok(b.data.session?.access_token, "El usuario ajeno no tiene sesión.");
          assert.equal(a.data.session.user.id, UUID_AUTORIZADO);
          assert.notEqual(b.data.session.user.id, UUID_AUTORIZADO);
        });
      });

      it("contraseña incorrecta rechazada con invalid_credentials (400)", async () => {
        listo();
        const cliente = nuevoCliente();
        const r = await cliente.auth.signInWithPassword({ email: cfg.ajeno.email, password: `${randomBytes(12).toString("hex")}Zz!` });
        assert.ok(r.error, "Se aceptó una contraseña incorrecta.");
        assert.equal(r.error.code, "invalid_credentials", fmt(r.error));
        assert.equal(r.error.status, 400, fmt(r.error));
        assert.equal(r.data?.session ?? null, null);
      });

      it("signUp público rechazado (signup deshabilitado)", async () => {
        listo();
        const cliente = nuevoCliente();
        // Correo VÁLIDO y controlado: subdirección (+signup-…) del buzón del usuario ajeno. Supabase valida el formato y el
        // dominio ANTES de comprobar si el registro está permitido: con @example.invalid devolvía email_address_invalid y la
        // prueba no demostraba nada sobre el registro. Solo se acepta signup_disabled.
        const [local, dominio] = cfg.ajeno.email.split("@");
        const email = `${local.split("+")[0]}+signup-${randomUUID().slice(0, 8)}@${dominio}`;
        const r = await cliente.auth.signUp({ email, password: `${randomBytes(16).toString("hex")}Aa1!` });
        assert.ok(r.error, "signUp NO fue rechazado: el registro público está habilitado (se pudo crear un usuario).");
        assert.equal(r.error.code, "signup_disabled", fmt(r.error));
        assert.ok([403, 422].includes(r.error.status), fmt(r.error));
        assert.equal(r.data?.session ?? null, null);
        assert.equal(r.data?.user ?? null, null);
      });
    });

    // ---- 1b. Marcador y etapa ----
    describe("1b. Marcador de staging y forma del esquema por etapa", () => {
      it("ajeno y anónimo no ven el marcador", async () => {
        listo();
        for (const [nombre, cli] of intrusos()) {
          const r = await cli.from("entorno_staging").select("*").limit(5);
          assert.ok(lecturaDenegada(r), `${nombre} ve el marcador de staging o recibe un error inesperado: ${fmt(r.error)}`);
        }
      });

      if (!V2) {
        it("v1: las tablas de V2 no existen", async () => {
          listo();
          for (const tabla of TABLAS_V2) {
            const r = await ctx.aut.from(tabla).select("*").limit(1);
            assert.ok(r.error, `La tabla ${tabla} existe en etapa v1.`);
            assert.ok(["PGRST205", "42P01"].includes(r.error.code), `${tabla}: ${fmt(r.error)}`);
          }
        });
      }
    });

    // ---- 2. RLS lectura ----
    describe("2. RLS de lectura", () => {
      const tablas = V2 ? [...TABLAS_BASE, ...TABLAS_V2] : TABLAS_BASE;
      const limites = minimosPorTabla(etapa);
      for (const tabla of tablas) {
        it(`${tabla}: el autorizado lee; ajeno y anónimo no ven filas`, async () => {
          listo();
          const propio = await ctx.aut.from(tabla).select("*").limit(1000);
          assert.ok(!propio.error, `El autorizado no puede leer ${tabla}: ${fmt(propio.error)}`);
          const [minimo, maximo] = limites[tabla];
          assert.ok(propio.data.length >= minimo && propio.data.length <= maximo,
            `${tabla}: el autorizado ve ${propio.data.length} filas; se esperaban entre ${minimo} y ${maximo} en la etapa ${etapa}.`);
          for (const [nombre, cli] of intrusos()) {
            const r = await cli.from(tabla).select("*").limit(5);
            assert.ok(lecturaDenegada(r), `${nombre} NO está denegado en ${tabla} (${r.error ? fmt(r.error) : `${r.data?.length} filas`}).`);
          }
        });
      }
    });

    // ---- 3. RLS escritura y grants por columna ----
    describe("3. RLS de escritura y permisos por columna", () => {
      for (const [nombre, obtener] of [["ajeno", () => ctx.aje], ["anónimo", () => ctx.anon]]) {
        it(`${nombre}: no puede insertar movimientos, productos ni categorías, ni insertar en inventario`, async () => {
          listo();
          const cli = obtener();
          const antes = await stockDe(P1, ctx.comp.C112);
          assertDenegado(await cli.from("movimientos").insert(entrada(P1, ctx.comp.C112, 1)), `${nombre}: insert movimientos`);
          assertDenegado(await cli.from("productos").insert({ nombre: `PRUEBA RLS ${randomUUID()}`, categoria_id: ctx.categoriaId }), `${nombre}: insert productos`);
          assertDenegado(await cli.from("categorias").insert({ nombre: `PRUEBA RLS ${randomUUID()}` }), `${nombre}: insert categorias`);
          assertDenegado(await cli.from("inventario").insert({ producto_id: P3, compartimiento_id: ctx.comp.C113, cantidad: 1 }), `${nombre}: insert inventario`);
          assert.equal(await stockDe(P1, ctx.comp.C112), antes, "El stock cambió tras intentos de escritura no autorizados.");
        });

        it(`${nombre}: no puede llamar registrar_ajuste_fisico${V2 ? " ni renombrar_codigo_caja" : ""}`, async () => {
          listo();
          const cli = obtener();
          const actual = await stockDe(P1, ctx.comp.C112);
          assertDenegado(await rpcAjuste(cli, P1, ctx.comp.C112, actual + 1, actual), `${nombre}: rpc registrar_ajuste_fisico`);
          if (V2) assertDenegado(await rpcRenombrar(cli, ctx.comp.C111, "C111", `PRUEBA_${randomBytes(4).toString("hex").toUpperCase()}`), `${nombre}: rpc renombrar_codigo_caja`);
          assert.equal(await stockDe(P1, ctx.comp.C112), actual);
        });
      }

      it("ajeno: no puede modificar productos (RLS filtra: 0 filas) y la descripción no cambia", async (t) => {
        listo();
        const original = exito(await ctx.aut.from("productos").select("descripcion").eq("id", P3).single(), "leer descripción").descripcion;
        t.after(async () => {
          const actual = exito(await ctx.aut.from("productos").select("descripcion").eq("id", P3).single(), "releer descripción").descripcion;
          if (actual !== original) exito(await ctx.aut.from("productos").update({ descripcion: original }).eq("id", P3), "restaurar descripción");
        });
        for (const [nombre, cli] of intrusos()) {
          const r = await cli.from("productos").update({ descripcion: "HACK-RLS" }).eq("id", P3).select("id");
          if (r.error) assertDenegado(r, `${nombre}: update productos`);
          else assert.equal(r.data.length, 0, `${nombre} modificó ${r.data.length} producto(s).`);
        }
        assert.equal(exito(await ctx.aut.from("productos").select("descripcion").eq("id", P3).single(), "verificar descripción").descripcion, original);
      });

      it("autorizado: puede editar columnas concedidas de productos (ida y vuelta de descripción)", async (t) => {
        listo();
        const original = exito(await ctx.aut.from("productos").select("descripcion").eq("id", P3).single(), "leer descripción").descripcion;
        t.after(async () => {
          exito(await ctx.aut.from("productos").update({ descripcion: original }).eq("id", P3), "restaurar descripción");
        });
        const nueva = `PRUEBA ${randomUUID()}`;
        const r = await ctx.aut.from("productos").update({ descripcion: nueva }).eq("id", P3).select("id,descripcion");
        assert.ok(!r.error, fmt(r.error));
        assert.equal(r.data.length, 1);
        assert.equal(r.data[0].descripcion, nueva);
      });

      it("autorizado: columnas NO concedidas rechazadas (movimientos.fecha, productos.id/creado_en, codigos snapshot)", async (t) => {
        listo();
        await conRestauracion(t, [[P1, ctx.comp.C112]]);
        assertDenegado(await ctx.aut.from("movimientos").insert(entrada(P1, ctx.comp.C112, 1, { fecha: "2020-01-01T00:00:00Z" })), "insert movimientos con fecha");
        if (SNAPSHOTS) assertDenegado(await ctx.aut.from("movimientos").insert(entrada(P1, ctx.comp.C112, 1, { codigo_destino: "C112" })), "insert movimientos con codigo_destino");
        assertDenegado(await ctx.aut.from("productos").update({ id: randomUUID() }).eq("id", randomUUID()), "update productos.id");
        assertDenegado(await ctx.aut.from("productos").update({ creado_en: "2020-01-01T00:00:00Z" }).eq("id", randomUUID()), "update productos.creado_en");
        assertDenegado(await ctx.aut.from("productos").insert({ nombre: `PRUEBA ${randomUUID()}`, categoria_id: ctx.categoriaId, creado_en: "2020-01-01T00:00:00Z" }), "insert productos con creado_en");
      });

      it("autorizado: no puede insertar un ajuste directo ni modificar o borrar movimientos", async (t) => {
        listo();
        await conRestauracion(t, [[P1, ctx.comp.C112]]);
        const directo = await ctx.aut.from("movimientos").insert({ producto_id: P1, tipo: "ajuste", cantidad: 1, destino_compartimiento_id: ctx.comp.C112 });
        assertDenegado(directo, "insert directo de tipo ajuste (debe pasar por la RPC)");
        assertDenegado(await ctx.aut.from("movimientos").update({ cantidad: 1 }).eq("id", -1), "update movimientos");
        assertDenegado(await ctx.aut.from("movimientos").delete().eq("id", -1), "delete movimientos");
      });

      it("autorizado: inventario no admite insert, update ni delete", async () => {
        listo();
        // Filtros sobre P3/ids inexistentes: aunque un grant erróneo existiera, no se alteraría stock real.
        assertDenegado(await ctx.aut.from("inventario").insert({ producto_id: P3, compartimiento_id: ctx.comp.C113, cantidad: 1 }), "insert inventario");
        assertDenegado(await ctx.aut.from("inventario").update({ cantidad: 999 }).eq("producto_id", P3), "update inventario");
        assertDenegado(await ctx.aut.from("inventario").delete().eq("producto_id", P3), "delete inventario");
      });

      if (V2) {
        it("autorizado: las tablas de ubicaciones solo se leen (compartimientos, ubicacion_codigos, estantes)", async () => {
          listo();
          assertDenegado(await ctx.aut.from("compartimientos").update({ codigo: "PRUEBA_UPD" }).eq("id", -1), "update compartimientos");
          assertDenegado(await ctx.aut.from("compartimientos").delete().eq("id", -1), "delete compartimientos");
          assertDenegado(await ctx.aut.from("ubicacion_codigos").insert({ codigo: `PRUEBA_${randomBytes(4).toString("hex").toUpperCase()}`, compartimiento_id: ctx.comp.C111 }), "insert ubicacion_codigos");
          assertDenegado(await ctx.aut.from("estantes").insert({ id: 6 }), "insert estantes");
        });

        it("autorizado: renombrar_codigo_caja valida entradas (C123 reservado a torres, solo cajas)", async () => {
          listo();
          const nuevo = `PRUEBA_${randomBytes(4).toString("hex").toUpperCase()}`;
          const reservado = await rpcRenombrar(ctx.aut, ctx.comp.C111, "C111", "C123");
          assert.ok(reservado.error, "C123 fue aceptado como código de caja.");
          assert.equal(reservado.error.code, "22023", fmt(reservado.error));
          const torre = await rpcRenombrar(ctx.aut, ctx.comp.C111, "C111", nuevo);
          assert.ok(torre.error, "Se pudo renombrar un compartimiento de torre.");
          assert.equal(torre.error.code, "22023", fmt(torre.error));
          const vacio = await rpcRenombrar(ctx.aut, ctx.comp.C111, "C111", "  ");
          assert.ok(vacio.error, "Se aceptó un código vacío.");
          assert.equal(vacio.error.code, "22023", fmt(vacio.error));
        });
      }
    });

    // ---- 4. Movimientos ----
    describe("4. Movimientos y ajustes (autorizado, productos sintéticos, restaurados por diferencias)", () => {
      it("entrada suma stock y compatible con V1 (sin solicitud_id)", async (t) => {
        listo();
        const antes = await conRestauracion(t, [[P1, ctx.comp.C112]]);
        const r = await insertarMov(entrada(P1, ctx.comp.C112, 2));
        assert.ok(!r.error, fmt(r.error));
        assert.equal(r.data.tipo, "entrada");
        assert.equal(r.data.cantidad, 2);
        assert.equal(await stockDe(P1, ctx.comp.C112), antes.get(`${P1}|${ctx.comp.C112}`) + 2);
        if (SNAPSHOTS) {
          assert.equal(r.data.codigo_destino, "C112", "codigo_destino no se capturó");
          assert.equal(r.data.codigo_origen, null);
        }
        if (IDEMPOTENCIA) assert.equal(r.data.solicitud_id, null, "sin solicitud_id debe quedar NULL");
      });

      it("retiro resta stock; retirar más de lo existente falla con 23514 y no cambia nada", async (t) => {
        listo();
        const antes = await conRestauracion(t, [[P1, ctx.comp.C112]]);
        const base = antes.get(`${P1}|${ctx.comp.C112}`);
        exito(await ctx.aut.from("movimientos").insert(entrada(P1, ctx.comp.C112, 1)), "entrada previa");
        const r = await insertarMov(retiro(P1, ctx.comp.C112, 1));
        assert.ok(!r.error, fmt(r.error));
        if (SNAPSHOTS) {
          assert.equal(r.data.codigo_origen, "C112");
          assert.equal(r.data.codigo_destino, null);
        }
        assert.equal(await stockDe(P1, ctx.comp.C112), base);
        const exceso = await ctx.aut.from("movimientos").insert(retiro(P1, ctx.comp.C112, base + 1000));
        assert.ok(exceso.error, "Un retiro mayor que el stock fue aceptado.");
        assert.equal(exceso.error.code, "23514", fmt(exceso.error));
        assert.equal(await stockDe(P1, ctx.comp.C112), base);
      });

      it("traslado mueve stock entre compartimientos; origen = destino rechazado (23514)", async (t) => {
        listo();
        const pares = [[P1, ctx.comp.C112], [P1, ctx.comp.C111]];
        const antes = await conRestauracion(t, pares);
        const origen = antes.get(`${P1}|${ctx.comp.C112}`);
        const destino = antes.get(`${P1}|${ctx.comp.C111}`);
        exito(await ctx.aut.from("movimientos").insert(entrada(P1, ctx.comp.C112, 1)), "entrada previa");
        const r = await insertarMov(traslado(P1, ctx.comp.C112, ctx.comp.C111, 1));
        assert.ok(!r.error, fmt(r.error));
        if (SNAPSHOTS) {
          assert.equal(r.data.codigo_origen, "C112");
          assert.equal(r.data.codigo_destino, "C111");
        }
        assert.equal(await stockDe(P1, ctx.comp.C112), origen);
        assert.equal(await stockDe(P1, ctx.comp.C111), destino + 1);
        const mismo = await ctx.aut.from("movimientos").insert(traslado(P1, ctx.comp.C111, ctx.comp.C111, 1));
        assert.ok(mismo.error, "Un traslado al mismo compartimiento fue aceptado.");
        assert.equal(mismo.error.code, "23514", fmt(mismo.error));
        assert.equal(await stockDe(P1, ctx.comp.C111), destino + 1);
      });

      it("producto sin stock: la entrada crea la fila y el retiro total la elimina", async (t) => {
        listo();
        await conRestauracion(t, [[P3, ctx.comp.C113]]);
        exito(await ctx.aut.from("movimientos").insert(entrada(P3, ctx.comp.C113, 2)), "entrada");
        assert.equal(await stockDe(P3, ctx.comp.C113), 2);
        exito(await ctx.aut.from("movimientos").insert(retiro(P3, ctx.comp.C113, 2)), "retiro total");
        const fila = await ctx.aut.from("inventario").select("cantidad").eq("producto_id", P3).eq("compartimiento_id", ctx.comp.C113).maybeSingle();
        assert.ok(!fila.error, fmt(fila.error));
        assert.equal(fila.data, null, "La fila de inventario en cero no se eliminó.");
      });

      it("movimiento con cantidad 0 o producto inexistente rechazado con código definitivo", async () => {
        listo();
        const cero = await ctx.aut.from("movimientos").insert(entrada(P1, ctx.comp.C112, 0));
        assert.ok(cero.error);
        assert.equal(cero.error.code, "23514", fmt(cero.error));
        const inexistente = await ctx.aut.from("movimientos").insert(entrada(randomUUID(), ctx.comp.C112, 1));
        assert.ok(inexistente.error);
        assert.equal(inexistente.error.code, "23503", fmt(inexistente.error));
      });

      it("ajuste con cantidad esperada correcta (RPC): sube, baja y sin diferencia no registra movimiento", async (t) => {
        listo();
        const antes = await conRestauracion(t, [[P1, ctx.comp.C112]]);
        const actual = antes.get(`${P1}|${ctx.comp.C112}`);
        const movimientosAntes = await contarMovimientos(P1);

        const sube = await rpcAjuste(ctx.aut, P1, ctx.comp.C112, actual + 1, actual);
        assert.ok(!sube.error, fmt(sube.error));
        assert.equal(typeof sube.data, "number", "La RPC debe devolver el id del movimiento");
        assert.equal(await stockDe(P1, ctx.comp.C112), actual + 1);
        const mov = exito(await ctx.aut.from("movimientos").select("tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id").eq("id", sube.data).single(), "leer ajuste");
        assert.equal(mov.tipo, "ajuste");
        assert.equal(mov.cantidad, 1);
        assert.equal(mov.destino_compartimiento_id, ctx.comp.C112);
        assert.equal(mov.origen_compartimiento_id, null);

        const baja = await rpcAjuste(ctx.aut, P1, ctx.comp.C112, actual, actual + 1);
        assert.ok(!baja.error, fmt(baja.error));
        assert.equal(typeof baja.data, "number");
        assert.equal(await stockDe(P1, ctx.comp.C112), actual);

        const igual = await rpcAjuste(ctx.aut, P1, ctx.comp.C112, actual, actual);
        assert.ok(!igual.error, fmt(igual.error));
        assert.equal(igual.data, null, "Un ajuste sin diferencia no debe devolver movimiento");
        assert.equal(await contarMovimientos(P1), movimientosAntes + 2, "Solo los dos ajustes con diferencia deben haber creado movimientos");
      });

      it("ajuste con cantidad esperada desactualizada: PT409 (HTTP 409) inmediato, sin reintentos, y stock intacto", async (t) => {
        listo();
        const antes = await conRestauracion(t, [[P1, ctx.comp.C112]]);
        const actual = antes.get(`${P1}|${ctx.comp.C112}`);
        const movimientosAntes = await contarMovimientos(P1);
        const inicio = Date.now();
        const r = await rpcAjuste(ctx.aut, P1, ctx.comp.C112, actual + 5, actual + 3);
        const ms = Date.now() - inicio;
        assert.ok(r.error, "Se aceptó un ajuste con cantidad esperada desactualizada.");
        // 40001 hacía que PostgREST 14 reintentara en bucle hasta «upstream request timeout» (~126 s, 12-nov-2026).
        assert.equal(r.error.code, "PT409", fmt(r.error));
        assert.equal(r.status, 409, fmt(r.error));
        assert.ok(ms < 15000, `El conflicto tardó ${ms} ms: indicio de reintentos de PostgREST.`);
        assert.equal(await stockDe(P1, ctx.comp.C112), actual);
        assert.equal(await contarMovimientos(P1), movimientosAntes);
      });

      it("ajuste con datos inválidos (22023) o referencias inexistentes (23503)", async () => {
        listo();
        const negativo = await rpcAjuste(ctx.aut, P1, ctx.comp.C112, -1, 0);
        assert.ok(negativo.error);
        assert.equal(negativo.error.code, "22023", fmt(negativo.error));
        const producto = await rpcAjuste(ctx.aut, randomUUID(), ctx.comp.C112, 1, 0);
        assert.ok(producto.error);
        assert.equal(producto.error.code, "23503", fmt(producto.error));
        const ubicacion = await rpcAjuste(ctx.aut, P1, -1, 1, 0);
        assert.ok(ubicacion.error);
        assert.equal(ubicacion.error.code, "23503", fmt(ubicacion.error));
      });

      if (APROVISIONADO) {
        it("traslado torre ↔ caja y entrada en caja capturan los códigos actuales", async (t) => {
          listo();
          const caja = ctx.cajas[3];
          await conRestauracion(t, [[P1, ctx.comp.C112], [P1, caja.id]]);
          exito(await ctx.aut.from("movimientos").insert(entrada(P1, ctx.comp.C112, 1)), "entrada previa");
          const ida = await insertarMov(traslado(P1, ctx.comp.C112, caja.id, 1));
          assert.ok(!ida.error, fmt(ida.error));
          assert.equal(ida.data.codigo_origen, "C112");
          assert.equal(ida.data.codigo_destino, caja.codigo);
          const vuelta = await insertarMov(traslado(P1, caja.id, ctx.comp.C112, 1));
          assert.ok(!vuelta.error, fmt(vuelta.error));
          assert.equal(vuelta.data.codigo_origen, caja.codigo);
          assert.equal(vuelta.data.codigo_destino, "C112");
        });
      }
    });

    // ---- 5. Etapas sin idempotencia ----
    if (!IDEMPOTENCIA) {
      describe("5. Sin migración de idempotencia: solicitud_id incompatible", () => {
        it("insert con solicitud_id falla (PGRST204 o 42703 con solicitud_id) y el stock no cambia", async (t) => {
          listo();
          const antes = await conRestauracion(t, [[P1, ctx.comp.C112]]);
          const r = await ctx.aut.from("movimientos").insert(entrada(P1, ctx.comp.C112, 1, { solicitud_id: randomUUID() }));
          assert.ok(r.error, "El insert con solicitud_id fue aceptado en una base SIN la migración de idempotencia.");
          t.diagnostic(`Error real observado (clave para stock-actions.ts): ${fmt(r.error)} http=${r.status}`);
          const compatible = r.error.code === "PGRST204" || (r.error.code === "42703" && /solicitud_id/.test(textoError(r.error)));
          assert.ok(compatible, `Código no contemplado por stock-actions.ts: ${fmt(r.error)}`);
          assert.match(textoError(r.error), /solicitud_id/, "El mensaje debería nombrar solicitud_id");
          assert.equal(await stockDe(P1, ctx.comp.C112), antes.get(`${P1}|${ctx.comp.C112}`));
        });
      });
    }

    // ---- 6. Idempotencia ----
    if (IDEMPOTENCIA) {
      describe("6. Idempotencia por solicitud_id", () => {
        it("misma solicitud_id dos veces: la segunda es 23505 con solicitud_id y el stock se aplica UNA vez", async (t) => {
          listo();
          const antes = await conRestauracion(t, [[P1, ctx.comp.C112]]);
          const base = antes.get(`${P1}|${ctx.comp.C112}`);
          const sid = randomUUID();
          const primera = await insertarMov(entrada(P1, ctx.comp.C112, 1, { solicitud_id: sid }));
          assert.ok(!primera.error, fmt(primera.error));
          assert.equal(primera.data.solicitud_id, sid);
          const segunda = await ctx.aut.from("movimientos").insert(entrada(P1, ctx.comp.C112, 1, { solicitud_id: sid }));
          assert.ok(segunda.error, "La segunda inserción con la misma solicitud_id fue aceptada.");
          t.diagnostic(`Duplicado real: ${fmt(segunda.error)} http=${segunda.status}`);
          assert.equal(segunda.error.code, "23505", fmt(segunda.error));
          // Mismo criterio que stock-actions.ts: el texto del error nombra solicitud_id.
          assert.match(textoError(segunda.error), /solicitud_id/);
          assert.equal(await stockDe(P1, ctx.comp.C112), base + 1, "El stock se aplicó más de una vez");
          const guardados = exito(await ctx.aut.from("movimientos").select("producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id,fecha").eq("solicitud_id", sid), "releer movimiento");
          assert.equal(guardados.length, 1, "Debe existir exactamente un movimiento con esa solicitud_id");
          assert.equal(guardados[0].producto_id, P1);
          assert.equal(guardados[0].cantidad, 1);
          assert.equal(guardados[0].destino_compartimiento_id, ctx.comp.C112);
        });

        it("misma solicitud_id con otros datos: 23505 y el movimiento guardado no cambia", async (t) => {
          listo();
          const antes = await conRestauracion(t, [[P1, ctx.comp.C112], [P2, ctx.comp.C211]]);
          const sid = randomUUID();
          exito(await ctx.aut.from("movimientos").insert(entrada(P1, ctx.comp.C112, 1, { solicitud_id: sid })), "primera inserción");
          const otraCantidad = await ctx.aut.from("movimientos").insert(entrada(P1, ctx.comp.C112, 2, { solicitud_id: sid }));
          const otroProducto = await ctx.aut.from("movimientos").insert(entrada(P2, ctx.comp.C211, 1, { solicitud_id: sid }));
          for (const r of [otraCantidad, otroProducto]) {
            assert.ok(r.error, "Se aceptó reutilizar la solicitud_id con otros datos.");
            assert.equal(r.error.code, "23505", fmt(r.error));
            assert.match(textoError(r.error), /solicitud_id/);
          }
          assert.equal(await stockDe(P1, ctx.comp.C112), antes.get(`${P1}|${ctx.comp.C112}`) + 1);
          assert.equal(await stockDe(P2, ctx.comp.C211), antes.get(`${P2}|${ctx.comp.C211}`));
          const guardado = exito(await ctx.aut.from("movimientos").select("producto_id,cantidad").eq("solicitud_id", sid).single(), "releer movimiento");
          assert.equal(guardado.producto_id, P1);
          assert.equal(guardado.cantidad, 1);
        });

        for (const concurrentes of [2, 5]) {
          it(`${concurrentes} inserciones concurrentes con el mismo UUID: exactamente una tiene éxito`, async (t) => {
            listo();
            const antes = await conRestauracion(t, [[P1, ctx.comp.C112]]);
            const sid = randomUUID();
            const resultados = await Promise.all(Array.from({ length: concurrentes }, () => insertarMov(entrada(P1, ctx.comp.C112, 1, { solicitud_id: sid }))));
            const exitosos = resultados.filter((r) => !r.error);
            const fallidos = resultados.filter((r) => r.error);
            assert.equal(exitosos.length, 1, `Éxitos: ${exitosos.length}; errores: ${fallidos.map((r) => fmt(r.error)).join(" | ")}`);
            for (const r of fallidos) {
              assert.equal(r.error.code, "23505", fmt(r.error));
              assert.match(textoError(r.error), /solicitud_id/);
            }
            assert.equal(await stockDe(P1, ctx.comp.C112), antes.get(`${P1}|${ctx.comp.C112}`) + 1, "El stock debe aumentar una sola vez");
          });
        }

        it("insert sin solicitud_id (compatibilidad V1) funciona, queda con NULL y no colisiona entre sí", async (t) => {
          listo();
          const antes = await conRestauracion(t, [[P1, ctx.comp.C112]]);
          const a = await insertarMov(entrada(P1, ctx.comp.C112, 1));
          const b = await insertarMov(entrada(P1, ctx.comp.C112, 1));
          assert.ok(!a.error, fmt(a.error));
          assert.ok(!b.error, fmt(b.error));
          assert.equal(a.data.solicitud_id, null);
          assert.equal(b.data.solicitud_id, null);
          assert.notEqual(a.data.id, b.data.id);
          assert.equal(await stockDe(P1, ctx.comp.C112), antes.get(`${P1}|${ctx.comp.C112}`) + 2);
        });

        it("solicitud_id que no es UUID: 22P02 y sin cambios de stock", async (t) => {
          listo();
          const antes = await conRestauracion(t, [[P1, ctx.comp.C112]]);
          const r = await ctx.aut.from("movimientos").insert(entrada(P1, ctx.comp.C112, 1, { solicitud_id: "no-es-un-uuid" }));
          assert.ok(r.error);
          assert.equal(r.error.code, "22P02", fmt(r.error));
          assert.equal(await stockDe(P1, ctx.comp.C112), antes.get(`${P1}|${ctx.comp.C112}`));
        });

        it("solicitud_id tampoco permite al ajeno ni al anónimo registrar movimientos", async () => {
          listo();
          for (const [nombre, cli] of intrusos()) {
            assertDenegado(await cli.from("movimientos").insert(entrada(P1, ctx.comp.C112, 1, { solicitud_id: randomUUID() })), `${nombre}: insert con solicitud_id`);
          }
        });
      });
    }

    // ---- 7. Storage ----
    describe("7. Storage privado (product-images)", () => {
      it("autorizado: subir, firmar y descargar, rechazar duplicado, reemplazar con upsert y borrar", async (t) => {
        listo();
        const ruta = rutaNueva();
        t.after(async () => { await bucket(ctx.aut).remove([ruta]); });
        const original = pngMinimo(200, 10, 10);
        const nuevo = pngMinimo(10, 200, 10);

        exito(await bucket(ctx.aut).upload(ruta, original, { contentType: "image/png" }), "subir PNG");

        const firma = await bucket(ctx.aut).createSignedUrl(ruta, 60);
        assert.ok(!firma.error, fmt(firma.error));
        assert.ok(firma.data.signedUrl.startsWith(`${cfg.url}/storage/v1/object/sign/${BUCKET}/`), "La URL firmada no apunta al Storage del proyecto de staging.");
        const respuesta = await fetch(firma.data.signedUrl);
        assert.equal(respuesta.status, 200, "La URL firmada no sirve el objeto");
        assert.match(respuesta.headers.get("content-type") ?? "", /^image\/png/);
        assert.ok(Buffer.from(await respuesta.arrayBuffer()).equals(original), "El contenido descargado difiere del subido");

        const duplicado = await bucket(ctx.aut).upload(ruta, nuevo, { contentType: "image/png" });
        assert.ok(duplicado.error, "Subir sobre un objeto existente sin upsert debería fallar");
        assert.equal(httpDe(duplicado.error), 409, fmt(duplicado.error));

        exito(await bucket(ctx.aut).upload(ruta, nuevo, { contentType: "image/png", upsert: true }), "reemplazar con upsert");
        const descarga = exito(await bucket(ctx.aut).download(ruta), "descargar tras reemplazar");
        assert.ok((await bytesDe(descarga)).equals(nuevo), "El reemplazo no cambió el contenido");

        const borrado = await bucket(ctx.aut).remove([ruta]);
        assert.ok(!borrado.error, fmt(borrado.error));
        assert.equal(borrado.data.length, 1, "No se borró el objeto");

        // 12-nov-2026: la descarga normal (GET /object/<bucket>/<ruta>) siguió devolviendo el archivo justo después de
        // borrarlo. Esa ruta pasa por la caché del CDN de Storage, que guarda la respuesta POR USUARIO y puede servirla sin
        // volver a preguntar a Storage hasta que caduque. Por eso la existencia real se comprueba contra el ORIGEN:
        // 1) el listado (POST, no se cachea) ya no contiene el objeto;
        const barra = ruta.lastIndexOf("/");
        const nombre = ruta.slice(barra + 1);
        const listado = await bucket(ctx.aut).list(ruta.slice(0, barra), { search: nombre });
        assert.ok(!listado.error, fmt(listado.error));
        assert.equal((listado.data ?? []).filter((o) => o.name === nombre).length, 0, "El objeto sigue en el listado tras borrarlo: eliminación incompleta");
        // 2) no se puede firmar una URL nueva (POST al origen);
        const firmaTras = await bucket(ctx.aut).createSignedUrl(ruta, 60);
        assert.ok(firmaTras.error || !firmaTras.data?.signedUrl, "Se firmó una URL de un objeto borrado");
        // 3) una descarga con cacheNonce único (otra clave de caché: va al origen) falla. Se reintenta hasta ~75 s por si la
        //    invalidación del CDN tarda en propagarse (Supabase documenta hasta 60 s).
        let sinCache = null;
        let intentos = 0;
        for (; intentos < 16; intentos++) {
          sinCache = await bucket(ctx.aut).download(ruta, { cacheNonce: randomUUID() });
          if (sinCache.error) break;
          await esperar(5000);
        }
        assert.ok(sinCache.error, "El origen sigue sirviendo el objeto borrado incluso evitando la caché: eliminación incompleta");
        t.diagnostic(`descarga con cacheNonce tras borrar: rechazada tras ${intentos} reintentos (${fmt(sinCache.error)})`);
        // 4) la caché no se comparte: el ajeno y el anónimo no obtienen el objeto borrado por la ruta normal.
        for (const [quien, cli] of intrusos()) {
          const intento = await bucket(cli).download(ruta);
          assert.ok(intento.error, `${quien}: descargó un objeto borrado de un bucket privado (caché compartida)`);
        }
        // Informativo: estado de la descarga normal del propio autorizado (puede seguir en la caché del CDN hasta su TTL).
        const token = (await ctx.aut.auth.getSession()).data.session?.access_token;
        const normal = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${ruta}`, { headers: { Authorization: `Bearer ${token}`, apikey: cfg.publishableKey } });
        t.diagnostic(`descarga normal del autorizado tras borrar: HTTP ${normal.status}, cf-cache-status=${normal.headers.get("cf-cache-status") ?? "-"}, age=${normal.headers.get("age") ?? "-"}, cache-control=${normal.headers.get("cache-control") ?? "-"}`);
        await normal.arrayBuffer().catch(() => {});
      });

      it("ajeno y anónimo no pueden listar, descargar, firmar, subir, reemplazar ni borrar", async (t) => {
        listo();
        const ruta = rutaNueva();
        const contenido = pngMinimo(30, 30, 200);
        t.after(async () => { await bucket(ctx.aut).remove([ruta]); });
        exito(await bucket(ctx.aut).upload(ruta, contenido, { contentType: "image/png" }), "subida previa");
        const nombreObjeto = ruta.slice(CARPETA.length + 1);
        const permitidos = [400, 401, 403, 404];

        for (const [nombre, cli] of intrusos()) {
          const lista = await bucket(cli).list(CARPETA, { limit: 100 });
          if (lista.error) assert.ok(permitidos.includes(httpDe(lista.error)), `${nombre} list: ${fmt(lista.error)}`);
          else assert.ok(!lista.data.some((o) => o.name === nombreObjeto), `${nombre} puede listar el objeto`);

          const descarga = await bucket(cli).download(ruta);
          assert.ok(descarga.error, `${nombre} pudo descargar el objeto`);
          assert.ok(permitidos.includes(httpDe(descarga.error)), `${nombre} download: ${fmt(descarga.error)}`);

          const firma = await bucket(cli).createSignedUrl(ruta, 60);
          assert.ok(firma.error || !firma.data?.signedUrl, `${nombre} pudo firmar una URL`);

          const subida = await bucket(cli).upload(rutaNueva(), pngMinimo(1, 1, 1), { contentType: "image/png" });
          assert.ok(subida.error, `${nombre} pudo subir un objeto`);
          assert.ok(permitidos.includes(httpDe(subida.error)), `${nombre} upload: ${fmt(subida.error)}`);

          const reemplazo = await bucket(cli).upload(ruta, pngMinimo(2, 2, 2), { contentType: "image/png", upsert: true });
          assert.ok(reemplazo.error, `${nombre} pudo reemplazar el objeto`);
          assert.ok(permitidos.includes(httpDe(reemplazo.error)), `${nombre} upsert: ${fmt(reemplazo.error)}`);

          const borrado = await bucket(cli).remove([ruta]);
          assert.ok(borrado.error || borrado.data.length === 0, `${nombre} pudo borrar el objeto`);
        }
        const intacto = exito(await bucket(ctx.aut).download(ruta), "descargar tras intentos ajenos");
        assert.ok((await bytesDe(intacto)).equals(contenido), "El objeto cambió o desapareció tras intentos no autorizados");
      });

      it("la URL pública no sirve el objeto (bucket privado)", async (t) => {
        listo();
        const ruta = rutaNueva();
        t.after(async () => { await bucket(ctx.aut).remove([ruta]); });
        exito(await bucket(ctx.aut).upload(ruta, pngMinimo(90, 90, 90), { contentType: "image/png" }), "subida previa");
        const publica = bucket(ctx.anon).getPublicUrl(ruta).data.publicUrl;
        const respuesta = await fetch(publica);
        const tipo = respuesta.headers.get("content-type") ?? "";
        await respuesta.arrayBuffer();
        assert.ok(!respuesta.ok, `La URL pública sirvió el objeto (status ${respuesta.status}): el bucket NO es privado.`);
        assert.ok(!/^image\//.test(tipo), "La URL pública devolvió una imagen");
        const autenticada = await fetch(`${cfg.url}/storage/v1/object/authenticated/${BUCKET}/${ruta}`);
        await autenticada.arrayBuffer();
        assert.ok(!autenticada.ok, `La ruta autenticada respondió ${autenticada.status} sin credenciales`);
      });

      it("tipo no permitido (text/plain) y archivos mayores de 5 MB rechazados", async () => {
        listo();
        const texto = rutaNueva("txt");
        const r1 = await bucket(ctx.aut).upload(texto, Buffer.from("prueba de texto plano"), { contentType: "text/plain" });
        assert.ok(r1.error, "Se aceptó text/plain en un bucket solo de imágenes");
        assert.ok([400, 415].includes(httpDe(r1.error)), `text/plain: ${fmt(r1.error)}`);

        const grande = rutaNueva();
        const r2 = await bucket(ctx.aut).upload(grande, Buffer.alloc(5 * 1024 * 1024 + 1), { contentType: "image/png" });
        assert.ok(r2.error, "Se aceptó un archivo de más de 5 MB");
        assert.ok([400, 413].includes(httpDe(r2.error)), `>5 MB: ${fmt(r2.error)}`);

        const lista = exito(await bucket(ctx.aut).list(CARPETA, { limit: 1000 }), "listar tras rechazos");
        for (const ruta of [texto, grande]) assert.ok(!lista.some((o) => `${CARPETA}/${o.name}` === ruta), `El objeto rechazado ${ruta} quedó guardado`);
      });
    });

    // ---- 8. Estantes, cajas y renombrado ----
    if (APROVISIONADO) {
      describe("8. Estantes, cajas y renombrado de códigos (v2-aprovisionado)", () => {
        it("6 estantes, 24 cajas (4 por estante) y 96 ubicacion_codigos", async () => {
          listo();
          const estantes = exito(await ctx.aut.from("estantes").select("id").order("id"), "leer estantes");
          assert.deepEqual(estantes.map((e) => e.id), [1, 2, 3, 4, 5, 6]);
          assert.equal(ctx.cajas.length, 24);
          for (const estante of estantes) assert.equal(ctx.cajas.filter((c) => c.estante_id === estante.id).length, 4, `El estante ${estante.id} no tiene 4 cajas`);
          const codigos = exito(await ctx.aut.from("ubicacion_codigos").select("codigo").limit(1000), "leer códigos");
          assert.ok(codigos.length >= 96, `Se esperaban al menos 96 códigos registrados y hay ${codigos.length}`);
          const total = exito(await ctx.aut.from("compartimientos").select("id").limit(1000), "contar ubicaciones");
          assert.equal(total.length, 96);
        });

        it("renombrar a PRUEBA_… y devolver al original: el código antiguo sigue registrado y se audita", async (t) => {
          listo();
          const caja = ctx.cajas[0];
          const original = caja.codigo;
          const temporal = `PRUEBA_${randomBytes(4).toString("hex").toUpperCase()}`;
          t.after(async () => {
            const actual = exito(await ctx.aut.from("compartimientos").select("codigo").eq("id", caja.id).single(), "releer caja").codigo;
            if (actual !== original) exito(await rpcRenombrar(ctx.aut, caja.id, actual, original), "devolver la caja a su código original");
          });

          const ida = await rpcRenombrar(ctx.aut, caja.id, original, temporal);
          assert.ok(!ida.error, fmt(ida.error));
          const filaIda = filaRpc(ida.data);
          assert.equal(filaIda.codigo, temporal);
          assert.equal(filaIda.sin_cambios, false);
          assert.equal(filaIda.ubicacion_id, caja.id);
          assert.equal(exito(await ctx.aut.from("compartimientos").select("codigo").eq("id", caja.id).single(), "releer caja").codigo, temporal);

          const registrados = exito(await ctx.aut.from("ubicacion_codigos").select("codigo,compartimiento_id").eq("compartimiento_id", caja.id), "leer códigos de la caja").map((r) => r.codigo);
          assert.ok(registrados.includes(original), "El código antiguo dejó de estar en ubicacion_codigos");
          assert.ok(registrados.includes(temporal), "El código nuevo no se registró en ubicacion_codigos");

          const vuelta = await rpcRenombrar(ctx.aut, caja.id, temporal, original);
          assert.ok(!vuelta.error, fmt(vuelta.error));
          assert.equal(filaRpc(vuelta.data).codigo, original);
          const despues = exito(await ctx.aut.from("ubicacion_codigos").select("codigo").eq("compartimiento_id", caja.id), "releer códigos").map((r) => r.codigo);
          assert.ok(despues.includes(temporal) && despues.includes(original), "Los códigos históricos deben conservarse");

          const cambios = exito(await ctx.aut.from("cambios_codigo_ubicacion").select("codigo_anterior,codigo_nuevo,actor_id").eq("compartimiento_id", caja.id), "leer auditoría");
          assert.ok(cambios.some((c) => c.codigo_anterior === original && c.codigo_nuevo === temporal && c.actor_id === UUID_AUTORIZADO), "Falta la auditoría original → temporal");
          assert.ok(cambios.some((c) => c.codigo_anterior === temporal && c.codigo_nuevo === original), "Falta la auditoría temporal → original");
        });

        it("renombrar: sin cambios, código esperado desactualizado (PT409 inmediato), C123 (22023) y código ajeno (23505)", async () => {
          listo();
          const caja = ctx.cajas[0];
          const otra = ctx.cajas[1];
          const cambiosAntes = exito(await ctx.aut.from("cambios_codigo_ubicacion").select("id").eq("compartimiento_id", caja.id), "contar auditoría").length;

          const igual = await rpcRenombrar(ctx.aut, caja.id, caja.codigo, caja.codigo);
          assert.ok(!igual.error, fmt(igual.error));
          assert.equal(filaRpc(igual.data).sin_cambios, true);

          const inicio = Date.now();
          const viejo = await rpcRenombrar(ctx.aut, caja.id, `NOEXISTE_${randomBytes(3).toString("hex").toUpperCase()}`, `PRUEBA_${randomBytes(4).toString("hex").toUpperCase()}`);
          const ms = Date.now() - inicio;
          assert.ok(viejo.error, "Se aceptó un código esperado desactualizado");
          assert.equal(viejo.error.code, "PT409", fmt(viejo.error));
          assert.equal(viejo.status, 409, fmt(viejo.error));
          assert.ok(ms < 15000, `El conflicto tardó ${ms} ms: indicio de reintentos de PostgREST.`);

          const reservado = await rpcRenombrar(ctx.aut, caja.id, caja.codigo, "C123");
          assert.ok(reservado.error, "C123 fue aceptado");
          assert.equal(reservado.error.code, "22023", fmt(reservado.error));

          const colision = await rpcRenombrar(ctx.aut, caja.id, caja.codigo, otra.codigo);
          assert.ok(colision.error, "Se aceptó el código de otra caja");
          assert.equal(colision.error.code, "23505", fmt(colision.error));

          assert.equal(exito(await ctx.aut.from("compartimientos").select("codigo").eq("id", caja.id).single(), "releer caja").codigo, caja.codigo);
          const cambiosDespues = exito(await ctx.aut.from("cambios_codigo_ubicacion").select("id").eq("compartimiento_id", caja.id), "recontar auditoría").length;
          assert.equal(cambiosDespues, cambiosAntes, "Los intentos rechazados no deben dejar auditoría");
        });

        it("los movimientos conservan el código vigente en el momento del movimiento tras renombrar la caja", async (t) => {
          listo();
          const caja = ctx.cajas[2];
          const original = caja.codigo;
          const temporal = `PRUEBA_${randomBytes(4).toString("hex").toUpperCase()}`;
          t.after(async () => {
            const actual = exito(await ctx.aut.from("compartimientos").select("codigo").eq("id", caja.id).single(), "releer caja").codigo;
            if (actual !== original) exito(await rpcRenombrar(ctx.aut, caja.id, actual, original), "devolver la caja a su código original");
          });
          await conRestauracion(t, [[P3, caja.id]]);

          const mov1 = await insertarMov(entrada(P3, caja.id, 1));
          assert.ok(!mov1.error, fmt(mov1.error));
          assert.equal(mov1.data.codigo_destino, original);
          exito(await rpcRenombrar(ctx.aut, caja.id, original, temporal), "renombrar la caja");
          const mov2 = await insertarMov(retiro(P3, caja.id, 1));
          assert.ok(!mov2.error, fmt(mov2.error));
          assert.equal(mov2.data.codigo_origen, temporal, "El retiro posterior debe capturar el código nuevo");
          const relectura = exito(await ctx.aut.from("movimientos").select("codigo_destino").eq("id", mov1.data.id).single(), "releer primer movimiento");
          assert.equal(relectura.codigo_destino, original, "El movimiento anterior no debe cambiar su código histórico");
        });
      });
    }

    // ---- Cierre ----
    describe("9. Cierre: sin rastros en el stock y lectura de historial/auditoría", () => {
      it("el stock sintético quedó exactamente como al empezar", async () => {
        listo();
        const filas = exito(await ctx.aut.from("inventario").select("producto_id,compartimiento_id,cantidad").in("producto_id", [P1, P2, P3]), "leer inventario final");
        const final = new Map(filas.map((f) => [`${f.producto_id}|${f.compartimiento_id}`, f.cantidad]));
        assert.deepEqual([...final.entries()].sort(), [...ctx.inventarioInicial.entries()].sort());
      });

      it("movimientos: el autorizado ve el historial creado y ajeno/anónimo siguen sin ver filas", async () => {
        listo();
        const propio = exito(await ctx.aut.from("movimientos").select("id").limit(5), "leer movimientos");
        assert.ok(propio.length > 0, "El autorizado no ve los movimientos que acaba de crear");
        for (const [nombre, cli] of intrusos()) {
          const r = await cli.from("movimientos").select("id").limit(5);
          assert.ok(lecturaDenegada(r), `${nombre} ve movimientos: ${r.error ? fmt(r.error) : r.data?.length}`);
        }
      });

      if (APROVISIONADO) {
        it("cambios_codigo_ubicacion: el autorizado ve la auditoría y ajeno/anónimo no", async () => {
          listo();
          const propio = exito(await ctx.aut.from("cambios_codigo_ubicacion").select("id").limit(5), "leer auditoría");
          assert.ok(propio.length > 0, "No hay auditoría de renombrados tras las pruebas");
          for (const [nombre, cli] of intrusos()) {
            const r = await cli.from("cambios_codigo_ubicacion").select("id").limit(5);
            assert.ok(lecturaDenegada(r), `${nombre} ve la auditoría de códigos`);
          }
        });
      }
    });
  });
}

// ---------- Punto de entrada: la configuración se valida ANTES de crear cualquier cliente ----------

const validacion = validarConfigA7(process.env);
if (!validacion.ok) {
  test("configuración de staging inválida o ausente: la suite se niega a ejecutarse (sin red)", () => {
    assert.fail(
      `Configuración de staging inválida; no se creó ningún cliente ni se hizo ninguna petición.\n${validacion.errores.map((e) => `  - ${e}`).join("\n")}\n`
      + "Consulta la cabecera de tests/staging/aceptacion.staging.mjs para la lista de variables.",
    );
  });
} else {
  registrarSuite(validacion.config);
}
