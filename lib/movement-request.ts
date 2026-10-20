// Identity of a logical stock movement request (C2b). Pure helpers with no project imports.
//
// A request id (UUID) is generated ONCE per logical operation and reused only for retries of that same operation while its
// outcome is unconfirmed. The database (UNIQUE movimientos.solicitud_id) is what actually prevents a second movement; this
// module only decides when an id is reused and when it is discarded. It never uses localStorage/sessionStorage.

export const UNCERTAIN_RETRY_MESSAGE = "No pudimos confirmar el movimiento. Puedes reintentar: si ya se registró, no se duplicará.";
export const ALREADY_REGISTERED_MESSAGE = "Este movimiento ya estaba registrado; no se duplicó.";
export const REUSED_REQUEST_MESSAGE = "Esta solicitud ya se usó con otros datos. Revisa el Historial antes de volver a intentarlo.";
export const SCHEMA_MISMATCH_MESSAGE = "El sistema todavía no está preparado para registrar este movimiento. Avisa a la persona administradora.";
export const INVALID_REQUEST_MESSAGE = "No se pudo identificar la solicitud. Actualiza la página e inténtalo de nuevo.";
export const NO_SECURE_ID_MESSAGE = "Este navegador no puede generar identificadores seguros, así que el movimiento está bloqueado. Usa otro navegador o una conexión segura (HTTPS).";
export const ABANDON_UNCERTAIN_MESSAGE = "El resultado del movimiento anterior no se confirmó. Si sales ahora, revisa el Historial antes de volver a operar.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Lower-cased canonical UUID, or null when the value is not a valid UUID. */
export function normalizeSolicitudId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  return UUID.test(lower) ? lower : null;
}

type RandomSource = { randomUUID?: () => string; getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T };

/**
 * Cryptographically secure UUID v4: `crypto.randomUUID()` when available, otherwise built from `crypto.getRandomValues`
 * (plain-HTTP LAN origins have no randomUUID). Never Math.random(): when no secure source exists it returns null and the
 * caller must block the operation.
 */
export function secureUuid(source: RandomSource | undefined = globalThis.crypto): string | null {
  if (!source) return null;
  if (typeof source.randomUUID === "function") {
    try { return source.randomUUID(); } catch { /* fall back to getRandomValues */ }
  }
  if (typeof source.getRandomValues !== "function") return null;
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type MovementFingerprintInput = { tipo: string; productoId: string; origenId?: number; destinoId?: number; cantidad?: number };

/** Everything that defines the logical operation. If any part changes, it is another operation and needs another id. */
export function movementFingerprint(input: MovementFingerprintInput): string {
  return [input.tipo, input.productoId, input.origenId ?? "", input.destinoId ?? "", input.cantidad ?? ""].join("|");
}

export type IdentityStore = {
  /** Id for this logical operation: the retained one only if the fingerprint is unchanged, otherwise a new one. null = no secure source. */
  acquire(fingerprint: string): string | null;
  /** Definitive outcome (success, deduplicated or definitive error): the identity is discarded before anything else can reuse it. */
  release(): void;
  /** True while an attempt keeps an id whose outcome is unconfirmed. */
  readonly retained: boolean;
};

export function createIdentityStore(generate: () => string | null = () => secureUuid()): IdentityStore {
  let current: { id: string; fingerprint: string } | null = null;
  return {
    acquire(fingerprint) {
      if (current && current.fingerprint === fingerprint) return current.id;
      const id = generate();
      if (!id) { current = null; return null; }
      current = { id, fingerprint };
      return id;
    },
    release() { current = null; },
    get retained() { return current !== null; },
  };
}

const DATE_FORMAT = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" });
/** Same date format as the Historial (America/Santiago). */
export function formatMovementDate(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : DATE_FORMAT.format(date);
}
