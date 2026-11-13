// A5: crea (de forma idempotente) los dos usuarios de prueba del Supabase de STAGING:
//   - usuario AUTORIZADO con el UUID fijo de la cuenta compartida (d5211ae5-39c6-4365-ad35-e6f6bdcc8058), para que las
//     políticas RLS existentes lo reconozcan;
//   - usuario AJENO con UUID aleatorio, que no debe ver ni escribir nada.
// Ambos con email_confirm=true y SIN user_metadata. No cambia contraseñas de usuarios que ya existan.
//
// ESTE SCRIPT NUNCA SE EJECUTÓ CONTRA SUPABASE REAL EN EL BLOQUE QUE LO CREÓ: solo se comprobaron localmente, sin red, sus
// modos de fallo seguro y --dry-run (ver tests/staging/config.local.test.mjs). Lo ejecuta una persona, una vez, contra staging.
//
// Uso (PowerShell; Node >= 22). Las variables van SOLO en el entorno de este proceso; no se leen archivos .env*:
//   $env:STAGING_CONFIRM='ingeagro-v2-staging'
//   $env:STAGING_PROJECT_REF='<ref de 20 caracteres del proyecto de STAGING>'
//   $env:STAGING_URL="https://$($env:STAGING_PROJECT_REF).supabase.co"
//   $env:STAGING_SERVICE_KEY='<clave secreta de servicio de STAGING>'
//   $env:STAGING_AUTORIZADO_EMAIL='...'; $env:STAGING_AUTORIZADO_PASSWORD='<>=16 caracteres>'
//   $env:STAGING_AJENO_EMAIL='...';      $env:STAGING_AJENO_PASSWORD='<>=16 caracteres, distinta>'
//   node scripts/staging/crear-usuarios-prueba.mjs --dry-run   # valida la configuración y NO conecta
//   node scripts/staging/crear-usuarios-prueba.mjs             # crea los usuarios
//   Remove-Item Env:STAGING_SERVICE_KEY                        # al terminar
// Si NEXT_PUBLIC_SUPABASE_URL existe en el entorno y difiere de STAGING_URL, el script aborta (configuración contradictoria).
//
// Orden de seguridad: 1) validar configuración (sin clientes ni red); 2) crear el cliente; 3) leer el marcador
// public.entorno_staging y exigir nombre/project_ref esperados; 4) solo entonces escribir. Nunca imprime claves, contraseñas ni
// tokens: la salida contiene únicamente la ref, correos e ids. Código de salida 0 = todo correcto; 2 = configuración inválida;
// 1 = cualquier otro fallo.
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  UUID_AUTORIZADO,
  describirError,
  validarConfigA5,
  validarMarcador,
} from "../../tests/staging/config.mjs";

const salir = (codigo) => { process.exitCode = codigo; };
const linea = (texto) => console.log(texto);

class Aborto extends Error {}

function noEncontrado(error) {
  return !!error && (error.status === 404 || error.code === "user_not_found");
}

async function buscarPorId(admin, id, secretos) {
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error) {
    if (noEncontrado(error)) return null;
    throw new Aborto(`No se pudo consultar el usuario ${id}: ${describirError(error, secretos)}`);
  }
  return data?.user ?? null;
}

async function buscarPorEmail(admin, email, secretos) {
  const objetivo = email.toLowerCase();
  const porPagina = 200;
  for (let pagina = 1; pagina <= 50; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: porPagina });
    if (error) throw new Aborto(`No se pudo listar usuarios: ${describirError(error, secretos)}`);
    const usuarios = data?.users ?? [];
    const hallado = usuarios.find((u) => typeof u.email === "string" && u.email.toLowerCase() === objetivo);
    if (hallado) return hallado;
    if (usuarios.length < porPagina) return null;
  }
  throw new Aborto("Demasiados usuarios para comprobar el correo del usuario ajeno; abortado por seguridad.");
}

function exigirConfirmado(usuario, etiqueta) {
  if (!usuario.email_confirmed_at) {
    throw new Aborto(`El usuario ${etiqueta} (${usuario.id}) existe pero su correo no está confirmado; revísalo en el panel de staging.`);
  }
}

async function asegurarAutorizado(admin, cfg, secretos) {
  const email = cfg.autorizado.email;
  const validarExistente = (usuario) => {
    if ((usuario.email ?? "").toLowerCase() !== email.toLowerCase()) {
      throw new Aborto(`Ya existe un usuario con el id fijo ${UUID_AUTORIZADO} pero con OTRO correo (${usuario.email}). No se modifica nada.`);
    }
    exigirConfirmado(usuario, "autorizado");
  };

  const existente = await buscarPorId(admin, UUID_AUTORIZADO, secretos);
  if (existente) {
    validarExistente(existente);
    return { creado: false, id: existente.id, email: existente.email };
  }
  const { data, error } = await admin.auth.admin.createUser({
    id: UUID_AUTORIZADO,
    email,
    password: cfg.autorizado.password,
    email_confirm: true,
  });
  if (!error && data?.user) {
    if (data.user.id !== UUID_AUTORIZADO) {
      throw new Aborto(`GoTrue creó el usuario autorizado con un id distinto del solicitado (${data.user.id}); las políticas RLS no lo reconocerían.`);
    }
    return { creado: true, id: data.user.id, email: data.user.email };
  }
  // Comportamiento ante id duplicado no documentado: solo es "ya existe" si una consulta lo confirma con id y correo exactos.
  const trasError = await buscarPorId(admin, UUID_AUTORIZADO, secretos);
  if (trasError) {
    validarExistente(trasError);
    return { creado: false, id: trasError.id, email: trasError.email };
  }
  throw new Aborto(`No se pudo crear el usuario autorizado: ${describirError(error, secretos)}`);
}

async function asegurarAjeno(admin, cfg, secretos) {
  const email = cfg.ajeno.email;
  const validarExistente = (usuario) => {
    if (usuario.id === UUID_AUTORIZADO) {
      throw new Aborto("El correo del usuario ajeno ya pertenece al usuario autorizado; usa correos distintos.");
    }
    exigirConfirmado(usuario, "ajeno");
  };
  const existente = await buscarPorEmail(admin, email, secretos);
  if (existente) {
    validarExistente(existente);
    return { creado: false, id: existente.id, email: existente.email };
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: cfg.ajeno.password,
    email_confirm: true,
  });
  if (!error && data?.user) {
    if (data.user.id === UUID_AUTORIZADO) throw new Aborto("El usuario ajeno recibió el id del usuario autorizado; no puede ocurrir.");
    return { creado: true, id: data.user.id, email: data.user.email };
  }
  const trasError = await buscarPorEmail(admin, email, secretos);
  if (trasError) {
    validarExistente(trasError);
    return { creado: false, id: trasError.id, email: trasError.email };
  }
  throw new Aborto(`No se pudo crear el usuario ajeno: ${describirError(error, secretos)}`);
}

async function principal(argv) {
  const desconocidos = argv.filter((a) => a !== "--dry-run");
  if (desconocidos.length) {
    console.error(`Argumento no reconocido: ${desconocidos.join(" ")}. Solo se admite --dry-run.`);
    return salir(2);
  }
  const dryRun = argv.includes("--dry-run");

  // 1) Configuración: antes de crear cualquier cliente o tocar la red.
  const validacion = validarConfigA5(process.env);
  if (!validacion.ok) {
    console.error("Configuración de staging inválida; no se hizo ninguna petición:");
    for (const error of validacion.errores) console.error(`  - ${error}`);
    return salir(2);
  }
  const cfg = validacion.config;
  const secretos = [cfg.serviceKey, cfg.autorizado.password, cfg.ajeno.password];
  linea(`Configuración válida. Proyecto de staging (ref): ${cfg.projectRef}`);
  if (dryRun) {
    linea("--dry-run: configuración validada; NO se conectó a Supabase ni se creó nada.");
    linea(`Se crearía/verificaría: autorizado ${cfg.autorizado.email} (id fijo ${UUID_AUTORIZADO}); ajeno ${cfg.ajeno.email} (id aleatorio).`);
    return salir(0);
  }

  // 2) Cliente con clave de servicio, sin sesión persistente.
  const admin = createClient(cfg.url, cfg.serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  // 3) Marcador de staging: sin él (o si no coincide) no se escribe nada.
  const marcador = await admin.from("entorno_staging").select("id,nombre,project_ref,creado_en");
  const veredicto = validarMarcador(marcador, cfg);
  if (!veredicto.ok) {
    console.error(`Marcador de staging no válido: ${veredicto.motivo}`);
    if (marcador.error) console.error(`  Detalle: ${describirError(marcador.error, secretos)}`);
    console.error("No se escribió nada.");
    return salir(1);
  }
  linea("Marcador de staging verificado (nombre y project_ref coinciden).");

  // 4) Usuarios.
  const autorizado = await asegurarAutorizado(admin, cfg, secretos);
  const ajeno = await asegurarAjeno(admin, cfg, secretos);
  for (const [rol, resultado] of [["autorizado", autorizado], ["ajeno", ajeno]]) {
    linea(`${resultado.creado ? "CREADO " : "YA EXISTE"} ${rol}: ${resultado.email}  id=${resultado.id}`);
  }
  linea(autorizado.creado || ajeno.creado ? "Listo: usuarios de prueba disponibles." : "Listo: los usuarios ya existían correctamente; no se cambió nada.");
  return salir(0);
}

try {
  await principal(process.argv.slice(2));
} catch (error) {
  // Mensaje controlado: nunca el objeto completo del error (podría contener cabeceras o la clave).
  const mensaje = error instanceof Aborto ? error.message : `Fallo inesperado (${error?.name ?? "Error"}); no se imprimen más detalles para no filtrar secretos.`;
  console.error(`ERROR: ${mensaje}`);
  salir(1);
}
