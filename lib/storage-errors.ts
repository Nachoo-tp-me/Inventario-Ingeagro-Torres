// Failures while signing product-photo URLs (Supabase Storage). Pure helpers with no project imports so they can be tested
// without a bundler. Only transport/availability failures degrade to "photo not available"; authentication, authorization,
// configuration and programming errors must keep propagating.

export type StorageErrorKind = "recoverable" | "propagate";

// storage-js returns StorageApiError (HTTP status) or StorageUnknownError (fetch failed, aborted, unreadable response).
// Bare words such as "token" are NOT enough: a gateway message may quote a URL with a query string.
const ACCESS_OR_CONFIG_TEXT = /api key|\bjwt\b|invalid (token|claim|signature)|(token|jwt|signature) (is )?(expired|invalid)|unauthori[sz]ed|forbidden|not authori[sz]ed|permission denied|row[- ]level security|access denied|bucket not found|invalid bucket/i;
const CONNECTION_TEXT = /fetch failed|network|timeout|timed out|econn|enotfound|eai_again|socket|aborted|bad gateway|service unavailable|gateway time-?out|upstream/i;
const TRANSPORT_NAMES = new Set(["TypeError", "FetchError", "AbortError"]);

export function classifyStorageError(error: unknown): StorageErrorKind {
  if (typeof error !== "object" || error === null) return "propagate";
  const { message, name, status, statusCode, originalError } = error as {
    message?: unknown; name?: unknown; status?: unknown; statusCode?: unknown; originalError?: { name?: unknown } | null;
  };
  const text = typeof message === "string" ? message : "";
  if (ACCESS_OR_CONFIG_TEXT.test(text)) return "propagate";
  const http = Number(status ?? statusCode);
  if (Number.isInteger(http) && http > 0) return http >= 500 || http === 408 || http === 429 ? "recoverable" : "propagate";
  const original = typeof originalError?.name === "string" ? originalError.name : "";
  return name === "StorageUnknownError" && (CONNECTION_TEXT.test(text) || TRANSPORT_NAMES.has(original)) ? "recoverable" : "propagate";
}

/** Minimal, non-sensitive label for logs: the HTTP status or the error name; never the message, paths or URLs. */
export function storageLogCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { status, statusCode, name } = error as { status?: unknown; statusCode?: unknown; name?: unknown };
    const http = Number(status ?? statusCode);
    if (Number.isInteger(http) && http >= 100 && http <= 599) return String(http);
    if (typeof name === "string" && /^[A-Za-z]{1,32}$/.test(name)) return name;
  }
  return "storage";
}

export type SignResult = { data: { signedUrl?: string | null }[] | null; error: unknown };

/**
 * Signs paths in chunks. A recoverable failure leaves that chunk without URLs (the photo shows as unavailable) and reports
 * a minimal code; any other failure is re-thrown unchanged, as are exceptions thrown by `sign` itself.
 */
export async function signImagePaths(
  paths: string[],
  sign: (chunk: string[]) => PromiseLike<SignResult>,
  report: (code: string) => void,
  chunkSize = 100,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (let start = 0; start < paths.length; start += chunkSize) {
    const chunk = paths.slice(start, start + chunkSize);
    const { data, error } = await sign(chunk);
    if (error) {
      if (classifyStorageError(error) === "recoverable") { report(storageLogCode(error)); continue; }
      throw error;
    }
    for (let i = 0; i < chunk.length; i++) {
      const signed = data?.[i]?.signedUrl;
      if (signed) urls.set(chunk[i], signed);
    }
  }
  return urls;
}
