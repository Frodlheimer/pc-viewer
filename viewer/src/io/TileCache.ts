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

  set(key: string, tile: CachedTileEntry, bytesEstimate: number): void {
    const normalizedBytes = Math.max(0, Math.floor(bytesEstimate));
    const now = Date.now();
    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes -= existing.bytesEstimate;
      if (existing.pinned) {
        this.pinnedBytes -= existing.bytesEstimate;
      }
      existing.tile = tile;
      existing.bytesEstimate = normalizedBytes;
      existing.lastUsed = now;
      this.totalBytes += normalizedBytes;
      if (existing.pinned) {
        this.pinnedBytes += normalizedBytes;
      }
      this.touch(existing);
      return;
    }

    const entry: CacheEntry = {
      key,
      tile,
      bytesEstimate: normalizedBytes,
      pinned: false,
      lastUsed: now,
    };
    this.entries.set(key, entry);
    this.totalBytes += normalizedBytes;
    this.insertHead(entry);
  }

  pin(key: string): void {
    const entry = this.entries.get(key);
    if (!entry || entry.pinned) {
      return;
    }
    entry.pinned = true;
    this.pinnedBytes += entry.bytesEstimate;
    this.pinnedItems += 1;
  }

  unpin(key: string): void {
    const entry = this.entries.get(key);
    if (!entry || !entry.pinned) {
      return;
    }
    entry.pinned = false;
    this.pinnedBytes -= entry.bytesEstimate;
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
    pinnedItems: number;
    pinnedBytes: number;
  } {
    return {
      items: this.entries.size,
      bytes: this.totalBytes,
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
    this.totalBytes -= entry.bytesEstimate;
    if (entry.pinned) {
      this.pinnedBytes -= entry.bytesEstimate;
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
}
