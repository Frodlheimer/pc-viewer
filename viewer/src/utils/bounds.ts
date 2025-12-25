import type { Bounds } from "../types/Tile";
import type { Vec3 } from "../types/Point";

export const getBoundsCenter = (bounds: Bounds): Vec3 => {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
};

export const getBoundsSize = (bounds: Bounds): Vec3 => {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
  return [maxX - minX, maxY - minY, maxZ - minZ];
};
