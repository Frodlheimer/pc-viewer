# PCT2 Tile Format (v1) – int32 positions + origin/scale

**Purpose:** Ultra-efficient GPU-friendly point-cloud tiles for streaming + LOD.

## Endianness
All integer and float fields are **little-endian**.

## File structure
A PCT2 tile is:

1) Fixed header  
2) Attribute directory (variable size)  
3) Attribute payload blocks (columnar, optional compression)

### 1) Fixed header (bytes)
| Field | Type | Bytes | Notes |
|---|---:|---:|---|
| magic | char[4] | 4 | ASCII "PCT2" |
| version | uint16 | 2 | must be 1 |
| headerBytes | uint16 | 2 | total header size INCLUDING attribute directory; payload starts at this offset |
| nodeId | uint64 | 8 | 0 if unknown |
| pointCount | uint32 | 4 | number of points |
| flags | uint32 | 4 | reserved for future |
| originX,Y,Z | float64[3] | 24 | world origin of this tile |
| scaleX,Y,Z | float64[3] | 24 | scale for int32 positions (world units per integer step) |
| attrCount | uint16 | 2 | number of attributes in directory |
| reserved | uint16 | 2 | must be 0 |

Payload starts at byte offset = `headerBytes`.

### 2) Attribute directory entry (repeated attrCount times)
Each entry is variable-sized (name length). Layout:

| Field | Type | Bytes | Notes |
|---|---:|---:|---|
| nameLen | uint8 | 1 | 0..255 |
| name | uint8[nameLen] | nameLen | UTF-8 bytes, no null terminator |
| type | uint8 | 1 | see Type enum |
| components | uint8 | 1 | 1..4 typical |
| codec | uint8 | 1 | see Codec enum |
| normalized | uint8 | 1 | 0/1 (for colors etc.) |
| byteOffset | uint32 | 4 | offset **from payload start** |
| byteLength | uint32 | 4 | stored (compressed) bytes |
| uncompressedByteLength | uint32 | 4 | bytes after decompression (0 if codec=none) |

### 3) Attribute payload blocks
- Blocks are stored at `payloadStart + byteOffset`.
- Blocks SHOULD be aligned to 8 bytes (optional but recommended).
- The array length is `pointCount * components` elements.

## Type enum (uint8)
| Value | Meaning |
|---:|---|
| 1 | int8 |
| 2 | uint8 |
| 3 | int16 |
| 4 | uint16 |
| 5 | int32 |
| 6 | uint32 |
| 7 | float32 |
| 8 | float64 |

## Codec enum (uint8)
| Value | Meaning |
|---:|---|
| 0 | none |
| 1 | lz4 (future) |
| 2 | zstd (future) |

## Required attribute semantics
PCT2 is schema-flexible; however the dataset manifest must declare at least one attribute role `position`.

### Recommended standard names
- `position` : **int32 x3** (components=3, type=int32)  
  Decode to local float32: `local = int32 * scale`  
  World coordinate: `world = origin + local`
- `rgb` : uint8 x3 (components=3, type=uint8, normalized=1)
- `intensity` : uint16 x1
- `classification` : uint8 x1
- `gps_time` : float64 x1
- Custom: `segment_id` : uint32 x1, etc.

## Validation rules
- Reject if magic != "PCT2"
- Reject unsupported version
- headerBytes must be >= fixedHeaderSize and <= fileLength
- Each attribute block must fit within file length.
- If codec=none: uncompressedByteLength may be 0 or == byteLength.
