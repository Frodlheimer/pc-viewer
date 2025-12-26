# TASKS 09–16 — Streaming Speed + Stability Roadmap
*Generated:* 2025-12-26

## Reihenfolge (empfohlen)
1. 09_budgets_device_profiles_debug_stats.md
2. 10_node_selector_2_frustum_sse_budgets_hysteresis.md
3. 11_tile_cache_lru_dedup_abort_eviction.md
4. 12_streaming_speed_range_window_cache_scheduler_prefetch.md
5. 13_optional_attribute_loading_lazy_decode.md
6. 14_selection_rectangle_and_measure_tile_identity.md
7. 15_delete_mvp_mask_gpu_discard_no_rebuild.md
8. 16_synthetic_stress_generator_and_metrics_snapshot.md

## Arbeitsweise (wichtig)
- Vor jedem Task: `git status` muss clean sein.
- Nach jedem Task:
  - `npm run lint`
  - `npm run build`
  - `npm run dev`
  - commit + push

## Commit message Vorschlag
- 09: feat: add budgets + device profiles + debug stats
- 10: feat: node selector 2.0 (frustum + sse + hysteresis)
- 11: feat: tile cache LRU + in-flight dedup + abort + eviction
- 12: feat: range window cache + prioritized load scheduler + prefetch
- 13: feat: lazy attribute decode based on performance profile
- 14: feat: tile-aware selection rectangle + measure tool
- 15: feat: delete mask with GPU discard (no tile rebuild)
- 16: chore: add synthetic dataset generator + metrics snapshot
