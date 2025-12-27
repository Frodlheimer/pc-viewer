import type { Viewport } from "@deck.gl/core";
import type { RuntimeBudgets } from "../config/budgets";
import type { BoundsQuantization } from "../types/Dataset";
import type { NodeRecord } from "../types/Hierarchy";
import type { Vec3 } from "../types/Point";
import { keyFromNodeId } from "../utils/nodeKey";

type Plane = {
  normal: Vec3;
  distance: number;
};

export type NodeSelectionInput = {
  viewport?: Viewport;
  viewProjectionMatrix?: number[];
  projectionMatrix?: number[];
  cameraPosition?: Vec3;
  width?: number;
  height?: number;
  nodes: NodeRecord[];
  boundsQuantization: BoundsQuantization;
  runtimeBudgets: RuntimeBudgets;
  previousSelection?: Set<string>;
  keepCoarseNodes?: boolean;
};

export type NodeSelectionDiagnostics = {
  visiblePoints: number;
  selectedCount: number;
  selectedLevels: Record<number, number>;
  reasonCounts: {
    frustumCulled: number;
    refined: number;
    selected: number;
    keptPrevious: number;
    budgetLimited: number;
  };
};

export type NodeSelectionResult = {
  selected: SelectedNode[];
  diagnostics: NodeSelectionDiagnostics;
};

export type SelectedNode = {
  node: NodeRecord;
  pixelRadius: number;
  distance: number;
};

type DecodedBounds = {
  min: Vec3;
  max: Vec3;
};

type NodeInfo = {
  bounds: DecodedBounds;
  center: Vec3;
  radius: number;
  pixelRadius: number;
  distance: number;
  visible: boolean;
  children: NodeRecord[];
};

const BASE_REFINE_PX = 40;
const BASE_COARSEN_PX = 30;

const normalizePlane = (a: number, b: number, c: number, d: number): Plane => {
  const length = Math.hypot(a, b, c);
  if (!Number.isFinite(length) || length === 0) {
    return { normal: [0, 0, 0], distance: 0 };
  }
  return {
    normal: [-a / length, -b / length, -c / length],
    distance: d / length,
  };
};

const getFrustumPlanes = (matrix: number[]): Plane[] => {
  if (!matrix || matrix.length < 16) {
    return [];
  }
  return [
    normalizePlane(
      matrix[3] + matrix[0],
      matrix[7] + matrix[4],
      matrix[11] + matrix[8],
      matrix[15] + matrix[12]
    ),
    normalizePlane(
      matrix[3] - matrix[0],
      matrix[7] - matrix[4],
      matrix[11] - matrix[8],
      matrix[15] - matrix[12]
    ),
    normalizePlane(
      matrix[3] + matrix[1],
      matrix[7] + matrix[5],
      matrix[11] + matrix[9],
      matrix[15] + matrix[13]
    ),
    normalizePlane(
      matrix[3] - matrix[1],
      matrix[7] - matrix[5],
      matrix[11] - matrix[9],
      matrix[15] - matrix[13]
    ),
    normalizePlane(
      matrix[3] + matrix[2],
      matrix[7] + matrix[6],
      matrix[11] + matrix[10],
      matrix[15] + matrix[14]
    ),
    normalizePlane(
      matrix[3] - matrix[2],
      matrix[7] - matrix[6],
      matrix[11] - matrix[10],
      matrix[15] - matrix[14]
    ),
  ];
};

const hasFiniteBounds = (bounds: DecodedBounds) =>
  [...bounds.min, ...bounds.max].every((value) => Number.isFinite(value));

const isOutsideFrustum = (bounds: DecodedBounds, planes: Plane[]) => {
  if (planes.length === 0 || !hasFiniteBounds(bounds)) {
    return false;
  }
  for (const plane of planes) {
    const [nx, ny, nz] = plane.normal;
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) {
      continue;
    }
    const px = nx >= 0 ? bounds.max[0] : bounds.min[0];
    const py = ny >= 0 ? bounds.max[1] : bounds.min[1];
    const pz = nz >= 0 ? bounds.max[2] : bounds.min[2];
    const distance = nx * px + ny * py + nz * pz + plane.distance;
    if (distance < 0) {
      return true;
    }
  }
  return false;
};

const decodeBounds = (
  quantized: NodeRecord["bounds"],
  quantization: BoundsQuantization
): DecodedBounds => {
  const [ox, oy, oz] = quantization.origin;
  const [sx, sy, sz] = quantization.scale;
  return {
    min: [
      ox + quantized.min[0] * sx,
      oy + quantized.min[1] * sy,
      oz + quantized.min[2] * sz,
    ],
    max: [
      ox + quantized.max[0] * sx,
      oy + quantized.max[1] * sy,
      oz + quantized.max[2] * sz,
    ],
  };
};

const getBoundsCenter = (bounds: DecodedBounds): Vec3 => [
  (bounds.min[0] + bounds.max[0]) / 2,
  (bounds.min[1] + bounds.max[1]) / 2,
  (bounds.min[2] + bounds.max[2]) / 2,
];

const getBoundsRadius = (bounds: DecodedBounds): number => {
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  const radius = 0.5 * Math.hypot(dx, dy, dz);
  return Number.isFinite(radius) ? radius : 0;
};

const getFocalLengthPixels = (
  projectionMatrix: number[] | undefined,
  height: number
) => {
  const scale = projectionMatrix?.[5] ?? Number.NaN;
  if (!Number.isFinite(scale)) {
    return height / 2;
  }
  return Math.abs(scale) * (height / 2);
};

const getDeviceNodeCap = (profile: RuntimeBudgets["profile"]) => {
  switch (profile) {
    case "low":
      return 400;
    case "balanced":
      return 1000;
    case "high":
      return 2000;
    default:
      return 1000;
  }
};

const deriveMaxNodes = (budgets: RuntimeBudgets) => {
  const base =
    budgets.tilePointCap > 0
      ? budgets.maxVisiblePoints / (budgets.tilePointCap * 0.5)
      : 100;
  const deviceCap = getDeviceNodeCap(budgets.profile);
  const capped = Math.min(deviceCap, Math.max(100, Math.floor(base)));
  return Math.max(1, capped);
};

type QueueItem = {
  node: NodeRecord;
  priority: number;
};

class MaxHeap {
  private items: QueueItem[] = [];

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

  get size() {
    return this.items.length;
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].priority >= this.items[index].priority) {
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
      let largest = index;
      if (left < length && this.items[left].priority > this.items[largest].priority) {
        largest = left;
      }
      if (right < length && this.items[right].priority > this.items[largest].priority) {
        largest = right;
      }
      if (largest === index) {
        break;
      }
      [this.items[index], this.items[largest]] = [
        this.items[largest],
        this.items[index],
      ];
      index = largest;
    }
  }
}

export const selectNodes = (input: NodeSelectionInput): NodeSelectionResult => {
  const viewport = input.viewport;
  const height = input.height ?? viewport?.height ?? 1;
  const viewProjectionMatrix =
    input.viewProjectionMatrix ?? viewport?.viewProjectionMatrix;
  const projectionMatrix =
    input.projectionMatrix ?? viewport?.projectionMatrix;
  const cameraPosition =
    input.cameraPosition ??
    (viewport?.cameraPosition as Vec3 | undefined) ?? [0, 0, 0];

  if (!viewProjectionMatrix) {
    throw new Error("NodeSelector requires a viewProjectionMatrix.");
  }

  const planes = getFrustumPlanes(viewProjectionMatrix);
  const focalLengthPixels = getFocalLengthPixels(projectionMatrix, height);
  const refineThreshold = BASE_REFINE_PX * input.runtimeBudgets.lodHysteresisFactor;
  const coarsenThreshold =
    BASE_COARSEN_PX / input.runtimeBudgets.lodHysteresisFactor;
  const maxNodes = deriveMaxNodes(input.runtimeBudgets);
  const targetPoints = input.runtimeBudgets.targetVisiblePoints;

  const nodeMap = new Map<string, NodeRecord>();
  const childrenByParent = new Map<string, NodeRecord[]>();
  for (const node of input.nodes) {
    nodeMap.set(keyFromNodeId(node.nodeId), node);
  }
  for (const node of input.nodes) {
    const parentKey = keyFromNodeId(node.parentId);
    if (nodeMap.has(parentKey) && parentKey !== keyFromNodeId(node.nodeId)) {
      const list = childrenByParent.get(parentKey) ?? [];
      list.push(node);
      childrenByParent.set(parentKey, list);
    }
  }

  const roots = input.nodes.filter((node) => {
    const parentKey = keyFromNodeId(node.parentId);
    return !nodeMap.has(parentKey) || parentKey === keyFromNodeId(node.nodeId);
  });

  const infoCache = new Map<string, NodeInfo>();
  const getInfo = (node: NodeRecord): NodeInfo => {
    const key = keyFromNodeId(node.nodeId);
    const cached = infoCache.get(key);
    if (cached) {
      return cached;
    }
    const bounds = decodeBounds(node.bounds, input.boundsQuantization);
    const center = getBoundsCenter(bounds);
    const radius = getBoundsRadius(bounds);
    const dx = center[0] - cameraPosition[0];
    const dy = center[1] - cameraPosition[1];
    const dz = center[2] - cameraPosition[2];
    const distance = Math.max(1e-3, Math.hypot(dx, dy, dz));
    const pixelRadius = Number.isFinite(radius)
      ? (radius / distance) * focalLengthPixels
      : 0;
    const visible = !isOutsideFrustum(bounds, planes);
    const children = childrenByParent.get(key) ?? [];
    const info: NodeInfo = {
      bounds,
      center,
      radius,
      pixelRadius: Number.isFinite(pixelRadius) ? pixelRadius : 0,
      distance,
      visible,
      children,
    };
    infoCache.set(key, info);
    return info;
  };

  const queue = new MaxHeap();
  roots.forEach((node) => {
    const info = getInfo(node);
    queue.push({ node, priority: info.pixelRadius });
  });

  const selected: SelectedNode[] = [];
  const selectedKeys = new Set<string>();
  const selectedLevels: Record<number, number> = {};
  const reasonCounts = {
    frustumCulled: 0,
    refined: 0,
    selected: 0,
    keptPrevious: 0,
    budgetLimited: 0,
  };
  let visiblePoints = 0;

  while (queue.size > 0) {
    if (selected.length >= maxNodes || visiblePoints >= targetPoints) {
      reasonCounts.budgetLimited += 1;
      break;
    }

    const next = queue.pop();
    if (!next) {
      break;
    }
    const node = next.node;
    const info = getInfo(node);
    if (!info.visible) {
      reasonCounts.frustumCulled += 1;
      continue;
    }

    const key = keyFromNodeId(node.nodeId);
    const children = info.children;
    const hasChildren = children.length > 0;
    let shouldRefine = false;
    let keptPrevious = false;

    if (hasChildren && info.pixelRadius > refineThreshold) {
      shouldRefine = true;
    } else if (info.pixelRadius < coarsenThreshold) {
      shouldRefine = false;
    } else if (input.previousSelection) {
      const wasSelected = input.previousSelection.has(key);
      if (wasSelected) {
        shouldRefine = false;
        keptPrevious = true;
      } else {
        const anyChildSelected = children.some((child) =>
          input.previousSelection?.has(keyFromNodeId(child.nodeId))
        );
        shouldRefine = anyChildSelected;
      }
    }

    if (shouldRefine && hasChildren) {
      reasonCounts.refined += 1;
      if (keptPrevious) {
        reasonCounts.keptPrevious += 1;
      }
      if (
        input.keepCoarseNodes &&
        input.previousSelection?.has(key) &&
        !selectedKeys.has(key)
      ) {
        selected.push({
          node,
          pixelRadius: info.pixelRadius,
          distance: info.distance,
        });
        selectedKeys.add(key);
        visiblePoints += node.pointCount;
        selectedLevels[node.level] = (selectedLevels[node.level] ?? 0) + 1;
        reasonCounts.selected += 1;
      }
      children
        .slice()
        .sort((a, b) => getInfo(b).pixelRadius - getInfo(a).pixelRadius)
        .forEach((child) => {
          queue.push({ node: child, priority: getInfo(child).pixelRadius });
        });
      continue;
    }

    if (!selectedKeys.has(key)) {
      selected.push({
        node,
        pixelRadius: info.pixelRadius,
        distance: info.distance,
      });
      selectedKeys.add(key);
      visiblePoints += node.pointCount;
      selectedLevels[node.level] = (selectedLevels[node.level] ?? 0) + 1;
      reasonCounts.selected += 1;
      if (keptPrevious) {
        reasonCounts.keptPrevious += 1;
      }
    }
  }

  return {
    selected,
    diagnostics: {
      visiblePoints,
      selectedCount: selected.length,
      selectedLevels,
      reasonCounts,
    },
  };
};
