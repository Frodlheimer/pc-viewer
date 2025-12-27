import type { DatasetManifest } from "../types/Dataset";
import type { NodeRecord } from "../types/Hierarchy";
import type { TileRenderData } from "../types/Tile";
import type { SelectedNode } from "./NodeSelector";
import { TileService, isAbortError } from "./TileService";
import { keyFromNodeId } from "../utils/nodeKey";

export type DesiredNode = SelectedNode;

type QueueItem = {
  key: string;
  node: NodeRecord;
  pixelRadius: number;
  distance: number;
  level: number;
};

type QueueComparator = (a: QueueItem, b: QueueItem) => number;

const comparePriority: QueueComparator = (a, b) => {
  if (a.pixelRadius !== b.pixelRadius) {
    return a.pixelRadius > b.pixelRadius ? 1 : -1;
  }
  if (a.level !== b.level) {
    return a.level < b.level ? 1 : -1;
  }
  if (a.distance !== b.distance) {
    return a.distance < b.distance ? 1 : -1;
  }
  return 0;
};

class PriorityQueue {
  private items: QueueItem[] = [];
  private compare: QueueComparator;

  constructor(compare: QueueComparator) {
    this.compare = compare;
  }

  get size() {
    return this.items.length;
  }

  clear() {
    this.items = [];
  }

  push(item: QueueItem) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): QueueItem | undefined {
    if (this.items.length === 0) {
      return undefined;
    }
    const top = this.items[0];
    const end = this.items.pop();
    if (end && this.items.length > 0) {
      this.items[0] = end;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.items[index], this.items[parent]) <= 0) {
        break;
      }
      [this.items[parent], this.items[index]] = [
        this.items[index],
        this.items[parent],
      ];
      index = parent;
    }
  }

  private bubbleDown(index: number) {
    const length = this.items.length;
    while (true) {
      const left = index * 2 + 1;
      const right = index * 2 + 2;
      let best = index;
      if (
        left < length &&
        this.compare(this.items[left], this.items[best]) > 0
      ) {
        best = left;
      }
      if (
        right < length &&
        this.compare(this.items[right], this.items[best]) > 0
      ) {
        best = right;
      }
      if (best === index) {
        break;
      }
      [this.items[index], this.items[best]] = [
        this.items[best],
        this.items[index],
      ];
      index = best;
    }
  }
}

export type LoadSchedulerStats = {
  queued: number;
  desiredQueued: number;
  prefetchQueued: number;
  inFlight: number;
};

export type LoadSchedulerOptions = {
  tileService: TileService;
  getManifest: () => DatasetManifest | null;
  getBudgetBytes: () => number;
  maxConcurrentRequests: number;
  onTileLoaded: (tile: TileRenderData) => void;
  onError?: (error: unknown) => void;
};

export class LoadScheduler {
  private tileService: TileService;
  private getManifest: () => DatasetManifest | null;
  private getBudgetBytes: () => number;
  private maxConcurrentRequests: number;
  private onTileLoaded: (tile: TileRenderData) => void;
  private onError?: (error: unknown) => void;

  private desiredKeys = new Set<string>();
  private prefetchKeys = new Set<string>();
  private desiredQueue = new PriorityQueue(comparePriority);
  private prefetchQueue = new PriorityQueue(comparePriority);
  private inFlight = new Set<string>();

  constructor(options: LoadSchedulerOptions) {
    this.tileService = options.tileService;
    this.getManifest = options.getManifest;
    this.getBudgetBytes = options.getBudgetBytes;
    this.maxConcurrentRequests = options.maxConcurrentRequests;
    this.onTileLoaded = options.onTileLoaded;
    this.onError = options.onError;
  }

  setMaxConcurrentRequests(maxConcurrentRequests: number) {
    this.maxConcurrentRequests = Math.max(1, maxConcurrentRequests);
  }

  setDesiredNodes(nodes: DesiredNode[]) {
    this.desiredKeys = new Set(
      nodes.map((entry) => keyFromNodeId(entry.node.nodeId))
    );
    this.prefetchKeys.clear();
    this.desiredQueue.clear();
    this.prefetchQueue.clear();
    nodes.forEach((entry) => {
      const key = keyFromNodeId(entry.node.nodeId);
      if (this.tileService.has(key) || this.tileService.isInFlight(key)) {
        return;
      }
      this.desiredQueue.push({
        key,
        node: entry.node,
        pixelRadius: entry.pixelRadius,
        distance: entry.distance,
        level: entry.node.level,
      });
    });
    this.cancelNotDesired();
  }

  setPrefetchNodes(nodes: DesiredNode[]) {
    this.prefetchKeys = new Set(
      nodes.map((entry) => keyFromNodeId(entry.node.nodeId))
    );
    this.prefetchQueue.clear();
    nodes.forEach((entry) => {
      const key = keyFromNodeId(entry.node.nodeId);
      if (
        this.desiredKeys.has(key) ||
        this.tileService.has(key) ||
        this.tileService.isInFlight(key)
      ) {
        return;
      }
      this.prefetchQueue.push({
        key,
        node: entry.node,
        pixelRadius: entry.pixelRadius,
        distance: entry.distance,
        level: entry.node.level,
      });
    });
    this.cancelNotDesired();
  }

  cancelNotDesired() {
    const allowedKeys = new Set<string>();
    this.desiredKeys.forEach((key) => allowedKeys.add(key));
    this.prefetchKeys.forEach((key) => allowedKeys.add(key));
    this.inFlight.forEach((key) => {
      if (!allowedKeys.has(key)) {
        this.tileService.cancelTile(key);
        this.inFlight.delete(key);
      }
    });
  }

  tick() {
    const manifest = this.getManifest();
    if (!manifest) {
      return;
    }
    const available = this.maxConcurrentRequests - this.inFlight.size;
    if (available <= 0) {
      return;
    }
    for (let i = 0; i < available; i += 1) {
      const next =
        this.desiredQueue.size > 0
          ? this.desiredQueue.pop()
          : this.prefetchQueue.pop();
      if (!next) {
        break;
      }
      const key = next.key;
      if (
        this.tileService.has(key) ||
        this.tileService.isInFlight(key) ||
        this.inFlight.has(key)
      ) {
        continue;
      }
      this.inFlight.add(key);
      this.tileService
        .getTile(manifest, next.node, this.getBudgetBytes())
        .then((tile) => {
          this.inFlight.delete(key);
          this.onTileLoaded(tile);
          this.tick();
        })
        .catch((error: unknown) => {
          this.inFlight.delete(key);
          if (!isAbortError(error)) {
            this.onError?.(error);
          }
          this.tick();
        });
    }
  }

  stats(): LoadSchedulerStats {
    return {
      queued: this.desiredQueue.size + this.prefetchQueue.size,
      desiredQueued: this.desiredQueue.size,
      prefetchQueued: this.prefetchQueue.size,
      inFlight: this.inFlight.size,
    };
  }

  clear() {
    this.desiredKeys.clear();
    this.prefetchKeys.clear();
    this.desiredQueue.clear();
    this.prefetchQueue.clear();
    this.inFlight.forEach((key) => this.tileService.cancelTile(key));
    this.inFlight.clear();
  }
}
