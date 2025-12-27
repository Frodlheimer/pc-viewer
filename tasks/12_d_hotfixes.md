Task 12e (Hotfix): Eliminate brief blackouts by preventing empty render frames and avoiding aggressive retained cleanup.

Goal:
- During orbit/zoom/pan, the point cloud must NEVER disappear.
- Even if the cache has a transient gap, keep rendering the last non-empty tiles until new tiles are ready.
- Do not drop retained nodes just because their tile isn't currently cached.

Requirements:

A) Keep last non-empty render tiles
1) In Viewer.tsx (or wherever renderData is built), add:
   - `lastNonEmptyTilesRef: React.useRef<TileRenderData[]>([])`
   - Optionally also store last pointCount if needed.

2) Update `updateRenderDataFromCache()`:
   - Build `tiles[]` from cached tiles in retained set (as you do now).
   - If `tiles.length > 0`:
     - set `lastNonEmptyTilesRef.current = tiles`
     - dispatch/set renderData to these tiles
   - If `tiles.length === 0`:
     - DO NOT clear renderData.
     - Instead:
       - if lastNonEmptyTilesRef.current has tiles, re-dispatch/use them (or simply return without dispatch so current render remains)
       - only allow clearing when dataset is actually being changed/unloaded (datasetLoadId changes or activeDatasetId changes).
   - Remove/avoid any code path that sets "lastRenderKeyRef = null" because of an empty tiles list during interaction.

B) Do NOT remove retained nodes because tile is missing (avoid transient gaps)
3) Remove the logic that deletes retained nodes when tileService.getCachedTile(key) returns undefined.
   - A retained node is a logical placeholder; it can remain retained even if its tile is not yet loaded.
   - Instead, just skip rendering that node until its tile arrives.
   - Pruning retained nodes is only allowed in the idle-prune function (minIdleStableMs), not in updateRenderDataFromCache.

4) If you need cleanup for truly impossible states:
   - Only remove retained nodes when:
     - not interacting AND idle stable time passed AND node is not desired AND safe prune rules allow it.
   - Never remove during updateRenderDataFromCache.

C) Layer identity must be stable across interaction
5) Verify PointCloudLayer creation:
   - layer `id` and React `key` must be `${datasetId}:${nodeId}` (or tileId) ONLY.
   - MUST NOT include `isInteracting`, target points, timestamps, or changing counters.
   - Changing pickable/pointSize is fine as props, but id/key must stay stable.

D) Diagnostics
6) Add debug fields:
   - renderedTiles count (from current renderData.tiles length)
   - lastNonEmptyTiles count
   - a warning counter if tiles computed == 0 while retainedNodes > 0

Acceptance:
- npm run lint/build/dev pass
- While interacting aggressively (pan/rotate/zoom), point cloud never blanks out
- Debug shows renderedTiles never drops to 0 during interaction (unless dataset truly unloaded)
- No regressions to loading/caching
