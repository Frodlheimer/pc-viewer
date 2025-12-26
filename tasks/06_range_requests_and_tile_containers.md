# Task 06 — Range requests + tile containers

Copy/paste the whole block below into Codex (VS Code) as a single instruction.

---

Task: Add HTTP Range loading and tile containers (fewer requests).

Steps:
1) Add RangeFetch.ts:
   - fetchRange(url: string, start: number, length: number): Promise<ArrayBuffer>
   - Use header Range: bytes=start-end
   - If server responds 200 (no range support), fallback: full fetch, then slice.

2) Add TileContainerLoader.ts:
   - loadTileFromContainer(containerUrl, offset, length) -> ArrayBuffer via fetchRange
   - parse with PCT2 loader

3) Update TileManager to load from container when tile has containerUrl/byteOffset/byteLength.

MVP: you can keep demo on standalone tiles; just ensure feature compiles and is ready.

Acceptance:
- npm run lint passes
- npm run build passes
- Demo dataset renders and hover/click picking still works
- No breaking type errors (TypeScript)
