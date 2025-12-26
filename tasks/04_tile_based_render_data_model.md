# Task 04 — Tile-based RenderData model

Copy/paste the whole block below into Codex (VS Code) as a single instruction.

---

Task: Refactor rendering to be tile-based (no global merge).

Goal:
- Replace the current "merge all tiles into one big array" approach.
- Render each tile as its own deck.gl layer.

Steps:
1) Update Tile.ts types:
   - Add TileRenderData:
     - id: string
     - nodeId?: bigint|number
     - pointCount: number
     - positions: Float32Array
     - colors?: Uint8Array
     - origin?: [number,number,number]
     - bounds: { min: [number,number,number], max: [number,number,number] }
   - RenderData becomes:
     - tiles: TileRenderData[]
     - pointCountTotal: number
     - bounds
     - center

2) Update TileManager.ts:
   - Keep signature loadRenderData(manifest) but return tiles[] (one per tile).
   - Use PCT1 loader for existing demo tiles; add a code path to use PCT2 loader if tile metadata indicates PCT2.

3) Update PointCloudLayerFactory.ts:
   - createPointCloudLayer(tile: TileRenderData, callbacks) -> returns one layer per tile.

4) Update Viewer.tsx:
   - layers = renderData.tiles.map(tile => createPointCloudLayer(...))
   - Picking: store selection as:
     - tileId
     - nodeId (optional)
     - indexWithinTile
     - worldPosition
     - color (optional)

Ensure existing demo still works.

Acceptance:
- npm run lint passes
- npm run build passes
- Demo dataset renders and hover/click picking still works
- No breaking type errors (TypeScript)
