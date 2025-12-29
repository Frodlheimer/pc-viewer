import { describe, expect, it } from "vitest";
import { AttributeTypeEnum, CodecEnum } from "../types/Pct2";
import { parsePct2Tile } from "./Pct2TileLoader";

const buildPct2Buffer = () => {
  const name = "position";
  const nameBytes = new TextEncoder().encode(name);
  const rawHeaderBytes = 76 + 1 + nameBytes.length + 16;
  const headerBytes = Math.ceil(rawHeaderBytes / 4) * 4;
  const pointCount = 1;
  const payloadBytes = pointCount * 3 * 4;
  const buffer = new ArrayBuffer(headerBytes + payloadBytes);
  const view = new DataView(buffer);

  view.setUint8(0, "P".charCodeAt(0));
  view.setUint8(1, "C".charCodeAt(0));
  view.setUint8(2, "T".charCodeAt(0));
  view.setUint8(3, "2".charCodeAt(0));
  view.setUint16(4, 1, true);
  view.setUint16(6, headerBytes, true);
  view.setBigUint64(8, 1n, true);
  view.setUint32(16, pointCount, true);
  view.setUint32(20, 0, true);
  view.setFloat64(24, 0, true);
  view.setFloat64(32, 0, true);
  view.setFloat64(40, 0, true);
  view.setFloat64(48, 1, true);
  view.setFloat64(56, 1, true);
  view.setFloat64(64, 1, true);
  view.setUint16(72, 1, true);
  view.setUint16(74, 0, true);

  let cursor = 76;
  view.setUint8(cursor, nameBytes.length);
  cursor += 1;
  nameBytes.forEach((value) => {
    view.setUint8(cursor, value);
    cursor += 1;
  });
  view.setUint8(cursor, AttributeTypeEnum.Float32);
  cursor += 1;
  view.setUint8(cursor, 3);
  cursor += 1;
  view.setUint8(cursor, CodecEnum.None);
  cursor += 1;
  view.setUint8(cursor, 0);
  cursor += 1;
  view.setUint32(cursor, 0, true);
  cursor += 4;
  view.setUint32(cursor, payloadBytes, true);
  cursor += 4;
  view.setUint32(cursor, 0, true);

  const payloadStart = headerBytes;
  const positions = new Float32Array(buffer, payloadStart, pointCount * 3);
  positions.set([1, 2, 3]);
  return buffer;
};

describe("Pct2TileLoader", () => {
  it("keeps float32 position data as a view (no copy)", () => {
    const buffer = buildPct2Buffer();
    const parsed = parsePct2Tile(buffer);
    const positions = parsed.attributes.position as Float32Array;
    expect(positions.buffer).toBe(buffer);
    expect(Array.from(positions)).toEqual([1, 2, 3]);
  });

  it("fails cleanly when attribute offsets exceed the buffer", () => {
    const buffer = buildPct2Buffer();
    const view = new DataView(buffer);
    view.setUint32(89, 1000, true);
    expect(() => parsePct2Tile(buffer)).toThrow(/attribute block out of range/i);
  });

  it("enforces maxPointsPerTile limits", () => {
    const buffer = buildPct2Buffer();
    const view = new DataView(buffer);
    view.setUint32(16, 2, true);
    expect(() =>
      parsePct2Tile(buffer, { limits: { maxPointsPerTile: 1 } })
    ).toThrow(/maxPointsPerTile/i);
  });
});
