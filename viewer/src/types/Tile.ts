import type { Vec3 } from "./Point";

export type Bounds = [number, number, number, number, number, number];

export type TileData = {
  pointCount: number;
  positions: Float32Array;
  colors?: Uint8Array;
  hasColors: boolean;
};

export type RenderData = {
  pointCount: number;
  positions: Float32Array;
  colors?: Uint8Array;
  bounds: Bounds;
  center: Vec3;
};
