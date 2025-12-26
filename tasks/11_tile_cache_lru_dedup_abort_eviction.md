# Task 11 — TileCache (CPU LRU) + In-flight Dedup + Abort + Eviction

> **How to use:** Copy the entire block under **PROMPT** into Codex (VS Code).
> Run in the `viewer/` project.

## PROMPT

Task 11: Add a robust CPU TileCache (LRU) + in-flight dedup + abort + eviction, respecting budgets and device profiles.

Goal:
- Prevent re-fetching the same tiles repeatedly.
- Prevent memory growth over time.
- Keep currently visible tiles pinned so navigation stays stable.

Requirements:
1) Create `src/io/TileCache.ts`:
   - LRU cache keyed by nodeId (string) (or tileId if your app uses tileId; choose one and use consistently).
   - Each entry stores:
     - tile: TileRenderData (decoded mandatory attrs)
     - bytesEstimate: number
     - pinned: boolean
     - lastUsed: number (ms) OR linked-list pointers for LRU
   - Provide API:
     - get(key): TileRenderData | undefined  (touch LRU)
     - has(key): boolean
     - set(key, tile, bytesEstimate): void
     - pin(key): void
     - unpin(key): void
     - evictToBudget(budgetBytes): string[] (evicted keys)
     - stats(): { items, bytes, pinnedItems, pinnedBytes }

2) Integrate TileCache into the tile loading pipeline:
   - Find where tiles are fetched/decoded today (TileManager / TileLoader / Container loader).
   - Add a "TileService" layer if that helps:
     - getTile(nodeRecord): Promise<TileRenderData>
   - Maintain:
     - inFlight: Map<key, { promise: Promise<TileRenderData>, abort: AbortController }>
   - Behavior:
     - If cache hit -> return immediately.
     - Else if inFlight exists -> return existing promise.
     - Else create abort controller, start fetch/decode, store inFlight.
     - On completion: remove inFlight, store in cache, return tile.

3) Abort:
   - Provide a method to cancel in-flight loads when nodes are no longer desired:
     - cancelTile(key): abort controller abort + remove from map (safe if already resolved).
   - Ensure abort errors are handled without breaking the app.

4) Pinning:
   - When Viewer determines a node is selected/visible, pin its tile key.
   - When node becomes unselected, unpin (do not necessarily evict immediately).

5) Eviction:
   - After insertion, evict LRU until cache.bytes <= cpuBudget.
   - Never evict pinned tiles.
   - If pinned tiles exceed budget, keep running and log one warning (throttled).

6) Debug stats:
   - Wire TileCache stats to the debug panel from Task 09.
   - Also expose inFlight count.

Acceptance:
- `npm run lint` passes
- `npm run build` passes
- `npm run dev` works
- Orbit/zoom does not re-fetch the same tile repeatedly
- TileCache bytes/items stabilize near budget, no unbounded growth

After:
- List changed files and describe how to verify dedup + eviction in DevTools Network.
