// Validación PURA de la configuración de staging (sin red, sin lectura de .env*, sin crear clientes Supabase).
// La usan scripts/staging/crear-usuarios-prueba.mjs y tests/staging/aceptacion.staging.mjs. Recibe el objeto de entorno por
// parámetro (normalmente process.env) y devuelve { ok, errores, config }. Los mensajes de error nombran las VARIABLES, nunca
// sus valores: ninguna clave, contraseña ni URL completa sale de este módulo.
//
// Reglas comunes:
//   STAGING_CONFIRM            exactamente 'ingeagro-v2-staging'
//   STAGING_PROJECT_REF        ^[a-z0-9]{20}$
//   STAGING_URL                exactamente https://<STAGING_PROJECT_REF>.supabase.co (sin barra final ni ruta)
//   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL: si existen (no vacías) deben ser idénticas a STAGING_URL; si no, configuración
//                              contradictoria y se aborta (evita apuntar por error a producción).
//   Usuarios                   STAGING_AUTORIZADO_EMAIL/PASSWORD y STAGING_AJENO_EMAIL/PASSWORD; emails distintos (sin
//                              distinguir mayúsculas) y contraseñas distintas de al menos 16 caracteres.
// Reglas de A5 (crear usuarios): STAGING_SERVICE_KEY obligatoria; no puede ser publicable ni igual a STAGING_PUBLISHABLE_KEY.
// Reglas de A7 (aceptación): STAGING_PUBLISHABLE_KEY obligatoria, nunca 'sb_secret_'; STAGING_SERVICE_KEY NO debe existir en el
//                              entorno (las pruebas jamás usan la clave de servicio); STAGING_ETAPA en ETAPAS.

export const CONFIRMACION = "ingeagro-v2-staging";
export const UUID_AUTORIZADO = "d5211ae5-39c6-4365-ad35-e6f6bdcc8058";
export const ETAPAS = Object.freeze(["v1", "v2-sin-idempotencia", "v2", "v2-aprovisionado"]);
export const MIN_PASSWORD = 16;

const REF = /^[a-z0-9]{20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLANCOS = /\s/;

const presente = (valor) => typeof valor === "string" && valor !== "";

/** Decodifica (SIN verificar firma) el payload de una clave JWT heredada; { tipo: 'otra' } si no parece un JWT. */
export function inspeccionarClave(clave) {
  if (typeof clave !== "string") return { tipo: "ausente" };
  if (clave.startsWith("sb_publishable_")) return { tipo: "publishable" };
  if (clave.startsWith("sb_secret_")) return { tipo: "secret" };
  const partes = clave.split(".");
  if (partes.length === 3 && partes[0].startsWith("eyJ")) {
    try {
      const payload = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
      return { tipo: "jwt", role: payload.role, ref: payload.ref };
    } catch {
      return { tipo: "otra" };
    }
  }
  return { tipo: "otra" };
}

function validarComun(env, errores) {
  if (env.STAGING_CONFIRM !== CONFIRMACION) errores.push(`STAGING_CONFIRM debe ser exactamente '${CONFIRMACION}'.`);

  const ref = env.STAGING_PROJECT_REF;
  const refValida = typeof ref === "string" && REF.test(ref);
  if (!refValida) errores.push("STAGING_PROJECT_REF debe cumplir ^[a-z0-9]{20}$.");

  const url = env.STAGING_URL;
  let urlValida = false;
  if (!presente(url)) {
    errores.push("Falta STAGING_URL (no hay valor por defecto).");
  } else if (!refValida) {
    errores.push("No se puede validar STAGING_URL sin un STAGING_PROJECT_REF válido.");
  } else if (url !== `https://${ref}.supabase.co`) {
    errores.push("STAGING_URL debe ser exactamente https://<STAGING_PROJECT_REF>.supabase.co (sin barra final ni ruta).");
  } else {
    urlValida = true;
  }

  // Configuración contradictoria: ninguna otra URL de Supabase presente en el entorno puede diferir de STAGING_URL.
  for (const nombre of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) {
    const otra = env[nombre];
    if (presente(otra) && otra !== url) {
      errores.push(`${nombre} está definida y es distinta de STAGING_URL: configuración contradictoria (posible apuntado a otro proyecto).`);
    }
  }
  return { ref: refValida ? ref : null, url: urlValida ? url : null };
}

function validarUsuarios(env, errores) {
  const nombres = ["STAGING_AUTORIZADO_EMAIL", "STAGING_AUTORIZADO_PASSWORD", "STAGING_AJENO_EMAIL", "STAGING_AJENO_PASSWORD"];
  for (const n of nombres) if (!presente(env[n])) errores.push(`Falta ${n}.`);
  for (const n of ["STAGING_AUTORIZADO_EMAIL", "STAGING_AJENO_EMAIL"]) {
    if (presente(env[n]) && !EMAIL.test(env[n])) errores.push(`${n} no parece un correo válido.`);
  }
  for (const n of ["STAGING_AUTORIZADO_PASSWORD", "STAGING_AJENO_PASSWORD"]) {
    if (presente(env[n]) && env[n].length < MIN_PASSWORD) errores.push(`${n} debe tener al menos ${MIN_PASSWORD} caracteres.`);
  }
  if (presente(env.STAGING_AUTORIZADO_EMAIL) && presente(env.STAGING_AJENO_EMAIL)
    && env.STAGING_AUTORIZADO_EMAIL.toLowerCase() === env.STAGING_AJENO_EMAIL.toLowerCase()) {
    errores.push("STAGING_AUTORIZADO_EMAIL y STAGING_AJENO_EMAIL deben ser distintos.");
  }
  if (presente(env.STAGING_AUTORIZADO_PASSWORD) && env.STAGING_AUTORIZADO_PASSWORD === env.STAGING_AJENO_PASSWORD) {
    errores.push("Las contraseñas de los dos usuarios deben ser distintas.");
  }
  return {
    autorizado: { email: env.STAGING_AUTORIZADO_EMAIL, password: env.STAGING_AUTORIZADO_PASSWORD },
    ajeno: { email: env.STAGING_AJENO_EMAIL, password: env.STAGING_AJENO_PASSWORD },
  };
}

function validarFormaClave(nombre, clave, ref, rolEsperado, errores) {
  if (BLANCOS.test(clave)) errores.push(`${nombre} contiene espacios o saltos de línea.`);
  const info = inspeccionarClave(clave);
  if (info.tipo === "jwt") {
    if (info.role !== rolEsperado) errores.push(`${nombre} es una clave JWT con un rol distinto de '${rolEsperado}'.`);
    if (ref && info.ref && info.ref !== ref) errores.push(`${nombre} pertenece a otro proyecto (ref distinta de STAGING_PROJECT_REF).`);
  }
  return info;
}

/** A5: crear usuarios de prueba (usa la clave de servicio). */
export function validarConfigA5(env) {
  const errores = [];
  const { ref, url } = validarComun(env, errores);
  const usuarios = validarUsuarios(env, errores);
  const servicio = env.STAGING_SERVICE_KEY;
  if (!presente(servicio)) {
    errores.push("Falta STAGING_SERVICE_KEY.");
  } else {
    if (servicio.startsWith("sb_publishable_")) errores.push("STAGING_SERVICE_KEY es una clave publicable ('sb_publishable_'); se requiere la clave secreta de servicio.");
    if (presente(env.STAGING_PUBLISHABLE_KEY) && servicio === env.STAGING_PUBLISHABLE_KEY) errores.push("STAGING_SERVICE_KEY no puede ser igual a STAGING_PUBLISHABLE_KEY.");
    validarFormaClave("STAGING_SERVICE_KEY", servicio, ref, "service_role", errores);
  }
  if (errores.length) return { ok: false, errores, config: null };
  return { ok: true, errores: [], config: { projectRef: ref, url, serviceKey: servicio, ...usuarios } };
}

/** A7: aceptación contra staging (solo clave publicable y sesiones normales). */
export function validarConfigA7(env) {
  const errores = [];
  const { ref, url } = validarComun(env, errores);
  const usuarios = validarUsuarios(env, errores);
  const publicable = env.STAGING_PUBLISHABLE_KEY;
  if (!presente(publicable)) {
    errores.push("Falta STAGING_PUBLISHABLE_KEY.");
  } else {
    if (publicable.startsWith("sb_secret_")) errores.push("STAGING_PUBLISHABLE_KEY es una clave secreta ('sb_secret_'); las pruebas solo usan la clave publicable.");
    validarFormaClave("STAGING_PUBLISHABLE_KEY", publicable, ref, "anon", errores);
  }
  for (const nombre of ["STAGING_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (presente(env[nombre])) errores.push(`${nombre} está presente en el entorno: las pruebas de aceptación nunca usan una clave de servicio. Quítala del entorno de este proceso.`);
  }
  const etapa = env.STAGING_ETAPA;
  if (!ETAPAS.includes(etapa)) errores.push(`STAGING_ETAPA debe ser una de: ${ETAPAS.join(", ")}.`);
  if (errores.length) return { ok: false, errores, config: null };
  return { ok: true, errores: [], config: { projectRef: ref, url, publishableKey: publicable, etapa, ...usuarios } };
}

/**
 * Comprueba el marcador de staging ya leído (resultado de select sobre public.entorno_staging).
 * Exige exactamente una fila id=1, nombre='ingeagro-v2-staging' y project_ref === config.projectRef.
 */
export function validarMarcador(resultado, config) {
  if (!resultado || resultado.error) return { ok: false, motivo: "No se pudo leer public.entorno_staging (¿no es un entorno de staging marcado?)." };
  const filas = resultado.data;
  if (!Array.isArray(filas) || filas.length !== 1) return { ok: false, motivo: "public.entorno_staging debe devolver exactamente una fila." };
  const fila = filas[0];
  if (Number(fila.id) !== 1) return { ok: false, motivo: "El marcador de staging no tiene id=1." };
  if (fila.nombre !== CONFIRMACION) return { ok: false, motivo: `El marcador no tiene nombre='${CONFIRMACION}'.` };
  if (fila.project_ref !== config.projectRef) return { ok: false, motivo: "El project_ref del marcador no coincide con STAGING_PROJECT_REF: el proyecto no es el esperado." };
  return { ok: true, motivo: "" };
}

/** Sustituye secretos conocidos y patrones de claves/tokens/URL firmadas. */
export function redactar(texto, secretos = []) {
  let salida = String(texto ?? "");
  for (const secreto of secretos) {
    if (typeof secreto === "string" && secreto.length >= 4) salida = salida.split(secreto).join("[REDACTADO]");
  }
  salida = salida
    .replace(/https?:\/\/[^\s"']*token=[^\s"']*/gi, "[URL-FIRMADA]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[JWT]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[CLAVE]")
    .replace(/(token|apikey|authorization)=\S+/gi, "$1=[REDACTADO]");
  return salida.length > 500 ? `${salida.slice(0, 500)}…` : salida;
}

/** Texto seguro de un error de Supabase/Storage: solo campos conocidos (nunca headers, cause ni el objeto completo). */
export function describirError(error, secretos = []) {
  if (!error) return "(sin error)";
  const partes = [];
  for (const campo of ["name", "code", "status", "statusCode"]) {
    const valor = error[campo];
    if (valor !== undefined && valor !== null && valor !== "") partes.push(`${campo}=${valor}`);
  }
  for (const campo of ["message", "details", "hint"]) {
    if (typeof error[campo] === "string" && error[campo]) partes.push(`${campo}=${error[campo]}`);
  }
  return redactar(partes.join(" ") || "(error sin detalles)", secretos);
}
