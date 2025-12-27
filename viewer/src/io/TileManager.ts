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
import type { CachedTileEntry, TileSource } from "../types/TileCache";
import { getBoundsCenter } from "../utils/bounds";
import type { NodeRecord } from "../types/Hierarchy";
import { loadTile } from "./TileLoader";
import {
  decodePct2Mandatory as decodePct2MandatoryAttributes,
  loadPct2TileBuffer,
  parsePct2HeaderAndDirectory,
} from "./Pct2TileLoader";
import { loadTileBufferFromContainer } from "./TileContainerLoader";
import { keyFromNodeId } from "../utils/nodeKey";

const hashStringToNodeId = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const resolveNodeId = (
  tile: TileManifest,
  fallback?: bigint | number
): bigint | number =>
  tile.nodeId ?? fallback ?? hashStringToNodeId(tile.id);

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
  tile: TileManifest,
  signal?: AbortSignal
): Promise<TileRenderData> => {
  const data = await loadTile(getTileUrl(tile), signal);
  const nodeId = resolveNodeId(tile);
  return {
    id: tile.id,
    nodeId,
    pointCount: data.pointCount,
    positions: data.positions,
    colors: data.colors,
    bounds: toTileBounds(tile.bounds),
  };
};

const loadPct2Buffer = async (
  tile: TileManifest,
  signal?: AbortSignal
): Promise<ArrayBuffer> => {
  if (tile.containerUrl) {
    if (tile.byteOffset === undefined || tile.byteLength === undefined) {
      throw new Error("Tile container reference missing byte range.");
    }
    return loadTileBufferFromContainer(
      tile.containerUrl,
      tile.byteOffset,
      tile.byteLength,
      signal,
      { nodeId: tile.nodeId, tileId: tile.id }
    );
  }
  return loadPct2TileBuffer(getTileUrl(tile), signal);
};

const decodePct2MandatoryData = (
  buffer: ArrayBuffer,
  tile: TileManifest,
  roles: DatasetRoles
) => {
  const { header, directory } = parsePct2HeaderAndDirectory(buffer);
  const mandatory = decodePct2MandatoryAttributes(buffer, directory, {
    positionName: roles.position,
    colorName: roles.color ?? "rgb",
    allowMissingColor: !roles.color,
  });

  const nodeId = resolveNodeId(tile, header.nodeId);
  const renderData: TileRenderData = {
    id: tile.id,
    nodeId,
    pointCount: header.pointCount,
    positions: mandatory.positions,
    colors: mandatory.colors,
    origin: header.origin,
    bounds: toTileBounds(tile.bounds),
  };

  return { renderData, directory, header };
};

const getTileSource = (tile: TileManifest, format: "pct1" | "pct2"): TileSource => {
  if (format === "pct1") {
    return { format, url: getTileUrl(tile) };
  }
  if (tile.containerUrl) {
    return {
      format,
      containerUrl: tile.containerUrl,
      byteOffset: tile.byteOffset,
      byteLength: tile.byteLength,
    };
  }
  return { format, url: getTileUrl(tile) };
};

const loadPct2RenderData = async (
  tile: TileManifest,
  roles: DatasetRoles,
  signal?: AbortSignal
): Promise<TileRenderData> => {
  const buffer = await loadPct2Buffer(tile, signal);
  const { renderData } = decodePct2MandatoryData(buffer, tile, roles);
  return renderData;
};

const loadPct2TileEntry = async (
  tile: TileManifest,
  roles: DatasetRoles,
  signal?: AbortSignal
): Promise<CachedTileEntry> => {
  const buffer = await loadPct2Buffer(tile, signal);
  const { renderData, directory } = decodePct2MandatoryData(
    buffer,
    tile,
    roles
  );
  if (renderData.nodeId === undefined) {
    throw new Error("PCT2 tile missing nodeId.");
  }
  const nodeKey = keyFromNodeId(renderData.nodeId);
  return {
    key: nodeKey,
    renderData,
    directory,
    rawBuffer: buffer,
    decodedOptional: new Map(),
    source: getTileSource(tile, "pct2"),
  };
};

export const loadTileForNode = async (
  manifest: DatasetManifest,
  node: NodeRecord,
  signal?: AbortSignal
): Promise<CachedTileEntry> =>
  loadPct2TileEntry(
    toTileManifestFromNode(node, manifest),
    manifest.roles,
    signal
  );

export const loadTilesForNodes = async (
  manifest: DatasetManifest,
  nodes: NodeRecord[]
): Promise<CachedTileEntry[]> =>
  Promise.all(nodes.map((node) => loadTileForNode(manifest, node)));

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
