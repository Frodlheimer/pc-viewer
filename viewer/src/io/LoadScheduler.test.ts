import { describe, expect, it, vi } from "vitest";
import type { DatasetManifest } from "../types/Dataset";
import type { NodeRecord } from "../types/Hierarchy";
import { keyFromNodeId } from "../utils/nodeKey";
import { LoadScheduler } from "./LoadScheduler";
import type { TileService } from "./TileService";

const manifest: DatasetManifest = {
  schemaVersion: 1,
  id: "test",
  name: "test",
  crs: {},
  units: "m",
  attributes: [],
  roles: { position: "position" },
  boundsQuantization: { origin: [0, 0, 0], scale: [1, 1, 1] },
  levels: [],
  bounds: [0, 0, 0, 1, 1, 1],
};

const makeNode = (nodeId: number): NodeRecord => ({
  nodeId,
  parentId: nodeId,
  level: 0,
  childMask: 0,
  pointCount: 1,
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  containerIndex: 0,
  byteOffset: 0,
  byteLength: 0,
  statsOffset: 0,
  statsLength: 0,
});

describe("LoadScheduler.cancelNotDesired", () => {
  it("cancels inflight requests that are no longer desired", () => {
    const tileService = {
      has: vi.fn(() => false),
      isInFlight: vi.fn(() => false),
      getTile: vi.fn(() => new Promise(() => {})),
      cancelTile: vi.fn(),
    };

    const scheduler = new LoadScheduler({
      tileService: tileService as unknown as TileService,
      getManifest: () => manifest,
      getBudgetBytes: () => 1_000_000,
      maxConcurrentRequests: 1,
      onTileLoaded: vi.fn(),
    });

    const node = makeNode(1);
    scheduler.setDesiredNodes([{ node, pixelRadius: 1, distance: 1 }]);
    scheduler.tick();
    expect(tileService.getTile).toHaveBeenCalledTimes(1);
    expect(scheduler.stats().inFlight).toBe(1);

    scheduler.setDesiredNodes([]);
    expect(tileService.cancelTile).toHaveBeenCalledWith(keyFromNodeId(1));
    expect(scheduler.stats().inFlight).toBe(0);
    expect(scheduler.stats().canceled).toBe(1);
  });
});

