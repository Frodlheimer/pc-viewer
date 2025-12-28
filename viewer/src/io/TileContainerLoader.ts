import { fetchRangeView, getKnownTotalSize } from "./RangeFetch";
import { parsePct2Tile } from "./Pct2TileLoader";

type TileRangeContext = {
  nodeId?: bigint | number;
  tileId?: string;
};

export const loadTileBufferFromContainer = async (
  containerUrl: string,
  offset: number,
  length: number,
  signal?: AbortSignal,
  context?: TileRangeContext
): Promise<Uint8Array> => {
  if (offset < 0 || length <= 0) {
    const message = "Tile container range invalid.";
    console.error("[container] invalid range", {
      containerUrl,
      offset,
      length,
      nodeId: context?.nodeId,
      tileId: context?.tileId,
    });
    throw new Error(message);
  }

  const totalSize = getKnownTotalSize(containerUrl);
  if (totalSize !== null && offset + length > totalSize) {
    console.error("[container] range exceeds payload size", {
      containerUrl,
      offset,
      length,
      totalSize,
      nodeId: context?.nodeId,
      tileId: context?.tileId,
    });
    throw new Error("Tile container range exceeds payload size.");
  }

  try {
    const buffer = await fetchRangeView(containerUrl, offset, length, signal, {
      allowFullFileFallback: false,
    });
    if (import.meta.env.DEV) {
      console.info("[container] tile loaded", { containerUrl, offset, length });
    }
    return buffer;
  } catch (error) {
    console.error("[container] tile load failed", {
      containerUrl,
      offset,
      length,
      nodeId: context?.nodeId,
      tileId: context?.tileId,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
};

export const loadTileFromContainer = async (
  containerUrl: string,
  offset: number,
  length: number,
  signal?: AbortSignal,
  context?: TileRangeContext
) => {
  const buffer = await loadTileBufferFromContainer(
    containerUrl,
    offset,
    length,
    signal,
    context
  );
  return parsePct2Tile(buffer);
};
