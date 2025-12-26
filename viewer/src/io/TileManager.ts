import type { DatasetManifest, TileManifest } from "../types/Dataset";
import type { Bounds, RenderData, TileBounds, TileRenderData } from "../types/Tile";
import { getBoundsCenter } from "../utils/bounds";
import { loadTile } from "./TileLoader";
import { loadPct2Tile } from "./Pct2TileLoader";

const toTileBounds = (bounds: Bounds): TileBounds => {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
};

const isPct2Tile = (tile: TileManifest) =>
  tile.format === "pct2" || tile.url.toLowerCase().endsWith(".pct2");

const loadPct1RenderData = async (
  tile: TileManifest
): Promise<TileRenderData> => {
  const data = await loadTile(tile.url);
  return {
    id: tile.id,
    pointCount: data.pointCount,
    positions: data.positions,
    colors: data.colors,
    bounds: toTileBounds(tile.bounds),
  };
};

const loadPct2RenderData = async (
  tile: TileManifest
): Promise<TileRenderData> => {
  const parsed = await loadPct2Tile(tile.url);
  const positions = parsed.attributes.position;
  if (!positions || !(positions instanceof Float32Array)) {
    throw new Error("PCT2 tile missing position attribute.");
  }

  const expectedPositions = parsed.pointCount * 3;
  if (positions.length < expectedPositions) {
    throw new Error("PCT2 position attribute truncated.");
  }

  const rgbAttribute = parsed.attributes.rgb;
  const colors = rgbAttribute instanceof Uint8Array ? rgbAttribute : undefined;
  if (colors && colors.length < parsed.pointCount * 3) {
    throw new Error("PCT2 rgb attribute truncated.");
  }

  return {
    id: tile.id,
    nodeId: parsed.nodeId,
    pointCount: parsed.pointCount,
    positions,
    colors,
    origin: parsed.origin,
    bounds: toTileBounds(tile.bounds),
  };
};

export const loadRenderData = async (
  manifest: DatasetManifest
): Promise<RenderData> => {
  const level = manifest.levels[0];
  if (!level) {
    throw new Error("Manifest has no levels.");
  }

  const tiles = await Promise.all(
    level.tiles.map((tile) =>
      isPct2Tile(tile) ? loadPct2RenderData(tile) : loadPct1RenderData(tile)
    )
  );

  const pointCountTotal = tiles.reduce(
    (sum, tile) => sum + tile.pointCount,
    0
  );

  return {
    tiles,
    pointCountTotal,
    bounds: manifest.bounds,
    center: getBoundsCenter(manifest.bounds),
  };
};
