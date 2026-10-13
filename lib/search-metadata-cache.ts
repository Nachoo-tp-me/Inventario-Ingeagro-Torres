// A process-local, short-lived snapshot. The caller must authorize every read.
// Never store a Supabase client, credentials, stock, or signed image URLs here.
export function createSearchMetadataCache<T>(ttlMs = 15_000, now = Date.now) {
  let snapshot: { value: T; expiresAt: number } | undefined;
  let loading: Promise<T> | undefined;

  return async function read(load: () => Promise<T>): Promise<T> {
    if (snapshot && now() < snapshot.expiresAt) return snapshot.value;
    if (loading) return loading;
    loading = Promise.resolve().then(load).then((value) => {
      snapshot = { value, expiresAt: now() + ttlMs };
      return value;
    });
    try {
      return await loading;
    } finally {
      loading = undefined;
    }
  };
}
