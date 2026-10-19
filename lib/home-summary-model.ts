import type { DashboardSummary } from "./inventory.ts";
import type { ShelfSummary } from "./shelf-model.ts";

// Pure model for the Home summaries. Totals come from the data sources, never from constants,
// and a failed read is a distinct state: it can never be turned into a zero.

export type SectionResult<T> = { status: "ready"; data: T } | { status: "error" };

export type TowersView = { torres: number; compartimientos: number; ocupados: number; disponibles: number; productos: number };
export type ShelvesView = { estantes: number; cajas: number; ocupadas: number; disponibles: number; grupos: string[] };

export function summarizeTowers(summary: DashboardSummary): TowersView {
  return { torres: summary.torres.length, compartimientos: summary.total, ocupados: summary.ocupados, disponibles: summary.disponibles, productos: summary.productos };
}

export function summarizeShelves(shelves: ShelfSummary[]): ShelvesView {
  const boxes = shelves.flatMap(shelf => shelf.cajas);
  const occupied = boxes.filter(box => box.ocupado).length;
  return { estantes: shelves.length, cajas: boxes.length, ocupadas: occupied, disponibles: boxes.length - occupied,
    grupos: [...new Set(shelves.map(shelf => shelf.grupo))].sort() };
}

export type ReadErrorKind = "recoverable" | "access" | "unexpected";

// supabase-js reports failed reads as PLAIN objects {message, details, hint, code} (not Error
// instances) and drops the HTTP status; the data layer re-throws them as they are. Network failures
// have code "" and a "<Name>: <message>" text; gateway failures can carry only a text body.
const ACCESS_CODES = /^(PGRST30[0-3]|42501|28\w{3})$/;
const ACCESS_TEXT = /api key|jwt|token|unauthori[sz]ed|forbidden|not authori[sz]ed|permission denied|row[- ]level security|invalid claim/i;
// PostgREST pool/connection/schema-cache codes and transient Postgres SQLSTATE classes.
const RECOVERABLE_CODES = /^(PGRST00[0-3]|08\w{3}|53\w{3}|57014|57P0[1-3]|40001|40P01|55P03)$/;
const CONNECTION_TEXT = /fetch failed|network|timeout|timed out|econn|enotfound|eai_again|socket|aborted|bad gateway|service unavailable|gateway time-?out|upstream/i;
const FETCH_ERROR_NAMES = new Set(["TypeError", "FetchError", "AbortError"]);

export function classifyReadError(error: unknown): ReadErrorKind {
  if (typeof error !== "object" || error === null) return "unexpected";
  const { code, message, name } = error as { code?: unknown; message?: unknown; name?: unknown };
  const text = typeof message === "string" ? message : "";
  const sqlCode = typeof code === "string" ? code : "";
  if (ACCESS_CODES.test(sqlCode)) return "access";
  if (ACCESS_TEXT.test(text)) return "access";
  if (RECOVERABLE_CODES.test(sqlCode)) return "recoverable";
  if (error instanceof Error) {
    // Code-level failures (invariants, bugs) keep propagating; only real fetch failures degrade.
    return typeof name === "string" && FETCH_ERROR_NAMES.has(name) && CONNECTION_TEXT.test(text) ? "recoverable" : "unexpected";
  }
  // Plain PostgREST/fetch objects without a recognized code: only connectivity text degrades.
  return sqlCode === "" && CONNECTION_TEXT.test(text) ? "recoverable" : "unexpected";
}

/** Minimal, non-sensitive label for logs: a database code or the error name. Never the message or rows. */
export function errorLogCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { code, name } = error as { code?: unknown; name?: unknown };
    if (typeof code === "string" && /^[A-Za-z0-9]{1,16}$/.test(code)) return code;
    if (typeof name === "string" && /^[A-Za-z]{1,32}$/.test(name)) return name;
  }
  return "connection";
}

/**
 * Runs one read. Next-internal errors (redirect, notFound, dynamic rendering) are re-thrown by
 * `rethrow`; access errors and anything not recognized as a recoverable read failure are re-thrown
 * unchanged. Only recoverable failures become a section error, reported with a minimal code.
 */
export async function settleSection<T>(
  read: () => Promise<T>,
  options: { rethrow: (error: unknown) => void; report: (code: string) => void },
): Promise<SectionResult<T>> {
  try {
    return { status: "ready", data: await read() };
  } catch (error) {
    options.rethrow(error);
    if (classifyReadError(error) !== "recoverable") throw error;
    options.report(errorLogCode(error));
    return { status: "error" };
  }
}
