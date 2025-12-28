import { afterEach, describe, expect, it, vi } from "vitest";
import { AttributeTypeEnum, CodecEnum } from "../types/Pct2";

const buildPct2ZstdBuffer = () => {
  const name = "position";
  const nameBytes = new TextEncoder().encode(name);
  const rawHeaderBytes = 76 + 1 + nameBytes.length + 16;
  const headerBytes = Math.ceil(rawHeaderBytes / 4) * 4;
  const pointCount = 1;
  const expectedByteLength = pointCount * 3 * 4;
  const compressedBytes = 4;
  const buffer = new ArrayBuffer(headerBytes + compressedBytes);
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
  view.setUint8(cursor, CodecEnum.Zstd);
  cursor += 1;
  view.setUint8(cursor, 0);
  cursor += 1;
  view.setUint32(cursor, 0, true);
  cursor += 4;
  view.setUint32(cursor, compressedBytes, true);
  cursor += 4;
  view.setUint32(cursor, expectedByteLength, true);

  return buffer;
};

describe("Pct2TileLoader (zstd)", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("trims oversized decompressed buffers to the expected byteLength", async () => {
    const oversized = new Uint8Array(64);
    new Float32Array(oversized.buffer, 0, 3).set([1, 2, 3]);

    vi.doMock("fzstd", () => ({
      decompress: () => oversized,
    }));

    const { parsePct2Tile } = await import("./Pct2TileLoader");
    const parsed = parsePct2Tile(buildPct2ZstdBuffer());
    const positions = parsed.attributes.position as Float32Array;
    expect(Array.from(positions)).toEqual([1, 2, 3]);
    expect(positions.buffer.byteLength).toBe(12);
  });

  it("throws a clear error when the decompressed payload is truncated", async () => {
    vi.doMock("fzstd", () => ({
      decompress: () => new Uint8Array(8),
    }));

    const { parsePct2Tile } = await import("./Pct2TileLoader");
    expect(() => parsePct2Tile(buildPct2ZstdBuffer())).toThrow(
      /zstd payload truncated/i
    );
  });
});
