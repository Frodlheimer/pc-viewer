import type { DatasetManifest } from "../types/Dataset";
import type { NodeRecord } from "../types/Hierarchy";
import type { TileRenderData } from "../types/Tile";
import { TileCache } from "./TileCache";
import { loadTileForNode } from "./TileManager";

type InFlightEntry = {
  promise: Promise<TileRenderData>;
  abort: AbortController;
};

const nodeKey = (nodeId: NodeRecord["nodeId"]) =>
  typeof nodeId === "bigint" ? nodeId.toString() : String(nodeId);

const estimateTileBytes = (tile: TileRenderData) =>
  tile.positions.byteLength + (tile.colors?.byteLength ?? 0);

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

export class TileService {
  private cache: TileCache;
  private inFlight = new Map<string, InFlightEntry>();
  private pinnedKeys = new Set<string>();

  constructor(cache?: TileCache) {
    this.cache = cache ?? new TileCache();
  }

  getTileKey(node: NodeRecord): string {
    return nodeKey(node.nodeId);
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
    const key = nodeKey(node.nodeId);
    const cached = this.cache.get(key);
    if (cached) {
      return Promise.resolve(cached);
    }
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing.promise;
    }

    const abort = new AbortController();
    const promise = loadTileForNode(manifest, node, abort.signal)
      .then((tile) => {
        this.inFlight.delete(key);
        this.cache.set(key, tile, estimateTileBytes(tile));
        if (this.pinnedKeys.has(key)) {
          this.cache.pin(key);
        }
        this.cache.evictToBudget(budgetBytes);
        return tile;
      })
      .catch((error: unknown) => {
        this.inFlight.delete(key);
        if (isAbortError(error) || abort.signal.aborted) {
          throw error;
        }
        throw error;
      });

    this.inFlight.set(key, { promise, abort });
    return promise;
  }

  getCachedTile(key: string): TileRenderData | undefined {
    return this.cache.get(key);
  }

  pin(key: string): void {
    this.pinnedKeys.add(key);
    this.cache.pin(key);
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

  stats(): {
    items: number;
    bytes: number;
    pinnedItems: number;
    pinnedBytes: number;
    inFlight: number;
  } {
    const stats = this.cache.stats();
    return {
      ...stats,
      inFlight: this.inFlight.size,
    };
  }
}

export { isAbortError };
