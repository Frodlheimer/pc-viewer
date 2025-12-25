import type { DatasetManifest } from "../types/Dataset";
import type { RenderData } from "../types/Tile";
import { getBoundsCenter } from "../utils/bounds";
import { loadTile } from "./TileLoader";

export const loadRenderData = async (
  manifest: DatasetManifest
): Promise<RenderData> => {
  const level = manifest.levels[0];
  if (!level) {
    throw new Error("Manifest has no levels.");
  }

  const tileResults = await Promise.all(
    level.tiles.map(async (tile) => ({
      tile,
      data: await loadTile(tile.url),
    }))
  );

  const totalPoints = tileResults.reduce(
    (sum, { data }) => sum + data.pointCount,
    0
  );

  const hasColors = tileResults.every(({ data }) => data.hasColors);
  const positions = new Float32Array(totalPoints * 3);
  const colors = hasColors ? new Uint8Array(totalPoints * 3) : undefined;

  let offset = 0;
  tileResults.forEach(({ data }) => {
    positions.set(data.positions, offset);
    if (colors && data.colors) {
      colors.set(data.colors, offset);
    }
    offset += data.pointCount * 3;
  });

  return {
    pointCount: totalPoints,
    positions,
    colors,
    bounds: manifest.bounds,
    center: getBoundsCenter(manifest.bounds),
  };
};
