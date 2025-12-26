# Task 03 — Implement PCT2 tile loader

Copy/paste the whole block below into Codex (VS Code) as a single instruction.

---

Task: Implement PCT2 tile parsing (int32+scale) while keeping PCT1 working.

Requirements:
- Follow docs/spec/pct2.md exactly (little-endian).
- Position is int32x3; decode to local Float32Array positions for rendering:
  local = int32 * scale  (scale is float64[3], computed in JS numbers, stored into Float32Array)

Steps:
1) Introduce new types (wherever you keep types; create a folder if missing):
   - AttributeTypeEnum, CodecEnum
   - ParsedTile2: nodeId (bigint or number), pointCount, origin:[number,number,number], scale:[number,number,number],
     attributes: Record<string, TypedArray>

2) Add a new loader module:
   - Pct2TileLoader.ts with:
     - parsePct2Tile(buffer: ArrayBuffer): ParsedTile2
     - loadPct2Tile(url: string): Promise<ParsedTile2>

3) Keep existing TileLoader.ts (PCT1) unchanged.

4) Add defensive validation:
   - magic/version/headerBytes bounds
   - attribute offsets and lengths fit in buffer
   - components in 1..4

5) Add a minimal dev helper to validate PCT2 parsing (e.g., a small function called from console or a simple unit-style test file if your tooling supports it).

Acceptance:
- npm run lint passes
- npm run build passes
- Demo dataset renders and hover/click picking still works
- No breaking type errors (TypeScript)
