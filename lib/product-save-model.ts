// Product save outcome model (C2a). Pure helpers with no project imports, so they can be tested without a bundler.
//
// supabase-js does not throw on network failures: it returns an error object. A database rejection carries a `code`
// (SQLSTATE or PGRST…); a lost response carries none. Only a rejection proves that the statement was NOT applied; anything
// else is uncertain and must be verified by reading the row again before any destructive cleanup.

export type WriteOutcome = "definitive" | "uncertain";

// Statement-level rejections that roll the statement back: data exception (22), integrity violation (23), invalid
// authorization (28), serialization/deadlock (40), syntax/access rule (42), custom raise from triggers (P0), object state
// (55), query canceled (57014) and PostgREST request/auth errors (PGRST1xx–3xx).
const REJECTION_CODE = /^(?:(?:22|23|28|40|42|55)[0-9A-Z]{3}|P0[0-9A-Z]{3}|57014|PGRST[1-3]\d{2})$/;

export function classifyWriteError(error: unknown): WriteOutcome {
  if (typeof error !== "object" || error === null) return "uncertain";
  const { code } = error as { code?: unknown };
  return typeof code === "string" && REJECTION_CODE.test(code) ? "definitive" : "uncertain";
}

export type ProductRow = {
  id: string;
  nombre: string;
  categoria_id: string;
  descripcion: string | null;
  foto_ruta: string | null;
  actualizado_en: string;
};
export type IntendedProduct = { nombre: string; categoria_id: string; descripcion: string | null; foto_ruta: string | null };
export type ReadBack = { status: "row"; row: ProductRow } | { status: "absent" } | { status: "failed" };

/**
 * - applied: the row proves the write took effect (same data; for an edit also a new `actualizado_en`).
 * - not-applied: the row is still as before the attempt. NOT proof that a request in flight will never land.
 * - conflict: the row exists with other data (another session, or an unexpected row).
 * - unknown: the verification itself failed, or an edited row disappeared.
 */
export type Verdict = "applied" | "not-applied" | "conflict" | "unknown";

const same = (row: ProductRow, intended: IntendedProduct) =>
  row.nombre === intended.nombre && row.categoria_id === intended.categoria_id &&
  (row.descripcion ?? null) === intended.descripcion && (row.foto_ruta ?? null) === intended.foto_ruta;

export function writeVerdict(kind: "create" | "update", read: ReadBack, intended: IntendedProduct, initialUpdatedAt?: string): Verdict {
  if (read.status === "failed") return "unknown";
  if (read.status === "absent") return kind === "create" ? "not-applied" : "unknown";
  if (kind === "create") return same(read.row, intended) ? "applied" : "conflict";
  if (same(read.row, intended) && read.row.actualizado_en !== initialUpdatedAt) return "applied";
  return read.row.actualizado_en === initialUpdatedAt ? "not-applied" : "conflict";
}

/** True when the row currently references `path`: such a file must never be deleted. */
export function referencesPath(read: ReadBack, path: string): boolean {
  return read.status === "row" && read.row.foto_ruta === path;
}

export type RemovalDecision = "remove" | "keep-referenced" | "keep-unverified";

/** Decision for a file that this form uploaded or replaced: delete only with positive evidence it is not referenced. */
export function removalDecision(read: ReadBack, path: string): RemovalDecision {
  if (read.status === "failed") return "keep-unverified";
  return referencesPath(read, path) ? "keep-referenced" : "remove";
}
