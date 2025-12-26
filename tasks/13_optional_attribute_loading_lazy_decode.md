# Task 13 — Optional Attribute Loading (Lazy Decode) + Profile-aware Raw Buffer Retention

> **How to use:** Copy the entire block under **PROMPT** into Codex (VS Code).
> Run in the `viewer/` project.

## PROMPT

Task 13: Implement optional attribute loading via lazy decode (memory stability) while preserving current PCT2 compatibility.

Goal:
- Always decode only mandatory attributes for rendering (position + color if present).
- Keep other attributes (classification, intensity, gps_time, custom) lazy: decode only when requested by a feature.
- Keep app stable on low-end devices by dropping raw buffers when needed.

Requirements:
1) Refactor PCT2 parsing:
   - Ensure there are clear functions:
     - parsePct2HeaderAndDirectory(buffer) -> {header, directory}
     - decodePct2Attributes(buffer, directory, attrNames[]) -> Record<string, TypedArray>
   - Keep strict validation; do not weaken error checks.

2) Tile cache entries:
   - Extend cached tile object to carry metadata needed for lazy decode:
     - directory info (offsets, codecs)
     - origin/scale
     - pointCount
   - Raw buffer retention policy (profile-aware):
     - low profile: drop rawBuffer immediately after decoding mandatory attrs.
     - balanced/high: keep rawBuffer until cache eviction OR until memory pressure triggers drop.
   - If rawBuffer not available and optional attrs are requested:
     - re-fetch tile (through existing TileService + Range window cache), then decode requested attrs.

3) Provide API:
   - `ensureTileAttributes(nodeId, attrNames[])`:
     - returns decoded arrays for those attrs
     - caches decoded optional attrs within the tile entry (so repeated requests are cheap)

4) Rendering remains unchanged:
   - PointCloud rendering uses position + color only
   - Visual output should remain identical to current demo.

5) Debug:
   - Expose whether rawBuffer is retained for a tile and how many optional attrs decoded.

Acceptance:
- `npm run lint` passes
- `npm run build` passes
- `npm run dev` renders demo unchanged
- low profile uses less memory (raw buffers dropped)
- optional attr request path does not crash (even if it triggers refetch)

After:
- List changed files and explain rawBuffer retention per profile.
