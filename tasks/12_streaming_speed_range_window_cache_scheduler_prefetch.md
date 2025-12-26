# Task 12 — Streaming Speed: Range Window Cache + Priority Scheduler + Prefetch + Debounced Selection

> **How to use:** Copy the entire block under **PROMPT** into Codex (VS Code).
> Run in the `viewer/` project.

## PROMPT

Task 12: Improve streaming speed via Range Window Cache + prioritized load queue + smart prefetch + debounced selection updates.

Goal:
- Reduce HTTP overhead by caching larger range windows (8–32MB).
- Load what matters first (coarse first, largest footprint first).
- Avoid thrash while user moves camera; keep UI smooth.

Part A — Range Window Cache (big win):
1) Update `src/io/RangeFetch.ts` (or wherever Range fetching lives):
   - Implement a RangeWindowCache per URL:
     - WINDOW_BYTES default = 16 * 1024 * 1024 (16MB)
     - Align windows:
       windowStart = floor(start / WINDOW_BYTES) * WINDOW_BYTES
       windowEnd = windowStart + WINDOW_BYTES - 1
     - Store ArrayBuffer for each window.
   - When a (start,length) is requested:
     - if window exists -> return slice from window buffer
     - else fetch that window using Range header (bytes=windowStart-windowEnd)
   - Fallback:
     - If server returns HTTP 200 (no range support), treat the full file as a single cached window and serve slices.
   - Bound the cache:
     - max windows per URL = 8
     - total window cache budget across all URLs = 256MB
     - LRU eviction across windows

2) Expose RangeWindowCache stats:
   - { totalBytes, totalWindows, hits, misses, evictions }
   - Wire into debug panel.

Part B — Load Scheduler (priority queue):
3) Create `src/io/LoadScheduler.ts`:
   - Accepts "desired set" from NodeSelector (list of node records with footprint score).
   - Maintains:
     - queue: priority queue keyed by nodeId
     - inFlight count (do not exceed MAX_CONCURRENT_TILE_REQUESTS)
   - Priority score:
     - higher pixel footprint first
     - coarse level first (prefer lower level number)
     - closer distance first (tie breaker)
   - Methods:
     - setDesiredNodes(desiredNodesWithScores): updates queue without clearing already-loaded tiles
     - tick(): schedules up to concurrency limit by calling TileService.getTile(...)
     - cancelNotDesired(): abort in-flight loads that are no longer desired (best-effort)

4) Prefetch:
   - When camera is idle (no view changes for ~300ms) AND queue is low:
     - prefetch small number of neighbors (max 20)
     - neighbors can be approximated as siblings or nearby nodes in same level (use hierarchy parent/child relationships)
   - Prefetch must be low priority and must not steal bandwidth from visible needs.

Part C — Debounced view updates + integration:
5) In Viewer (or data controller):
   - Apply debounce (VIEWSTATE_DEBOUNCE_MS = 150ms) to selection computation.
   - Pipeline:
     - on viewState change -> schedule a debounced recompute of desired nodes
     - compute desired nodes via NodeSelector 2.0
     - pass desired nodes to scheduler.setDesiredNodes()
     - scheduler loads missing tiles incrementally (no full clears)
   - Maintain "pinned set":
     - pin keys for desired nodes, unpin others.
     - allow eviction to remove unpinned tiles.

Acceptance:
- `npm run lint` passes
- `npm run build` passes
- `npm run dev` works
- In Network tab: far fewer range requests; repeated zoom does not re-fetch same windows
- Navigation feels stable; no full clears
- Debug shows queue/inFlight and RangeWindowCache hit rate increasing

After:
- List changed files and describe how to tune window size and budgets.
