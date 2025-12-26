# Task 16 — Synthetic Stress Dataset + Metrics Snapshot (stability across devices)

> **How to use:** Copy the entire block under **PROMPT** into Codex (VS Code).
> Run in the `viewer/` project.

## PROMPT

Task 16: Add a stability/speed harness: synthetic dataset generator + metrics snapshot.

Goal:
- Deterministic testing for laptops vs high-end PCs without relying on huge real datasets.
- Ability to compare streaming/LOD/cache metrics.

Requirements:
1) Add a Node script: `tools/generate_synth_dataset.mjs`
   - Generates a dataset under `viewer/public/datasets/synth_<timestamp>/`
   - Produces:
     - dataset.json (manifest v0.2)
     - hierarchy.pch (simple PCH1; 1–2 levels is enough for MVP)
     - tiles.pctc (container with tiles packed sequentially)
   - Points:
     - random points within a cube; optional RGB
   - Parameters (CLI args):
     - --points (default 5_000_000)
     - --tileCap (default TILE_POINT_CAP)
     - --lod (default 2)
   - Keep generator fast; avoid heavy dependencies.

2) Provide a simple way to open it in the app:
   - If app has dataset selection UI, add the synth dataset to list automatically (by scanning datasets folder is NOT required).
   - Otherwise document the URL/path clearly in README or a new `docs/architecture/testing.md`.

3) Metrics Snapshot button:
   - In the debug panel (Task 09), add a button "Snapshot Metrics"
   - On click: print a single structured object to console with:
     - budgets/profile
     - selectedNodes, visiblePoints, loadedTiles
     - tileCache stats
     - rangeWindowCache stats
     - scheduler stats (queued, inFlight)
     - average tile load time if available (optional)
   - Keep it stable and easy to copy/paste.

Acceptance:
- `npm run lint` passes
- `npm run build` passes
- `npm run dev` works
- Running the generator creates a dataset that can be opened and rendered
- Snapshot prints metrics

After:
- List changed files; document how to run generator and open dataset.
