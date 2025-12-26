export const AttributeTypeEnum = {
  Int8: 1,
  Uint8: 2,
  Int16: 3,
  Uint16: 4,
  Int32: 5,
  Uint32: 6,
  Float32: 7,
  Float64: 8,
} as const;

export type AttributeTypeEnum =
  (typeof AttributeTypeEnum)[keyof typeof AttributeTypeEnum];

export const CodecEnum = {
  None: 0,
  Lz4: 1,
  Zstd: 2,
} as const;

export type CodecEnum = (typeof CodecEnum)[keyof typeof CodecEnum];

export type TypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

export type ParsedTile2 = {
  nodeId: bigint | number;
  pointCount: number;
  origin: [number, number, number];
  scale: [number, number, number];
  attributes: Record<string, TypedArray>;
};
