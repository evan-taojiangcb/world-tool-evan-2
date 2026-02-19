import { describe, expect, it } from "vitest";
import { normalizeLookupKey, pruneLookupCache, type LookupCacheMap } from "./lookup-cache";

describe("lookup cache helpers", () => {
  it("normalizes query text as cache key", () => {
    expect(normalizeLookupKey("  Clicks  ")).toBe("clicks");
  });

  it("keeps newest entries when pruning cache", () => {
    const cache: LookupCacheMap = {
      alpha: {
        cachedAt: 1000,
        data: { word: "alpha", phonetic: {}, audio: {}, definitions: [] }
      },
      beta: {
        cachedAt: 3000,
        data: { word: "beta", phonetic: {}, audio: {}, definitions: [] }
      },
      gamma: {
        cachedAt: 2000,
        data: { word: "gamma", phonetic: {}, audio: {}, definitions: [] }
      }
    };

    const pruned = pruneLookupCache(cache, 2);
    expect(Object.keys(pruned).sort()).toEqual(["beta", "gamma"]);
  });
});

