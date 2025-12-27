Task 14: Implement Selection (rectangle) + Measure (2-point distance) using tile-aware identity (nodeId + indexWithinTile).

IMPORTANT CONSTRAINTS (do not violate):
- Do not change the dataset-load useEffect deps. It must remain [activeDatasetId, dispatch] only.
- Do not set renderData to null except on dataset change.
- Layer IDs must remain stable: `${activeDatasetId}:${keyFromTile(tile)}` only.
- Use canonical keys everywhere: keyFromNodeId / keyFromTile.
- Do not break OrbitController navigation. Selection/measure must NOT compete with orbit/zoom/pan.

Goal:
- Validate stable identity across streaming tiles.
- Provide core tools needed before delete/edit.

Requirements:
1) Store changes:
   - Extend store with:
     - selection: { items: Array<{ nodeId: string, index: number, worldPos: [number,number,number], tileKey?: string }> }
     - measurement: { a?: {...}, b?: {...}, distance?: number }
   - Add editMode handling: "select" and "measure".
   - Keep selection identity based on (nodeId,index) where nodeId is stringified nodeId (or nodeKey).

2) Input gating (avoid conflicts with OrbitController):
   - Selection/measure actions only trigger when:
     - editMode matches AND user holds a modifier key (use Shift for MVP).
   - Without Shift, mouse drag/scroll should behave as normal camera navigation.
   - This is mandatory for usability.

3) Rectangle selection UI:
   - Implement a simple drag rectangle overlay (HTML div overlay).
   - Only start rectangle if editMode==="select" AND Shift is pressed on mousedown.
   - On mouse up:
     - compute rectangle bounds in screen coords.
     - call deck.gl picking:
       - deckRef.current.pickObjects({x, y, width, height, layerIds}) on point layers
     - Collect hits, deduplicate by (nodeId,index).
     - Store worldPos:
       - Use info.coordinate if available, else reconstruct via tile + index (existing getWorldPosition).
   - Add a "Clear selection" button in Sidebar (or reuse existing UI patterns).

4) Measure tool:
   - Only active when editMode==="measure" AND Shift is pressed during click.
   - First Shift-click sets point A.
   - Second Shift-click sets point B and computes distance:
     - Euclidean distance in world coords.
   - Render a line between A and B:
     - Use a deck.gl LineLayer (or an existing layer factory if you have one).
   - Display distance in Sidebar (meters or world units; label as "world units").

5) Stability with streaming:
   - Selection and measurement must remain valid even if tiles stream in/out:
     - store worldPos (so UI doesn’t depend on tile staying loaded)
     - keep identity (nodeId+index) for later delete/edit.

Acceptance:
- npm run lint passes
- npm run build passes
- npm run dev works
- Box selection works across multiple tiles
- Measure shows line and distance
- Camera navigation still works normally when Shift is NOT held
- No regressions to streaming/retained rendering (no blackouts)

After:
- List changed files and how to verify selection/measure.
