import type { TileData } from "../types/Tile";

const MAGIC = "PCT1";

export const parseTile = (buffer: ArrayBuffer): TileData => {
  if (buffer.byteLength < 16) {
    throw new Error("Tile buffer too small.");
  }

  const headerView = new DataView(buffer, 0, 16);
  const magic = String.fromCharCode(
    headerView.getUint8(0),
    headerView.getUint8(1),
    headerView.getUint8(2),
    headerView.getUint8(3)
  );

  if (magic !== MAGIC) {
    throw new Error(`Tile magic mismatch (${magic}).`);
  }

  const version = headerView.getUint32(4, true);
  if (version !== 1) {
    throw new Error(`Unsupported tile version ${version}.`);
  }

  const pointCount = headerView.getUint32(8, true);
  const flags = headerView.getUint32(12, true);
  const hasColors = (flags & 1) === 1;

  const positionsByteLength = pointCount * 3 * 4;
  const positionsOffset = 16;
  const colorsByteLength = hasColors ? pointCount * 3 : 0;
  const colorsOffset = positionsOffset + positionsByteLength;
  const expectedLength = colorsOffset + colorsByteLength;

  if (buffer.byteLength < expectedLength) {
    throw new Error("Tile payload truncated.");
  }

  const positions = new Float32Array(buffer, positionsOffset, pointCount * 3);
  const colors = hasColors
    ? new Uint8Array(buffer, colorsOffset, pointCount * 3)
    : undefined;

  return {
    pointCount,
    positions,
    colors,
    hasColors,
  };
};

export const loadTile = async (url: string): Promise<TileData> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Tile load failed (${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  return parseTile(buffer);
};
