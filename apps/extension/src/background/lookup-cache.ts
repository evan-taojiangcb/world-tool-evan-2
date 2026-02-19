import type { WordData } from "@shared/index";

export const LOOKUP_CACHE_KEY = "word_lookup_cache";
export const LOOKUP_CACHE_MAX = 1500;

export type LookupCacheEntry = {
  data: WordData;
  cachedAt: number;
};

export type LookupCacheMap = Record<string, LookupCacheEntry>;

export function normalizeLookupKey(text: string): string {
  return text.trim().toLowerCase();
}

export function pruneLookupCache(cache: LookupCacheMap, max = LOOKUP_CACHE_MAX): LookupCacheMap {
  const entries = Object.entries(cache);
  if (entries.length <= max) return cache;
  const kept = entries
    .sort((a, b) => (b[1]?.cachedAt ?? 0) - (a[1]?.cachedAt ?? 0))
    .slice(0, max);
  return Object.fromEntries(kept);
}

