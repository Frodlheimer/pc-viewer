import { fetchRange } from "./RangeFetch";
import { parsePct2Tile } from "./Pct2TileLoader";

export const loadTileFromContainer = async (
  containerUrl: string,
  offset: number,
  length: number
) => {
  const buffer = await fetchRange(containerUrl, offset, length);
  if (import.meta.env.DEV) {
    console.info("[container] tile loaded", { containerUrl, offset, length });
  }
  return parsePct2Tile(buffer);
};
