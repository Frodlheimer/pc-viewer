import { decompress } from "fzstd";
import {
  AttributeTypeEnum,
  CodecEnum,
  type Pct2AttributeDirectoryEntry,
  type Pct2Directory,
  type Pct2Header,
  type ParsedTile2,
  type TypedArray,
} from "../types/Pct2";

const MAGIC = "PCT2";
const FIXED_HEADER_BYTES = 76;
const DECODER = new TextDecoder();
const DEFAULT_LIMITS = {
  maxPointsPerTile: 10_000_000,
  maxCompressedAttributeBytes: 256 * 1024 * 1024,
  maxDecompressedAttributeBytes: 512 * 1024 * 1024,
} as const;

type BufferSource = ArrayBuffer | Uint8Array;

export type Pct2DecodeLimits = {
  maxPointsPerTile?: number;
  maxCompressedAttributeBytes?: number;
  maxDecompressedAttributeBytes?: number;
};

export type Pct2DecodeOptions = {
  limits?: Pct2DecodeLimits;
};

type AnyTypedArrayConstructor = {
  BYTES_PER_ELEMENT: number;
  new (
    buffer: ArrayBufferLike,
    byteOffset: number,
    length: number
  ): TypedArray;
};

const TYPE_INFO: Record<number, AnyTypedArrayConstructor> = {
  [AttributeTypeEnum.Int8]: Int8Array,
  [AttributeTypeEnum.Uint8]: Uint8Array,
  [AttributeTypeEnum.Int16]: Int16Array,
  [AttributeTypeEnum.Uint16]: Uint16Array,
  [AttributeTypeEnum.Int32]: Int32Array,
  [AttributeTypeEnum.Uint32]: Uint32Array,
  [AttributeTypeEnum.Float32]: Float32Array,
  [AttributeTypeEnum.Float64]: Float64Array,
};

const readMagic = (view: DataView) =>
  String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );

const readVec3 = (view: DataView, offset: number): [number, number, number] => [
  view.getFloat64(offset, true),
  view.getFloat64(offset + 8, true),
  view.getFloat64(offset + 16, true),
];

const getSourceBuffer = (buffer: BufferSource) =>
  buffer instanceof Uint8Array ? buffer.buffer : buffer;

const getSourceOffset = (buffer: BufferSource) =>
  buffer instanceof Uint8Array ? buffer.byteOffset : 0;

const decodeName = (buffer: ArrayBufferLike, offset: number, length: number) =>
  DECODER.decode(new Uint8Array(buffer, offset, length));

const toNodeId = (value: bigint): bigint | number =>
  value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;

const resolveLimit = (value: number | undefined, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;

const resolveLimits = (limits: Pct2DecodeLimits | undefined) => ({
  maxPointsPerTile: resolveLimit(
    limits?.maxPointsPerTile,
    DEFAULT_LIMITS.maxPointsPerTile
  ),
  maxCompressedAttributeBytes: resolveLimit(
    limits?.maxCompressedAttributeBytes,
    DEFAULT_LIMITS.maxCompressedAttributeBytes
  ),
  maxDecompressedAttributeBytes: resolveLimit(
    limits?.maxDecompressedAttributeBytes,
    DEFAULT_LIMITS.maxDecompressedAttributeBytes
  ),
});

const decodePositions = (
  attribute: TypedArray,
  pointCount: number,
  scale: [number, number, number]
) => {
  const elementCount = pointCount * 3;
  if (attribute instanceof Float32Array) {
    if (attribute.length < elementCount) {
      throw new Error("PCT2 position attribute truncated.");
    }
    return attribute.subarray(0, elementCount);
  }

  if (!(attribute instanceof Int32Array)) {
    throw new Error("PCT2 position attribute must be int32x3.");
  }

  if (attribute.length < elementCount) {
    throw new Error("PCT2 position attribute truncated.");
  }

  const decoded = new Float32Array(elementCount);
  for (let i = 0; i < elementCount; i += 3) {
    decoded[i] = attribute[i] * scale[0];
    decoded[i + 1] = attribute[i + 1] * scale[1];
    decoded[i + 2] = attribute[i + 2] * scale[2];
  }
  return decoded;
};

type MandatoryDecodeOptions = {
  positionName: string;
  colorName?: string;
  allowMissingColor?: boolean;
};

type MandatoryDecodeResult = {
  positions: Float32Array;
  colors?: Uint8Array;
  positionName: string;
  colorName?: string;
};

export const parsePct2HeaderAndDirectory = (
  buffer: BufferSource,
  options?: Pct2DecodeOptions
): { header: Pct2Header; directory: Pct2Directory } => {
  if (buffer.byteLength < FIXED_HEADER_BYTES) {
    throw new Error("PCT2 header truncated.");
  }

  const limits = resolveLimits(options?.limits);
  const sourceBuffer = getSourceBuffer(buffer);
  const sourceOffset = getSourceOffset(buffer);
  const view = new DataView(sourceBuffer, sourceOffset, buffer.byteLength);
  const magic = readMagic(view);
  if (magic !== MAGIC) {
    throw new Error(`PCT2 magic mismatch (${magic}).`);
  }

  const version = view.getUint16(4, true);
  if (version !== 1) {
    throw new Error(`Unsupported PCT2 version ${version}.`);
  }

  const headerBytes = view.getUint16(6, true);
  if (headerBytes < FIXED_HEADER_BYTES || headerBytes > buffer.byteLength) {
    throw new Error("PCT2 headerBytes out of range.");
  }

  const nodeId = toNodeId(view.getBigUint64(8, true));
  const pointCount = view.getUint32(16, true);
  if (pointCount > limits.maxPointsPerTile) {
    throw new Error(
      `PCT2 tile exceeds maxPointsPerTile (${pointCount} > ${limits.maxPointsPerTile}).`
    );
  }
  const flags = view.getUint32(20, true);
  const origin = readVec3(view, 24);
  const scale = readVec3(view, 48);
  const attrCount = view.getUint16(72, true);
  const reserved = view.getUint16(74, true);

  if (reserved !== 0) {
    throw new Error("PCT2 reserved field must be 0.");
  }

  const payloadStart = headerBytes;
  const header: Pct2Header = {
    magic,
    version,
    headerBytes,
    nodeId,
    pointCount,
    flags,
    origin,
    scale,
    attrCount,
    payloadStart,
  };
  let cursor = FIXED_HEADER_BYTES;
  const attributes: Pct2AttributeDirectoryEntry[] = [];
  const byName: Record<string, Pct2AttributeDirectoryEntry> = {};

  for (let index = 0; index < attrCount; index += 1) {
    if (cursor + 1 > headerBytes) {
      throw new Error("PCT2 attribute directory truncated.");
    }

    const nameLen = view.getUint8(cursor);
    cursor += 1;

    if (cursor + nameLen > headerBytes) {
      throw new Error("PCT2 attribute name exceeds header.");
    }

    const name = decodeName(sourceBuffer, sourceOffset + cursor, nameLen);
    cursor += nameLen;

    const requiredBytes = 1 + 1 + 1 + 1 + 4 + 4 + 4;
    if (cursor + requiredBytes > headerBytes) {
      throw new Error("PCT2 attribute entry truncated.");
    }

    const type = view.getUint8(cursor) as AttributeTypeEnum;
    cursor += 1;
    const components = view.getUint8(cursor);
    cursor += 1;
    const codec = view.getUint8(cursor) as CodecEnum;
    cursor += 1;
    const normalized = view.getUint8(cursor) as 0 | 1;
    cursor += 1;
    const byteOffset = view.getUint32(cursor, true);
    cursor += 4;
    const byteLength = view.getUint32(cursor, true);
    cursor += 4;
    const uncompressedByteLength = view.getUint32(cursor, true);
    cursor += 4;

    if (components < 1 || components > 4) {
      throw new Error(`PCT2 invalid component count (${components}).`);
    }

    if (normalized !== 0 && normalized !== 1) {
      throw new Error(`PCT2 normalized flag invalid (${normalized}).`);
    }

    const payloadOffset = payloadStart + byteOffset;
    if (
      payloadOffset < payloadStart ||
      payloadOffset + byteLength > buffer.byteLength
    ) {
      throw new Error("PCT2 attribute block out of range.");
    }

    if (codec !== CodecEnum.None && codec !== CodecEnum.Zstd) {
      throw new Error(`PCT2 codec ${codec} not supported.`);
    }

    if (codec === CodecEnum.None) {
      if (
        uncompressedByteLength !== 0 &&
        uncompressedByteLength !== byteLength
      ) {
        throw new Error("PCT2 uncompressed byte length mismatch.");
      }
    } else if (uncompressedByteLength === 0) {
      throw new Error(
        "PCT2 compressed attribute missing uncompressedByteLength."
      );
    }

    const ArrayType = TYPE_INFO[type];
    if (!ArrayType) {
      throw new Error(`PCT2 unsupported attribute type ${type}.`);
    }

    const elementCount = pointCount * components;
    const expectedByteLength = elementCount * ArrayType.BYTES_PER_ELEMENT;
    if (expectedByteLength > limits.maxDecompressedAttributeBytes) {
      throw new Error(
        `PCT2 attribute exceeds maxDecompressedAttributeBytes (${name}, ${expectedByteLength} > ${limits.maxDecompressedAttributeBytes}).`
      );
    }
    if (byteLength > limits.maxCompressedAttributeBytes) {
      throw new Error(
        `PCT2 attribute exceeds maxCompressedAttributeBytes (${name}, ${byteLength} > ${limits.maxCompressedAttributeBytes}).`
      );
    }
    if (codec === CodecEnum.None && byteLength < expectedByteLength) {
      throw new Error("PCT2 attribute payload truncated.");
    }
    if (byName[name]) {
      throw new Error(`PCT2 duplicate attribute name (${name}).`);
    }

    const entry: Pct2AttributeDirectoryEntry = {
      name,
      type,
      components,
      codec,
      normalized,
      byteOffset,
      byteLength,
      uncompressedByteLength,
      payloadOffset,
    };
    attributes.push(entry);
    byName[name] = entry;
  }

  return {
    header,
    directory: {
      header,
      attributes,
      byName,
    },
  };
};

export const decodePct2Attributes = (
  buffer: BufferSource,
  directory: Pct2Directory,
  attrNames: string[],
  options?: Pct2DecodeOptions
): Record<string, TypedArray> => {
  const sourceBuffer = getSourceBuffer(buffer);
  const sourceOffset = getSourceOffset(buffer);
  const limits = resolveLimits(options?.limits);
  const attributes: Record<string, TypedArray> = {};
  const uniqueNames = Array.from(new Set(attrNames));
  for (const name of uniqueNames) {
    const entry = directory.byName[name];
    if (!entry) {
      throw new Error(`PCT2 attribute missing (${name}).`);
    }
    const ArrayType = TYPE_INFO[entry.type];
    if (!ArrayType) {
      throw new Error(`PCT2 unsupported attribute type ${entry.type}.`);
    }
    const elementCount = directory.header.pointCount * entry.components;
    const expectedByteLength = elementCount * ArrayType.BYTES_PER_ELEMENT;
    if (expectedByteLength > limits.maxDecompressedAttributeBytes) {
      throw new Error(
        `PCT2 attribute exceeds maxDecompressedAttributeBytes (${name}, ${expectedByteLength} > ${limits.maxDecompressedAttributeBytes}).`
      );
    }
    if (entry.byteLength > limits.maxCompressedAttributeBytes) {
      throw new Error(
        `PCT2 attribute exceeds maxCompressedAttributeBytes (${name}, ${entry.byteLength} > ${limits.maxCompressedAttributeBytes}).`
      );
    }
    if (entry.payloadOffset + entry.byteLength > buffer.byteLength) {
      throw new Error("PCT2 attribute block out of range.");
    }

    if (entry.codec === CodecEnum.None) {
      if (entry.byteLength < expectedByteLength) {
        throw new Error("PCT2 attribute payload truncated.");
      }
      attributes[name] = new ArrayType(
        sourceBuffer,
        sourceOffset + entry.payloadOffset,
        elementCount
      );
      continue;
    }

    if (entry.codec === CodecEnum.Zstd) {
      if (entry.uncompressedByteLength !== expectedByteLength) {
        throw new Error(
          `PCT2 uncompressed size mismatch for ${name} (${entry.uncompressedByteLength} != ${expectedByteLength}).`
        );
      }

      const compressed = new Uint8Array(
        sourceBuffer,
        sourceOffset + entry.payloadOffset,
        entry.byteLength
      );
      const decompressed = decompress(compressed);
      if (decompressed.byteLength > limits.maxDecompressedAttributeBytes) {
        throw new Error(
          `PCT2 zstd output exceeds maxDecompressedAttributeBytes (${name}, ${decompressed.byteLength} > ${limits.maxDecompressedAttributeBytes}).`
        );
      }
      if (decompressed.byteLength < expectedByteLength) {
        throw new Error(`PCT2 zstd payload truncated for ${name}.`);
      }
      const bytes =
        decompressed.byteLength === expectedByteLength &&
        decompressed.byteOffset === 0 &&
        decompressed.buffer.byteLength === expectedByteLength
          ? decompressed
          : decompressed.slice(0, expectedByteLength);
      attributes[name] = new ArrayType(
        bytes.buffer,
        bytes.byteOffset,
        elementCount
      );
      continue;
    }

    throw new Error(`PCT2 codec ${entry.codec} not supported yet (${name}).`);
  }
  return attributes;
};

export const decodePct2Mandatory = (
  buffer: BufferSource,
  directory: Pct2Directory,
  options: MandatoryDecodeOptions,
  decodeOptions?: Pct2DecodeOptions
): MandatoryDecodeResult => {
  const positionName = options.positionName;
  const colorName = options.colorName;
  const allowMissingColor = options.allowMissingColor ?? false;
  const attrNames = [positionName];
  if (colorName && directory.byName[colorName]) {
    attrNames.push(colorName);
  } else if (colorName && !allowMissingColor) {
    throw new Error(`PCT2 tile missing color attribute (${colorName}).`);
  }
  const attributes = decodePct2Attributes(buffer, directory, attrNames, decodeOptions);
  const rawPosition = attributes[positionName];
  if (!rawPosition) {
    throw new Error(`PCT2 tile missing position attribute (${positionName}).`);
  }
  const positions = decodePositions(
    rawPosition,
    directory.header.pointCount,
    directory.header.scale
  );

  let colors: Uint8Array | undefined;
  if (colorName) {
    const rawColor = attributes[colorName];
    if (rawColor instanceof Uint8Array) {
      if (rawColor.length < directory.header.pointCount * 3) {
        throw new Error("PCT2 rgb attribute truncated.");
      }
      colors = rawColor.subarray(0, directory.header.pointCount * 3);
    }
  }

  return {
    positions,
    colors,
    positionName,
    colorName,
  };
};

export const parsePct2TileEager = (
  buffer: BufferSource,
  options?: Pct2DecodeOptions
): ParsedTile2 => {
  const { header, directory } = parsePct2HeaderAndDirectory(buffer, options);
  const attrNames = directory.attributes.map((entry) => entry.name);
  const attributes = decodePct2Attributes(buffer, directory, attrNames, options);
  const position = attributes.position;
  if (position) {
    attributes.position = decodePositions(
      position,
      header.pointCount,
      header.scale
    );
  }
  return {
    nodeId: header.nodeId,
    pointCount: header.pointCount,
    origin: header.origin,
    scale: header.scale,
    attributes,
  };
};

export const parsePct2Tile = (
  buffer: BufferSource,
  options?: Pct2DecodeOptions
): ParsedTile2 => {
  const { header, directory } = parsePct2HeaderAndDirectory(buffer, options);
  const mandatory = decodePct2Mandatory(
    buffer,
    directory,
    {
      positionName: "position",
      colorName: "rgb",
      allowMissingColor: true,
    },
    options
  );
  const attributes: Record<string, TypedArray> = {
    [mandatory.positionName]: mandatory.positions,
  };
  if (mandatory.colors && mandatory.colorName) {
    attributes[mandatory.colorName] = mandatory.colors;
  }
  return {
    nodeId: header.nodeId,
    pointCount: header.pointCount,
    origin: header.origin,
    scale: header.scale,
    attributes,
  };
};

export const loadPct2TileBuffer = async (
  url: string,
  signal?: AbortSignal
): Promise<ArrayBuffer> => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`PCT2 tile load failed (${response.status})`);
  }
  return response.arrayBuffer();
};

export const loadPct2Tile = async (
  url: string,
  signal?: AbortSignal
): Promise<ParsedTile2> => {
  const buffer = await loadPct2TileBuffer(url, signal);
  return parsePct2Tile(buffer);
};

export const loadPct2TileEager = async (
  url: string,
  signal?: AbortSignal
): Promise<ParsedTile2> => {
  const buffer = await loadPct2TileBuffer(url, signal);
  return parsePct2TileEager(buffer);
};
