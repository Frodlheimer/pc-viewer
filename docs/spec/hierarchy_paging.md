# Hierarchy Paging (PCH1) – Binary pages

**Purpose:** Avoid huge JSON for millions of nodes. Client loads only pages needed.

## Files
- `dataset.json` (small): references `hierarchyUrl` and tile container list
- `hierarchy.pch` (binary): paged node records

## Endianness
Little-endian.

## Page layout
Each page is a fixed byte size (recommended **64 KiB**). Pages are addressable by index.

### Page header (fixed)
| Field | Type | Bytes |
|---|---:|---:|
| magic | char[4] | 4 | "PCH1" |
| version | uint16 | 2 | 1 |
| pageBytes | uint16 | 2 | e.g. 65536 |
| pageIndex | uint32 | 4 |
| recordCount | uint32 | 4 |
| reserved | uint32 | 4 | 0 |

### NodeRecord (fixed size, repeated recordCount times)
Recommended fixed record size: 80 bytes.

| Field | Type | Bytes | Notes |
|---|---:|---:|---|
| nodeId | uint64 | 8 | morton/octree key |
| parentId | uint64 | 8 | 0 for root/unknown |
| level | uint8 | 1 | 0=root |
| childMask | uint8 | 1 | 8-bit, children present |
| reserved0 | uint16 | 2 | 0 |
| pointCount | uint32 | 4 | points in this node tile |
| bmin | int32[3] | 12 | quantized bounds min |
| bmax | int32[3] | 12 | quantized bounds max |
| containerIndex | uint16 | 2 | index into dataset.json containers |
| reserved1 | uint16 | 2 | 0 |
| byteOffset | uint64 | 8 | within container file |
| byteLength | uint32 | 4 | bytes of tile block |
| reserved2 | uint32 | 4 | 0 |
| statsOffset | uint64 | 8 | optional, 0 if none |
| statsLength | uint32 | 4 | optional, 0 if none |
| reserved3 | uint32 | 4 | 0 |

## Bounds quantization
`dataset.json` contains:
- `boundsQuantization.origin: float64[3]`
- `boundsQuantization.scale: float64[3]`

Decode:
- world = origin + int32 * scale

## Client strategy (MVP)
- Load `dataset.json`
- Load page 0
- Select nodes by LOD rule (zoom->level), no frustum culling for MVP
- Load selected tiles via container range requests
- Cache pages in an LRU
