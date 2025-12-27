Task 12f (Hotfix): Fix intermittent blackouts by (1) canonical tile keys, (2) correct fallback logic, (3) never deleting retained nodes in render build, and (4) reliable interaction timing.

Goal:
- Rendered tiles must never drop to 0 during camera interaction.
- If cache lookup fails transiently, keep lastNonEmptyTiles.
- Make tile cache lookup consistent via a single canonical key.
- lastInteractionMs must show a number during interaction.

A) Canonical tile key (MUST be consistent everywhere)
1) Define a single helper in one place (e.g. Viewer.tsx or a shared util):
   keyFromNodeId(nodeId) => string (bigint->toString, else String)
2) Ensure TileService/TileCache stores and retrieves tiles by this canonical key:
   - When a tile is loaded/decoded, store it under keyFromNodeId(tile.nodeId).
   - Ensure TileRenderData always has nodeId set (propagate nodeId when decoding).
   - If current cache is keyed by tile.id, change it (or add an alias map), but getCachedTile(nodeKey) must succeed.
3) Update all pin/unpin/cancel calls to use the canonical key consistently.

B) Fix updateRenderDataFromCache to never produce empty frames
4) In updateRenderDataFromCache:
   - Build `tiles[]` by iterating retained keys:
     - try cache tile via getCachedTile(key)
     - else try fallbackTiles.get(key)
     - else skip
   - IMPORTANT: remove any code that deletes retained nodes or unpins inside this function.
     (No retainedNodesRef.delete(...) here, ever.)
   - If tiles.length === 0:
     - do NOT dispatch renderData null
     - do NOT clear lastNonEmptyTilesRef
     - increment zeroTileWarningsRef if retainedNodesRef.size > 0
     - return early

C) Ensure fallback can actually run
5) Remove the early `return` that prevents fallback from executing.
   Use a simple pattern:
     const tile = cache.get(key) ?? fallback.get(key);
     if (tile) tiles.push(tile);

D) Interaction timing must always be set
6) Ensure DeckGL has onInteractionStateChange wired:
   onInteractionStateChange={handleInteractionStateChange}
7) In handleInteractionStateChange:
   - compute `active = isDragging || isPanning || isRotating || isZooming`
   - if active: set lastInteractionAtRef.current = performance.now() on EVERY call while active
   - set isInteracting true immediately when active
   - set a timeout INTERACTION_IDLE_MS to flip isInteracting false after last active event

E) Status stuck on "loading"
8) When scheduler stats show queued==0 and inFlight==0, set status to "ready"
   (even if desiredNodes > 0). Status should reflect loading activity, not selection size.

Acceptance:
- npm run lint/build/dev pass
- While rotating/panning/zooming aggressively: Rendered Tiles never drops to 0
- ZeroTileWarnings stops increasing during interaction
- lastInteractionMs shows a number (not n/a) during interaction
- Status becomes ready when inFlight and queued reach 0

Deliverable:
- List changed files and briefly explain the key unification.

HOTFIX f — Fix pointcloud blackout during camera movement (stop dataset reload on interaction)

Context:
- In Viewer.tsx, the big dataset-load useEffect currently depends on values that change during interaction (e.g. effectiveTargetVisiblePoints / isInteracting).
- That causes cache+renderData to reset during orbit/pan/zoom, producing a short frame with 0 rendered tiles and resetting lastInteraction to null (“n/a”).

Task:
1) Open: viewer/src/viewer/Viewer.tsx (or src/viewer/Viewer.tsx depending on project).
2) Find the big useEffect that starts with:
   useEffect(() => {
     let cancelled = false;
     const dataset = getDatasetById(activeDatasetId);
     datasetLoadIdRef.current += 1;
     ...
     tileServiceRef.current.clear();
     schedulerRef.current?.clear();
     ...
     dispatch({ type: "set-render-data", renderData: null });
     ...
     loadManifest(...)

3) Change ONLY the dependency array of that useEffect:
   - It MUST NOT depend on interaction/budget derived values like effectiveTargetVisiblePoints.
   - Set it to:
     }, [activeDatasetId, dispatch]);

4) Because that effect currently writes targetVisiblePoints using effectiveTargetVisiblePoints, replace those uses inside this effect with a local constant computed at runtime:
   - At the top of the effect (after budgetsRef is available), add:
     const initialTargetVisiblePoints = budgetsRef.current.targetVisiblePoints;

   - Then replace within THIS effect only:
     targetVisiblePoints: effectiveTargetVisiblePoints
     -> targetVisiblePoints: initialTargetVisiblePoints

   This keeps initial stats reasonable, and the separate effect that watches isInteracting will keep stats updated afterwards.

5) Ensure no other logic changes: do NOT change selection logic, retain logic, scheduler logic. Only stop dataset reload on interaction.

6) Run:
   npm run lint
   npm run build

Acceptance:
- While rotating/panning/zooming, the point cloud no longer disappears (“blackout”).
- renderedTiles never drops to 0 during interaction (except if dataset truly has 0 tiles).
- lastInteractionMs no longer stays “n/a” once the user interacts.
- No TypeScript or eslint errors.
- Status no longer gets stuck due to interaction-triggered reloads.

