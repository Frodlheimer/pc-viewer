Task 13: Implement optional attribute loading via lazy decode (memory stability) while preserving current PCT2 compatibility.

IMPORTANT CONSTRAINTS (do not violate):
- The dataset-load useEffect must depend ONLY on [activeDatasetId, dispatch]. Do NOT re-add deps like isInteracting/effectiveTargetVisiblePoints.
- Do not set renderData to null/empty except when activeDatasetId changes.
- Use canonical keys everywhere:
  - nodeKey = keyFromNodeId(nodeId)
  - tileKey = keyFromTile(tile)
  - TileService get/has/pin/unpin/cancel must use these keys consistently.
- DeckGL layer ids/keys must remain stable (no adding changing counters/timestamps).

Goal:
- Always decode only mandatory attributes for rendering (position + color if present).
- Keep other attributes (classification, intensity, gps_time, custom) lazy: decode only when requested by a feature.
- Keep app stable on low-end devices by dropping raw buffers when needed.
- Preserve current visual output (no change to rendering).

Requirements:
1) Refactor PCT2 parsing:
   - Ensure there are clear functions:
     - parsePct2HeaderAndDirectory(buffer) -> {header, directory}
     - decodePct2Attributes(buffer, directory, attrNames[]) -> Record<string, TypedArray>
   - Keep strict validation; do not weaken error checks.

2) Tile cache entries (TileService / TileManager integration):
   - Extend cached tile entry to carry metadata required for lazy decode:
     - directory info (offsets/codecs/attr schemas)
     - origin/scale (if used)
     - pointCount
     - OPTIONAL: rawBuffer?: ArrayBuffer (may be dropped)
     - decodedOptional?: Map<string, TypedArray>
   - Raw buffer retention policy (profile-aware + pinned-safe):
     - low profile: drop rawBuffer immediately after decoding mandatory attrs.
     - balanced/high: rawBuffer may be kept until eviction OR memory pressure triggers drop.
     - However: if a tile is pinned (retained/desired), prefer NOT retaining rawBuffer indefinitely.
       - Rule: pinned tiles should drop rawBuffer unless optional attrs were requested recently (simple heuristic ok).
   - If rawBuffer is not available and optional attrs are requested:
     - refetch tile using existing TileService fetch path (so Range cache + Abort + dedup are preserved),
       then decode requested attrs.

3) Provide API:
   - Implement on TileService (or a dedicated helper module):
     - ensureTileAttributes(nodeIdOrKey, attrNames[]) -> Promise<Record<string, TypedArray>>
   - Behavior:
     - Accept nodeId or canonical nodeKey; internally convert to nodeKey.
     - If attrs already decoded and cached in tile entry => return immediately.
     - Else if rawBuffer present => decode from it.
     - Else => re-fetch tile bytes (using existing URL/range info from manifest/tile directory) and decode.
   - Cache decoded optional attrs in the tile entry so repeated requests are cheap.

4) Rendering remains unchanged:
   - PointCloud rendering uses position + color only.
   - Visual output should remain identical to current demo.

5) Debug / stats:
   - Expose per tile (DEV logging is ok; Sidebar summary preferred):
     - rawBufferRetainedCount (how many cached tiles still hold rawBuffer)
     - optionalAttrsDecodedCount (sum of decoded optional arrays across tiles)
   - Keep it lightweight; do not spam logs in production.

Acceptance:
- npm run lint passes
- npm run build passes
- npm run dev renders demo unchanged
- low profile shows lower memory footprint (raw buffers dropped quickly)
- Optional attr request works even after rawBuffer dropped (refetch+decode path), no crashes
- No regressions to streaming/retained rendering (no blackouts)

After:
- List changed files and explain rawBuffer retention per profile and pinned tiles.
