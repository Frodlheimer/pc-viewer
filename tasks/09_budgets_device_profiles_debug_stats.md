# Task 09 — Budgets + Device Profiles + Debug Stats (stability baseline)

> **How to use:** Copy the entire block under **PROMPT** into Codex (VS Code).
> Run in the `viewer/` project. Keep existing behavior working.

## PROMPT

Task 09: Introduce budgets + device profiles + runtime debug stats panel.

Goal:
- Make performance/stability predictable across devices by using explicit budgets.
- Provide a debug panel showing live metrics to validate streaming/LOD/cache behavior.

Requirements:
1) Create `src/config/budgets.ts` exporting:
   - TILE_POINT_CAP = 150_000
   - MAX_VISIBLE_POINTS_DEFAULT = 10_000_000
   - TARGET_VISIBLE_POINTS_DEFAULT = 6_000_000
   - CPU_TILE_CACHE_BUDGET_BYTES_DEFAULT = 2.5 * 1024^3
   - GPU_TILE_CACHE_BUDGET_BYTES_DEFAULT = 1.0 * 1024^3
   - MAX_CONCURRENT_TILE_REQUESTS = 6
   - VIEWSTATE_DEBOUNCE_MS = 150
   - LOD_HYSTERESIS_FACTOR = 1.25
   Add comments explaining each.

2) Add "Device Profiles" to adapt safely:
   - Define profiles: "low", "balanced", "high", "auto"
   - In "auto": derive budgets conservatively from `navigator.deviceMemory` if available:
     - low if <= 4GB, balanced if 8GB, high if >=16GB
     - Always clamp to sane max/min (do not exceed the defaults by more than ~2x).
   - Export a function `getRuntimeBudgets(profile)` returning a normalized object:
     {
       tilePointCap,
       maxVisiblePoints,
       targetVisiblePoints,
       cpuCacheBudgetBytes,
       gpuCacheBudgetBytes,
       maxConcurrentRequests,
       viewDebounceMs,
       lodHysteresisFactor
     }

3) Extend store/state minimally:
   - Add `settings.performanceProfile: "auto"|"low"|"balanced"|"high"`
   - Default "auto"
   - Add `settings.debugEnabled: boolean` default false

4) Add a debug stats UI section (Sidebar is fine):
   - Toggle "Debug" on/off (bind to settings.debugEnabled).
   - Show live metrics:
     - selectedNodes count
     - visiblePoints (sum pointCount selected)
     - loadedTiles count
     - cpuCacheBytes (from TileCache stats; if not yet available, show 0 and wire later)
     - inFlightRequests count
     - queuedRequests count (wire later if needed)
     - lastSelectionUpdateMs (if available)
   Keep UI simple. No heavy styling.

5) Wiring:
   - Add a small `RuntimeStats` object in store or a module that Viewer updates.
   - Avoid re-rendering the whole app on every animation frame; update stats only when selection changes or loads complete.

Acceptance:
- `npm run lint` passes
- `npm run build` passes
- `npm run dev` works; debug panel appears and updates while orbit/zoom
- No behavior regressions

After:
- List files changed and where budgets are used.
