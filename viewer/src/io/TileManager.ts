import type {
  BoundsQuantization,
  DatasetManifest,
  DatasetRoles,
  TileContainer,
  TileManifest,
} from "../types/Dataset";
import type {
  Bounds,
  RenderData,
  TileBounds,
  TileRenderData,
} from "../types/Tile";
import { getBoundsCenter } from "../utils/bounds";
import type { NodeRecord } from "../types/Hierarchy";
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

const getContainerUrl = (
  containers: TileContainer[] | undefined,
  index: number
): string => {
  if (!containers || containers.length === 0) {
    throw new Error("Hierarchy dataset missing containers.");
  }
  const container = containers[index];
  if (!container) {
    throw new Error(`Container index ${index} missing.`);
  }
  return container.url;
};

const decodeQuantizedBounds = (
  bounds: NodeRecord["bounds"],
  quantization: BoundsQuantization
): Bounds => {
  const [ox, oy, oz] = quantization.origin;
  const [sx, sy, sz] = quantization.scale;
  const minX = ox + bounds.min[0] * sx;
  const minY = oy + bounds.min[1] * sy;
  const minZ = oz + bounds.min[2] * sz;
  const maxX = ox + bounds.max[0] * sx;
  const maxY = oy + bounds.max[1] * sy;
  const maxZ = oz + bounds.max[2] * sz;
  return [minX, minY, minZ, maxX, maxY, maxZ];
};

const toTileManifestFromNode = (
  node: NodeRecord,
  manifest: DatasetManifest
): TileManifest => {
  const bounds = decodeQuantizedBounds(node.bounds, manifest.boundsQuantization);
  return {
    id: `node-${String(node.nodeId)}`,
    nodeId: node.nodeId,
    bounds,
    pointCount: node.pointCount,
    format: "pct2",
    containerUrl: getContainerUrl(manifest.containers, node.containerIndex),
    byteOffset: node.byteOffset,
    byteLength: node.byteLength,
  };
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
  if (tile.containerUrl) {
    if (tile.byteOffset === undefined || tile.byteLength === undefined) {
      throw new Error("Tile container reference missing byte range.");
    }
  }

  const parsed = tile.containerUrl
    ? await loadTileFromContainer(
        tile.containerUrl,
        tile.byteOffset,
        tile.byteLength
      )
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
    nodeId: tile.nodeId ?? parsed.nodeId,
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

export const loadTilesForNodes = async (
  manifest: DatasetManifest,
  nodes: NodeRecord[]
): Promise<TileRenderData[]> => {
  const tiles = await Promise.all(
    nodes.map((node) =>
      loadPct2RenderData(toTileManifestFromNode(node, manifest), manifest.roles)
    )
  );
  return tiles;
};

const loadTilesForManifestTiles = async (
  manifest: DatasetManifest
): Promise<TileRenderData[]> => {
  const level = manifest.levels[0];
  if (!level) {
    throw new Error("Manifest has no levels.");
  }

  return Promise.all(
    level.tiles.map((tile) =>
      isPct2Tile(tile)
        ? loadPct2RenderData(tile, manifest.roles)
        : loadPct1RenderData(tile)
    )
  );
};

export const loadRenderData = async (
  manifest: DatasetManifest
): Promise<RenderData> => {
  const tiles = await loadTilesForManifestTiles(manifest);

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
