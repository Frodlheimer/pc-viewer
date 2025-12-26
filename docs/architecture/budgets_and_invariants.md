# Budgets & Invariants (locked)
*Updated:* 2025-12-26

## Budgets (Defaults)
- TILE_POINT_CAP: 150k
- MAX_VISIBLE_POINTS: 10M
- TARGET_VISIBLE_POINTS: 6M
- CPU_TILE_CACHE_BUDGET: 2.5GB
- GPU_TILE_CACHE_BUDGET: 1.0GB
- MAX_CONCURRENT_TILE_REQUESTS: 6
- VIEWSTATE_DEBOUNCE_MS: 150
- LOD_HYSTERESIS_FACTOR: 1.25

## Invariants (must not break)
1) Point identity is (nodeId, indexWithinTile)
2) Base tiles are immutable. Edits are patches (add/delete/update).
3) PCT2 position is int32x3 with origin/scale for high precision.
4) Manifest `roles` defines attribute semantics; attributes are extensible.
5) Everything is budget-driven: selection/caches/requests.
6) Progressive rendering: coarse first, refine later (no blackouts).

## Notes
- Budgets are tuned for broad device stability; device profiles may reduce or increase within clamps.
