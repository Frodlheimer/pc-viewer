import { fetchRange } from "./RangeFetch";
import { parsePct2Tile } from "./Pct2TileLoader";

export const loadTileFromContainer = async (
  containerUrl: string,
  offset: number,
  length: number,
  signal?: AbortSignal
) => {
  const buffer = await fetchRange(containerUrl, offset, length, signal);
  if (import.meta.env.DEV) {
    console.info("[container] tile loaded", { containerUrl, offset, length });
  }
  return parsePct2Tile(buffer);
};
