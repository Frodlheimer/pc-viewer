import type { DatasetManifest } from "../types/Dataset";
import type { NodeRecord } from "../types/Hierarchy";
import type { TileRenderData } from "../types/Tile";
import type { CachedTileEntry } from "../types/TileCache";
import type { TypedArray } from "../types/Pct2";
import type { PerformanceProfile } from "../config/budgets";
import { TileCache, type TileCacheEntrySnapshot } from "./TileCache";
import { loadTileForNode } from "./TileManager";
import { keyFromNodeId } from "../utils/nodeKey";
import { decodePct2Attributes, parsePct2HeaderAndDirectory } from "./Pct2TileLoader";
import { loadPct2TileBuffer } from "./Pct2TileLoader";
import { loadTileBufferFromContainer } from "./TileContainerLoader";

type InFlightEntry = {
  promise: Promise<CachedTileEntry>;
  abort: AbortController;
};

const OPTIONAL_ATTR_GRACE_MS = 10_000;

const cloneTypedArray = (value: TypedArray): TypedArray => {
  if (typeof value.slice === "function") {
    return value.slice(0);
  }
  const ctor = value.constructor as new (array: TypedArray) => TypedArray;
  return new ctor(value);
};

const detachOptionalFromRawBuffer = (entry: CachedTileEntry) => {
  if (!entry.rawBuffer || entry.decodedOptional.size === 0) {
    return;
  }
  entry.decodedOptional.forEach((value, name) => {
    if (value.buffer === entry.rawBuffer) {
      entry.decodedOptional.set(name, cloneTypedArray(value));
    }
  });
};

const dropEntryRawBuffer = (entry: CachedTileEntry) => {
  if (!entry.rawBuffer) {
    return;
  }
  detachOptionalFromRawBuffer(entry);
  entry.rawBuffer = undefined;
};

const estimateTileBytes = (entry: CachedTileEntry) => {
  const buffers = new Set<ArrayBufferLike>();
  const addBuffer = (buffer: ArrayBufferLike | undefined) => {
    if (!buffer || buffers.has(buffer)) {
      return;
    }
    buffers.add(buffer);
  };
  addBuffer(entry.renderData.positions.buffer);
  if (entry.renderData.colors) {
    addBuffer(entry.renderData.colors.buffer);
  }
  if (entry.rawBuffer) {
    addBuffer(entry.rawBuffer);
  }
  entry.decodedOptional.forEach((array) => {
    addBuffer(array.buffer);
  });
  let bytes = 0;
  buffers.forEach((buffer) => {
    bytes += buffer.byteLength;
  });
  return bytes;
};

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

export class TileService {
  private cache: TileCache;
  private inFlight = new Map<string, InFlightEntry>();
  private pinnedKeys = new Set<string>();
  private profile: PerformanceProfile = "auto";
  private lastBudgetBytes = 0;
  private rawBufferDroppedOnPressureCount = 0;
  private rawBufferBytesDropped = 0;

  constructor(cache?: TileCache) {
    this.cache = cache ?? new TileCache();
  }

  getTileKey(node: NodeRecord): string {
    return keyFromNodeId(node.nodeId);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  getTile(
    manifest: DatasetManifest,
    node: NodeRecord,
    budgetBytes: number
  ): Promise<TileRenderData> {
    const key = keyFromNodeId(node.nodeId);
    const cached = this.cache.get(key);
    if (cached) {
      return Promise.resolve(cached.renderData);
    }
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing.promise.then((entry) => entry.renderData);
    }

    const abort = new AbortController();
    const promise = loadTileForNode(manifest, node, abort.signal)
      .then((entry) => {
        this.inFlight.delete(key);
        this.lastBudgetBytes = budgetBytes;
        const storeKey = entry.key;
        this.applyRawBufferPolicy(entry);
        this.cache.set(storeKey, entry, estimateTileBytes(entry));
        if (this.pinnedKeys.has(storeKey)) {
          this.cache.pin(storeKey);
          this.applyPinnedPolicy(storeKey);
        }
        this.dropRawBuffersToFitBudget(budgetBytes);
        this.cache.evictToBudget(budgetBytes);
        return entry;
      })
      .catch((error: unknown) => {
        this.inFlight.delete(key);
        if (isAbortError(error) || abort.signal.aborted) {
          throw error;
        }
        throw error;
      });

    this.inFlight.set(key, { promise, abort });
    return promise.then((entry) => entry.renderData);
  }

  getCachedTile(key: string): TileRenderData | undefined {
    return this.cache.get(key)?.renderData;
  }

  getCachedEntry(key: string): CachedTileEntry | undefined {
    return this.cache.get(key);
  }

  pin(key: string): void {
    this.pinnedKeys.add(key);
    this.cache.pin(key);
    this.applyPinnedPolicy(key);
  }

  unpin(key: string): void {
    this.pinnedKeys.delete(key);
    this.cache.unpin(key);
  }

  cancelTile(key: string): void {
    const entry = this.inFlight.get(key);
    if (!entry) {
      return;
    }
    entry.abort.abort();
    this.inFlight.delete(key);
  }

  cancelAll(): void {
    Array.from(this.inFlight.keys()).forEach((key) => this.cancelTile(key));
  }

  clear(): void {
    this.cancelAll();
    this.cache.clear();
    this.pinnedKeys.clear();
  }

  setProfile(profile: PerformanceProfile): void {
    this.profile = profile;
    if (profile === "low") {
      this.dropAllRawBuffers();
    }
  }

  async ensureTileAttributes(
    nodeIdOrKey: bigint | number | string,
    attrNames: string[]
  ): Promise<Record<string, TypedArray>> {
    const key =
      typeof nodeIdOrKey === "string"
        ? nodeIdOrKey
        : keyFromNodeId(nodeIdOrKey);
    const entry = this.cache.get(key);
    if (!entry) {
      throw new Error(`Tile not cached (${key}).`);
    }
    if (entry.source.format !== "pct2") {
      throw new Error("Optional attributes supported only for PCT2 tiles.");
    }

    const missing = attrNames.filter((name) => !entry.decodedOptional.has(name));
    if (missing.length === 0) {
      const result: Record<string, TypedArray> = {};
      attrNames.forEach((name) => {
        const value = entry.decodedOptional.get(name);
        if (value) {
          result[name] = value;
        }
      });
      return result;
    }

    let buffer = entry.rawBuffer;
    if (!buffer) {
      buffer = await this.fetchTileBuffer(entry);
      entry.rawBuffer = buffer;
    }
    if (!entry.directory) {
      const parsed = parsePct2HeaderAndDirectory(buffer);
      entry.directory = parsed.directory;
    }
    if (!entry.directory) {
      throw new Error(`Tile missing attribute directory (${key}).`);
    }

    const decoded = decodePct2Attributes(buffer, entry.directory, missing);
    missing.forEach((name) => {
      const value = decoded[name];
      if (value) {
        entry.decodedOptional.set(name, value);
      }
    });
    entry.lastOptionalAccess = Date.now();
    this.applyRawBufferPolicy(entry);
    this.cache.set(key, entry, estimateTileBytes(entry));
    if (this.lastBudgetBytes > 0) {
      this.dropRawBuffersToFitBudget(this.lastBudgetBytes);
      this.cache.evictToBudget(this.lastBudgetBytes);
    }

    const result: Record<string, TypedArray> = {};
    attrNames.forEach((name) => {
      const value = entry.decodedOptional.get(name);
      if (value) {
        result[name] = value;
      }
    });
    return result;
  }

  stats(): {
    items: number;
    bytes: number;
    pinnedItems: number;
    pinnedBytes: number;
    inFlight: number;
    rawBufferRetainedCount: number;
    optionalAttrsDecodedCount: number;
    rawBufferDroppedOnPressureCount: number;
    rawBufferBytesDropped: number;
  } {
    const stats = this.cache.stats();
    let rawBufferRetainedCount = 0;
    let optionalAttrsDecodedCount = 0;
    this.cache.values().forEach((entry) => {
      if (entry.rawBuffer) {
        rawBufferRetainedCount += 1;
      }
      optionalAttrsDecodedCount += entry.decodedOptional.size;
    });
    return {
      ...stats,
      inFlight: this.inFlight.size,
      rawBufferRetainedCount,
      optionalAttrsDecodedCount,
      rawBufferDroppedOnPressureCount: this.rawBufferDroppedOnPressureCount,
      rawBufferBytesDropped: this.rawBufferBytesDropped,
    };
  }

  dropRawBuffersToFitBudget(targetBytes: number): number {
    const budget = Math.max(0, Math.floor(targetBytes));
    if (budget === 0) {
      return 0;
    }
    let currentBytes = this.cache.stats().bytes;
    if (currentBytes <= budget) {
      return 0;
    }
    const now = Date.now();
    const candidates = this.getRawBufferCandidates();
    let dropped = 0;
    for (const candidate of candidates) {
      if (currentBytes <= budget) {
        break;
      }
      const entry = candidate.tile;
      if (!entry.rawBuffer) {
        continue;
      }
      if (
        candidate.pinned &&
        now - (entry.lastOptionalAccess ?? 0) <= OPTIONAL_ATTR_GRACE_MS
      ) {
        continue;
      }
      const before = this.cache.stats().bytes;
      dropEntryRawBuffer(entry);
      this.cache.set(candidate.key, entry, estimateTileBytes(entry));
      const after = this.cache.stats().bytes;
      const droppedBytes = Math.max(0, before - after);
      if (droppedBytes > 0) {
        this.rawBufferDroppedOnPressureCount += 1;
        this.rawBufferBytesDropped += droppedBytes;
        dropped += 1;
      }
      currentBytes = after;
    }
    return dropped;
  }

  private applyRawBufferPolicy(entry: CachedTileEntry) {
    if (!entry.rawBuffer) {
      return;
    }
    if (this.profile === "low") {
      dropEntryRawBuffer(entry);
    }
  }

  private applyPinnedPolicy(key: string) {
    const entry = this.cache.get(key);
    if (!entry) {
      return;
    }
    this.applyRawBufferPolicy(entry);
    this.cache.set(key, entry, estimateTileBytes(entry));
  }

  private dropAllRawBuffers() {
    this.cache.values().forEach((entry) => {
      if (!entry.rawBuffer) {
        return;
      }
      dropEntryRawBuffer(entry);
      this.cache.set(entry.key, entry, estimateTileBytes(entry));
    });
  }

  private getRawBufferCandidates(): TileCacheEntrySnapshot[] {
    return this.cache
      .getEntries()
      .filter((entry) => entry.tile.rawBuffer)
      .sort((a, b) => {
        const aTouched = Math.max(
          a.lastUsed,
          a.tile.lastOptionalAccess ?? 0
        );
        const bTouched = Math.max(
          b.lastUsed,
          b.tile.lastOptionalAccess ?? 0
        );
        if (aTouched === bTouched) {
          return a.key.localeCompare(b.key);
        }
        return aTouched - bTouched;
      });
  }

  private async fetchTileBuffer(entry: CachedTileEntry): Promise<ArrayBuffer> {
    if (entry.source.format !== "pct2") {
      throw new Error("Optional attributes supported only for PCT2 tiles.");
    }
    if (entry.source.containerUrl) {
      const offset = entry.source.byteOffset ?? 0;
      const length = entry.source.byteLength ?? 0;
      if (offset < 0 || length <= 0) {
        throw new Error("Tile container range invalid.");
      }
      return loadTileBufferFromContainer(
        entry.source.containerUrl,
        offset,
        length
      );
    }
    if (!entry.source.url) {
      throw new Error("Tile source URL missing.");
    }
    return loadPct2TileBuffer(entry.source.url);
  }
}

export { isAbortError };
