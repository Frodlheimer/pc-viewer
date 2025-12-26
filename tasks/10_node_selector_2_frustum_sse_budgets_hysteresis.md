# Task 10 — NodeSelector 2.0 (Frustum + Screen-space LOD + Budgets + Hysteresis)

> **How to use:** Copy the entire block under **PROMPT** into Codex (VS Code).
> Run in the `viewer/` project.

## PROMPT

Task 10: Implement NodeSelector 2.0 (frustum culling + screen-space LOD + budgets + hysteresis), stable across devices.

Goal:
- Replace zoom->level logic with robust selection that loads only what matters on screen.
- Avoid tile thrash while moving camera.

Requirements:
1) Update `src/io/NodeSelector.ts` (or your current NodeSelector file):
   - Keep selector mostly pure (no direct fetching inside; it should compute a desired set).
   - Input should include:
     - a deck.gl `Viewport` object (preferred), or viewProjection matrix + camera position
     - viewport width/height
     - hierarchy access to NodeRecords (bounds, level, pointCount, childMask, child ids)
     - runtimeBudgets (from Task 09)
     - previous selection (optional) to apply hysteresis/stability
   - Output should include:
     - selected NodeRecords (desired)
     - diagnostics: visiblePoints, selectedCount, selectedLevels histogram, reason counters

2) Frustum culling:
   - Compute frustum planes from viewProjection matrix (or use math.gl helpers already present).
   - Cull Node AABB fully outside frustum.
   - Defensive coding: handle missing bounds; avoid NaNs.

3) Screen-space LOD heuristic (SSE-like):
   - For each node:
     - center = (min+max)/2
     - radius = length(max-min)/2 (bounding sphere approx)
     - distance from camera to center
     - focalLengthPixels: derive from viewport (or approximate from height + fovy)
     - pixelRadius ≈ (radius / distance) * focalLengthPixels
   - Base thresholds:
     - baseRefinePx = 40
     - baseCoarsenPx = 30
   - Apply hysteresis factor from budgets:
     - refineThreshold = baseRefinePx * lodHysteresisFactor
     - coarsenThreshold = baseCoarsenPx / lodHysteresisFactor
   - Refine to children only if pixelRadius > refineThreshold and children exist.
   - Prefer coarse nodes if pixelRadius < coarsenThreshold.

4) Budget-limited selection:
   - Hard stop when visiblePoints >= targetVisiblePoints OR selected nodes exceed maxNodesDerived.
   - Derive maxNodesDerived safely from budgets:
     - Suggested: clamp( maxVisiblePoints / (tilePointCap * 0.5), 100, deviceDependentMax )
     - deviceDependentMax: low=400, balanced=1000, high=2000
   - When refining, prioritize nodes with highest pixelRadius (largest footprint) first.

5) Stability:
   - Avoid oscillation while moving camera:
     - Provide an option to "keep previous coarse nodes until fine nodes are loaded" (handled by scheduler later).
     - Selector should not flip wildly; prefer minimal changes between frames using hysteresis & previous selection info.

6) Integration notes:
   - Viewer should call selector only after debounce (Task 12 will formalize scheduler), but keep selector correct regardless.

Acceptance:
- `npm run lint` passes
- `npm run build` passes
- `npm run dev` works; demo still renders
- Orbit/zoom does not cause full reload loops
- Debug stats show stable selection counts (changes are gradual)

After:
- List changed files and explain frustum + SSE math in a short paragraph.
