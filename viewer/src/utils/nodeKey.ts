import type { NodeRecord } from "../types/Hierarchy";
import type { TileRenderData } from "../types/Tile";

export const keyFromNodeId = (nodeId: NodeRecord["nodeId"]) =>
  typeof nodeId === "bigint" ? nodeId.toString() : String(nodeId);

export const keyFromTile = (tile: TileRenderData) =>
  tile.nodeId !== undefined ? keyFromNodeId(tile.nodeId) : tile.id;
