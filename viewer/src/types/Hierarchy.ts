import type { Vec3 } from "./Point";

export type QuantizedBounds = {
  min: Vec3;
  max: Vec3;
};

export type NodeRecord = {
  nodeId: bigint | number;
  parentId: bigint | number;
  level: number;
  childMask: number;
  pointCount: number;
  bounds: QuantizedBounds;
  containerIndex: number;
  byteOffset: number;
  byteLength: number;
  statsOffset: number;
  statsLength: number;
};

export type Page = {
  pageIndex: number;
  pageBytes: number;
  recordCount: number;
  records: NodeRecord[];
};
