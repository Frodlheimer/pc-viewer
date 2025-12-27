import {
  AttributeTypeEnum,
  CodecEnum,
  type ParsedTile2,
  type TypedArray,
} from "../types/Pct2";

const MAGIC = "PCT2";
const FIXED_HEADER_BYTES = 76;

type AnyTypedArrayConstructor = {
  BYTES_PER_ELEMENT: number;
  new (buffer: ArrayBuffer, byteOffset: number, length: number): TypedArray;
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

const decodeName = (buffer: ArrayBuffer, offset: number, length: number) =>
  new TextDecoder().decode(new Uint8Array(buffer, offset, length));

const toNodeId = (value: bigint): bigint | number =>
  value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;

const decodePositions = (
  buffer: ArrayBuffer,
  byteOffset: number,
  pointCount: number,
  scale: [number, number, number]
) => {
  const elementCount = pointCount * 3;
  const intView = new Int32Array(buffer, byteOffset, elementCount);
  const decoded = new Float32Array(elementCount);
  for (let i = 0; i < elementCount; i += 3) {
    decoded[i] = intView[i] * scale[0];
    decoded[i + 1] = intView[i + 1] * scale[1];
    decoded[i + 2] = intView[i + 2] * scale[2];
  }
  return decoded;
};

export const parsePct2Tile = (buffer: ArrayBuffer): ParsedTile2 => {
  if (buffer.byteLength < FIXED_HEADER_BYTES) {
    throw new Error("PCT2 header truncated.");
  }

  const view = new DataView(buffer);
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
  const origin = readVec3(view, 24);
  const scale = readVec3(view, 48);
  const attrCount = view.getUint16(72, true);
  const reserved = view.getUint16(74, true);

  if (reserved !== 0) {
    throw new Error("PCT2 reserved field must be 0.");
  }

  const payloadStart = headerBytes;
  let cursor = FIXED_HEADER_BYTES;
  const attributes: Record<string, TypedArray> = {};

  for (let index = 0; index < attrCount; index += 1) {
    if (cursor + 1 > headerBytes) {
      throw new Error("PCT2 attribute directory truncated.");
    }

    const nameLen = view.getUint8(cursor);
    cursor += 1;

    if (cursor + nameLen > headerBytes) {
      throw new Error("PCT2 attribute name exceeds header.");
    }

    const name = decodeName(buffer, cursor, nameLen);
    cursor += nameLen;

    const requiredBytes = 1 + 1 + 1 + 1 + 4 + 4 + 4;
    if (cursor + requiredBytes > headerBytes) {
      throw new Error("PCT2 attribute entry truncated.");
    }

    const type = view.getUint8(cursor);
    cursor += 1;
    const components = view.getUint8(cursor);
    cursor += 1;
    const codec = view.getUint8(cursor);
    cursor += 1;
    const normalized = view.getUint8(cursor);
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

    if (codec !== CodecEnum.None) {
      throw new Error(`PCT2 codec ${codec} not supported.`);
    }

    if (
      uncompressedByteLength !== 0 &&
      uncompressedByteLength !== byteLength
    ) {
      throw new Error("PCT2 uncompressed byte length mismatch.");
    }

    const ArrayType = TYPE_INFO[type];
    if (!ArrayType) {
      throw new Error(`PCT2 unsupported attribute type ${type}.`);
    }

    const elementCount = pointCount * components;
    const expectedByteLength = elementCount * ArrayType.BYTES_PER_ELEMENT;
    if (byteLength < expectedByteLength) {
      throw new Error("PCT2 attribute payload truncated.");
    }

    if (name === "position") {
      if (type !== AttributeTypeEnum.Int32 || components !== 3) {
        throw new Error("PCT2 position attribute must be int32x3.");
      }
      attributes[name] = decodePositions(
        buffer,
        payloadOffset,
        pointCount,
        scale
      );
      continue;
    }

    const dataArray = new ArrayType(buffer, payloadOffset, elementCount);
    attributes[name] = dataArray;
  }

  return {
    nodeId,
    pointCount,
    origin,
    scale,
    attributes,
  };
};

export const loadPct2Tile = async (
  url: string,
  signal?: AbortSignal
): Promise<ParsedTile2> => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`PCT2 tile load failed (${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  return parsePct2Tile(buffer);
};
