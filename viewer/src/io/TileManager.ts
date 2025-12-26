import type {
  DatasetManifest,
  DatasetRoles,
  TileManifest,
} from "../types/Dataset";
import type {
  Bounds,
  RenderData,
  TileBounds,
  TileRenderData,
} from "../types/Tile";
import { getBoundsCenter } from "../utils/bounds";
import { loadTile } from "./TileLoader";
import { loadPct2Tile } from "./Pct2TileLoader";
import { loadTileFromContainer } from "./TileContainerLoader";
import type { TypedArray } from "../types/Pct2";

const toTileBounds = (bounds: Bounds): TileBounds => {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
};

const getTileUrl = (tile: TileManifest): string => {
  if (tile.url) {
    return tile.url;
  }
  if (tile.containerUrl) {
    throw new Error("Tile container references require range loading.");
  }
  throw new Error("Tile reference missing url.");
};

const isPct2Tile = (tile: TileManifest) =>
  tile.format === "pct2" ||
  (tile.url ? tile.url.toLowerCase().endsWith(".pct2") : false);

const loadPct1RenderData = async (
  tile: TileManifest
): Promise<TileRenderData> => {
  const data = await loadTile(getTileUrl(tile));
  return {
    id: tile.id,
    pointCount: data.pointCount,
    positions: data.positions,
    colors: data.colors,
    bounds: toTileBounds(tile.bounds),
  };
};

const loadPct2RenderData = async (
  tile: TileManifest,
  roles: DatasetRoles
): Promise<TileRenderData> => {
  const parsed = tile.containerUrl
    ? await loadTileFromContainer(tile.containerUrl, tile.byteOffset, tile.byteLength)
    : await loadPct2Tile(getTileUrl(tile));
  const positionName = roles.position;
  const rawPosition = parsed.attributes[positionName];
  if (!rawPosition) {
    throw new Error(`PCT2 tile missing position attribute (${positionName}).`);
  }

  const expectedPositions = parsed.pointCount * 3;
  const positions = decodePositions(rawPosition, expectedPositions, parsed.scale);

  const colorName = roles.color ?? "rgb";
  const rawColor = parsed.attributes[colorName];
  if (roles.color && !rawColor) {
    throw new Error(`PCT2 tile missing color attribute (${colorName}).`);
  }
  const colors = rawColor instanceof Uint8Array ? rawColor : undefined;
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

const decodePositions = (
  attribute: TypedArray,
  expectedLength: number,
  scale: [number, number, number]
): Float32Array => {
  if (attribute instanceof Float32Array) {
    if (attribute.length < expectedLength) {
      throw new Error("PCT2 position attribute truncated.");
    }
    return attribute;
  }

  if (!(attribute instanceof Int32Array)) {
    throw new Error("PCT2 position attribute must be int32x3.");
  }

  if (attribute.length < expectedLength) {
    throw new Error("PCT2 position attribute truncated.");
  }

  const decoded = new Float32Array(expectedLength);
  for (let i = 0; i < expectedLength; i += 3) {
    decoded[i] = attribute[i] * scale[0];
    decoded[i + 1] = attribute[i + 1] * scale[1];
    decoded[i + 2] = attribute[i + 2] * scale[2];
  }
  return decoded;
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
      isPct2Tile(tile)
        ? loadPct2RenderData(tile, manifest.roles)
        : loadPct1RenderData(tile)
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
