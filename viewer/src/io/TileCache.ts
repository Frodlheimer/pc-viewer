import type { CachedTileEntry } from "../types/TileCache";

export type TileCacheEntrySnapshot = {
  key: string;
  tile: CachedTileEntry;
  bytesEstimate: number;
  pinned: boolean;
  lastUsed: number;
};

type CacheEntry = {
  key: string;
  tile: CachedTileEntry;
  bytesEstimate: number;
  buffers: ArrayBufferLike[];
  pinned: boolean;
  lastUsed: number;
  prev?: CacheEntry;
  next?: CacheEntry;
};

const PINNED_WARN_INTERVAL_MS = 10_000;

export class TileCache {
  private entries = new Map<string, CacheEntry>();
  private head: CacheEntry | null = null;
  private tail: CacheEntry | null = null;
  private totalBytes = 0;
  private pinnedBytes = 0;
  private uniqueBuffers = 0;
  private bufferRefs = new Map<
    ArrayBufferLike,
    { bytes: number; refs: number; pinnedRefs: number }
  >();
  private pinnedItems = 0;
  private lastPinnedWarning = 0;

  get(key: string): CachedTileEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    entry.lastUsed = Date.now();
    this.touch(entry);
    return entry.tile;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  set(key: string, tile: CachedTileEntry, buffers: ArrayBufferLike[]): void {
    const uniqueBuffers = Array.from(new Set(buffers));
    const bytesEstimate = uniqueBuffers.reduce(
      (sum, buffer) => sum + buffer.byteLength,
      0
    );
    const normalizedBytes = Math.max(0, Math.floor(bytesEstimate));
    const now = Date.now();
    const existing = this.entries.get(key);
    if (existing) {
      this.releaseBuffers(existing.buffers, existing.pinned);
      existing.tile = tile;
      existing.bytesEstimate = normalizedBytes;
      existing.buffers = uniqueBuffers;
      existing.lastUsed = now;
      this.addBuffers(uniqueBuffers, existing.pinned);
      this.touch(existing);
      return;
    }

    const entry: CacheEntry = {
      key,
      tile,
      bytesEstimate: normalizedBytes,
      buffers: uniqueBuffers,
      pinned: false,
      lastUsed: now,
    };
    this.entries.set(key, entry);
    this.addBuffers(uniqueBuffers, false);
    this.insertHead(entry);
  }

  pin(key: string): void {
    const entry = this.entries.get(key);
    if (!entry || entry.pinned) {
      return;
    }
    entry.pinned = true;
    this.addPinnedBuffers(entry.buffers);
    this.pinnedItems += 1;
  }

  unpin(key: string): void {
    const entry = this.entries.get(key);
    if (!entry || !entry.pinned) {
      return;
    }
    entry.pinned = false;
    this.releasePinnedBuffers(entry.buffers);
    this.pinnedItems -= 1;
  }

  evictToBudget(budgetBytes: number): string[] {
    const evicted: string[] = [];
    const budget = Math.max(0, Math.floor(budgetBytes));

    while (this.totalBytes > budget) {
      const candidate = this.findEvictionCandidate();
      if (!candidate) {
        if (this.pinnedBytes > budget) {
          this.warnPinnedBudget(budget);
        }
        break;
      }
      evicted.push(candidate.key);
      this.removeEntry(candidate);
    }

    return evicted;
  }

  stats(): {
    items: number;
    bytes: number;
    uniqueBuffers: number;
    pinnedItems: number;
    pinnedBytes: number;
  } {
    return {
      items: this.entries.size,
      bytes: this.totalBytes,
      uniqueBuffers: this.uniqueBuffers,
      pinnedItems: this.pinnedItems,
      pinnedBytes: this.pinnedBytes,
    };
  }

  values(): CachedTileEntry[] {
    return Array.from(this.entries.values(), (entry) => entry.tile);
  }

  getEntries(): TileCacheEntrySnapshot[] {
    return Array.from(this.entries.values(), (entry) => ({
      key: entry.key,
      tile: entry.tile,
      bytesEstimate: entry.bytesEstimate,
      pinned: entry.pinned,
      lastUsed: entry.lastUsed,
    }));
  }

  clear(): void {
    this.entries.clear();
    this.head = null;
    this.tail = null;
    this.totalBytes = 0;
    this.pinnedBytes = 0;
    this.uniqueBuffers = 0;
    this.bufferRefs.clear();
    this.pinnedItems = 0;
  }

  private touch(entry: CacheEntry) {
    if (this.head === entry) {
      return;
    }
    this.detach(entry);
    this.insertHead(entry);
  }

  private insertHead(entry: CacheEntry) {
    entry.prev = undefined;
    entry.next = this.head ?? undefined;
    if (this.head) {
      this.head.prev = entry;
    }
    this.head = entry;
    if (!this.tail) {
      this.tail = entry;
    }
  }

  private detach(entry: CacheEntry) {
    if (entry.prev) {
      entry.prev.next = entry.next;
    }
    if (entry.next) {
      entry.next.prev = entry.prev;
    }
    if (this.head === entry) {
      this.head = entry.next ?? null;
    }
    if (this.tail === entry) {
      this.tail = entry.prev ?? null;
    }
    entry.prev = undefined;
    entry.next = undefined;
  }

  private findEvictionCandidate(): CacheEntry | null {
    let current = this.tail;
    while (current) {
      if (!current.pinned) {
        return current;
      }
      current = current.prev ?? null;
    }
    return null;
  }

  private removeEntry(entry: CacheEntry) {
    this.entries.delete(entry.key);
    this.releaseBuffers(entry.buffers, entry.pinned);
    if (entry.pinned) {
      this.pinnedItems -= 1;
    }
    this.detach(entry);
  }

  private warnPinnedBudget(budget: number) {
    const now = Date.now();
    if (now - this.lastPinnedWarning < PINNED_WARN_INTERVAL_MS) {
      return;
    }
    this.lastPinnedWarning = now;
    console.warn("[tile-cache] pinned tiles exceed budget", {
      pinnedBytes: this.pinnedBytes,
      budget,
    });
  }

  private addBuffers(buffers: ArrayBufferLike[], pinned: boolean) {
    buffers.forEach((buffer) => {
      const existing = this.bufferRefs.get(buffer);
      if (existing) {
        existing.refs += 1;
        if (pinned) {
          if (existing.pinnedRefs === 0) {
            this.pinnedBytes += existing.bytes;
          }
          existing.pinnedRefs += 1;
        }
        return;
      }
      const bytes = buffer.byteLength;
      this.bufferRefs.set(buffer, { bytes, refs: 1, pinnedRefs: pinned ? 1 : 0 });
      this.uniqueBuffers += 1;
      this.totalBytes += bytes;
      if (pinned) {
        this.pinnedBytes += bytes;
      }
    });
  }

  private releaseBuffers(buffers: ArrayBufferLike[], pinned: boolean) {
    buffers.forEach((buffer) => {
      const entry = this.bufferRefs.get(buffer);
      if (!entry) {
        return;
      }
      if (pinned) {
        entry.pinnedRefs = Math.max(0, entry.pinnedRefs - 1);
        if (entry.pinnedRefs === 0) {
          this.pinnedBytes -= entry.bytes;
        }
      }
      entry.refs = Math.max(0, entry.refs - 1);
      if (entry.refs === 0) {
        this.bufferRefs.delete(buffer);
        this.uniqueBuffers -= 1;
        this.totalBytes -= entry.bytes;
      }
    });
  }

  private addPinnedBuffers(buffers: ArrayBufferLike[]) {
    buffers.forEach((buffer) => {
      const entry = this.bufferRefs.get(buffer);
      if (!entry) {
        return;
      }
      if (entry.pinnedRefs === 0) {
        this.pinnedBytes += entry.bytes;
      }
      entry.pinnedRefs += 1;
    });
  }

  private releasePinnedBuffers(buffers: ArrayBufferLike[]) {
    buffers.forEach((buffer) => {
      const entry = this.bufferRefs.get(buffer);
      if (!entry || entry.pinnedRefs === 0) {
        return;
      }
      entry.pinnedRefs -= 1;
      if (entry.pinnedRefs === 0) {
        this.pinnedBytes -= entry.bytes;
      }
    });
  }
}
