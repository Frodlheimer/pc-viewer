import { describe, expect, it } from "vitest";
import { OrbitViewport } from "@deck.gl/core";
import { getRuntimeBudgets } from "../config/budgets";
import type { NodeRecord } from "../types/Hierarchy";
import { selectNodes } from "./NodeSelector";

const normalize = (x: number, y: number, z: number): [number, number, number] => {
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length === 0) {
    return [0, 0, 0];
  }
  return [x / length, y / length, z / length];
};

const makeNode = (overrides: Partial<NodeRecord>): NodeRecord => ({
  nodeId: 1,
  parentId: 1,
  level: 0,
  childMask: 0,
  pointCount: 100,
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  containerIndex: 0,
  byteOffset: 0,
  byteLength: 0,
  statsOffset: 0,
  statsLength: 0,
  ...overrides,
});

describe("NodeSelector frustum culling", () => {
  const target: [number, number, number] = [0, 0, 0];
  const viewport = new OrbitViewport({
    width: 800,
    height: 800,
    target,
    zoom: 0,
    rotationX: 30,
    rotationOrbit: 30,
  });

  const common = {
    viewport,
    boundsQuantization: {
      origin: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    },
    runtimeBudgets: getRuntimeBudgets("balanced"),
  };

  it("keeps nodes inside the frustum", () => {
    const inside = makeNode({
      nodeId: 1,
      parentId: 1,
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    });
    const result = selectNodes({ ...common, nodes: [inside] });
    expect(result.selected.map((entry) => entry.node.nodeId)).toEqual([1]);
    expect(result.diagnostics.reasonCounts.frustumCulled).toBe(0);
  });

  it("culls nodes outside the frustum", () => {
    const [cx, cy, cz] = viewport.cameraPosition as [number, number, number];
    const [fx, fy] = normalize(
      target[0] - cx,
      target[1] - cy,
      target[2] - cz
    );
    const [rx, ry, rz] = normalize(fy, -fx, 0);
    const cameraDistance = Math.hypot(target[0] - cx, target[1] - cy, target[2] - cz);
    const offset = cameraDistance > 0 ? cameraDistance * 100 : 1000;
    const bx = target[0] + rx * offset;
    const by = target[1] + ry * offset;
    const bz = target[2] + rz * offset;

    const outside = makeNode({
      nodeId: 2,
      parentId: 2,
      bounds: { min: [bx - 1, by - 1, bz - 1], max: [bx + 1, by + 1, bz + 1] },
    });
    const result = selectNodes({ ...common, nodes: [outside] });
    expect(result.selected).toHaveLength(0);
    expect(result.diagnostics.reasonCounts.frustumCulled).toBe(1);
  });
});
