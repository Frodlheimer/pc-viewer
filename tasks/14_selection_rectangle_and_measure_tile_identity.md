# Task 14 — Selection Rectangle + Measure (tile-aware identity)

> **How to use:** Copy the entire block under **PROMPT** into Codex (VS Code).
> Run in the `viewer/` project.

## PROMPT

Task 14: Implement Selection (rectangle) + Measure (2-point distance) using tile-aware identity (nodeId + indexWithinTile).

Goal:
- Validate stable identity across streaming tiles.
- Provide core tools needed before delete/edit.

Requirements:
1) Store changes:
   - Extend store with:
     - selection: { items: Array<{ nodeId: string, index: number, worldPos: [number,number,number] }> }
     - measurement: { a?: {...}, b?: {...}, distance?: number }
   - Add editMode handling: "select" and "measure".

2) Rectangle selection UI:
   - Implement a simple drag rectangle overlay (HTML div overlay is ok).
   - On mouse down/up, compute rectangle in screen coords.
   - Use deck.gl picking:
     - pickObjects({x, y, width, height, layerIds}) on point layers
   - Collect hits and deduplicate by (nodeId,index).
   - Store worldPos from pick info (or reconstruct from tile + index).

3) Measure tool:
   - Click first point sets A, second click sets B.
   - Compute distance in world units (use world coords, not local tile coords unless you convert).
   - Render a line using LineLayer between A and B.
   - Display distance in Sidebar.

4) Stability:
   - Must work while tiles stream in/out.
   - No regressions to orbit/zoom/streaming.

Acceptance:
- `npm run lint` passes
- `npm run build` passes
- `npm run dev` works
- Box selection works across multiple tiles
- Measure shows line and distance

After:
- List changed files and how to verify selection/measure.
