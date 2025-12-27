import { loadPct2TileEager } from "./Pct2TileLoader";
import type { ParsedTile2 } from "../types/Pct2";

type AttributeSummary = {
  name: string;
  type: string;
  length: number;
};

const summarizeAttributes = (tile: ParsedTile2): AttributeSummary[] =>
  Object.entries(tile.attributes).map(([name, data]) => ({
    name,
    type: data.constructor.name,
    length: data.length,
  }));

export const debugPct2Tile = async (url: string) => {
  const tile = await loadPct2TileEager(url);
  const summary = {
    nodeId: tile.nodeId,
    pointCount: tile.pointCount,
    origin: tile.origin,
    scale: tile.scale,
    attributes: summarizeAttributes(tile),
  };
  console.log("PCT2 tile summary", summary);
  return summary;
};
