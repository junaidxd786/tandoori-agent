/**
 * lib/cache.ts
 * Lightweight in-memory TTL cache.
 * In Next.js, module-level state persists across requests within the same server instance,
 * making this effective for caching DB reads that don't need instant freshness.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | null {
  const entry = store.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data as T;
  }
  store.delete(key);
  return null;
}

export function setCached<T>(key: string, data: T, ttlMs: number): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function invalidateCache(key: string): void {
  store.delete(key);
}

export function invalidateCacheByPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
