import { describe, expect, it } from "vitest";
import type { CachedTileEntry } from "../types/TileCache";
import { TileCache } from "./TileCache";

const makeEntry = (key: string, buffer: ArrayBuffer): CachedTileEntry => ({
  key,
  renderData: {
    id: key,
    pointCount: 1,
    positions: new Float32Array(buffer, 0, 3),
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  },
  decodedOptional: new Map(),
  source: { format: "pct2", url: "https://example.invalid/tile" },
});

describe("TileCache (global unique buffers)", () => {
  it("counts shared buffers once across entries and updates on eviction", () => {
    const cache = new TileCache();
    const shared = new ArrayBuffer(64);
    const unique = new ArrayBuffer(32);

    cache.set("a", makeEntry("a", shared), [shared]);
    cache.set("b", makeEntry("b", shared), [shared]);
    cache.set("c", makeEntry("c", unique), [unique]);

    cache.get("a");
    cache.get("b");

    expect(cache.stats().bytes).toBe(96);
    expect(cache.stats().uniqueBuffers).toBe(2);

    const evicted = cache.evictToBudget(70);
    expect(evicted).toEqual(["c"]);
    expect(cache.stats().bytes).toBe(64);
    expect(cache.stats().uniqueBuffers).toBe(1);
    expect(cache.stats().items).toBe(2);
  });

  it("tracks pinned bytes by unique buffers", () => {
    const cache = new TileCache();
    const shared = new ArrayBuffer(64);

    cache.set("a", makeEntry("a", shared), [shared]);
    cache.set("b", makeEntry("b", shared), [shared]);

    cache.pin("a");
    expect(cache.stats().pinnedItems).toBe(1);
    expect(cache.stats().pinnedBytes).toBe(64);

    cache.pin("b");
    expect(cache.stats().pinnedItems).toBe(2);
    expect(cache.stats().pinnedBytes).toBe(64);

    cache.unpin("a");
    expect(cache.stats().pinnedItems).toBe(1);
    expect(cache.stats().pinnedBytes).toBe(64);

    cache.unpin("b");
    expect(cache.stats().pinnedItems).toBe(0);
    expect(cache.stats().pinnedBytes).toBe(0);
  });
});

