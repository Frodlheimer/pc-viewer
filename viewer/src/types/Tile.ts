import type { Vec3 } from "./Point";

export type Bounds = [number, number, number, number, number, number];

export type TileBounds = {
  min: Vec3;
  max: Vec3;
};

export type TileData = {
  pointCount: number;
  positions: Float32Array;
  colors?: Uint8Array;
  hasColors: boolean;
};

export type TileRenderData = {
  id: string;
  nodeId?: bigint | number;
  pointCount: number;
  positions: Float32Array;
  colors?: Uint8Array;
  origin?: Vec3;
  bounds: TileBounds;
};

export type RenderData = {
  tiles: TileRenderData[];
  pointCountTotal: number;
  bounds: Bounds;
  center: Vec3;
};
