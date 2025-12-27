Hotfix f: Fix camera-interaction blackouts + missing interaction timing by (1) robust interaction tracking via onViewStateChange, (2) memoizing DeckGL view/controller objects, (3) keeping coarse nodes during interaction, and (4) enforcing “renderData never empty” restore.

Goal:
- While rotating/panning/zooming, the point cloud must NEVER disappear.
- Debug “Last Interaction” must never stay n/a during interaction; it should show ~0–300ms.
- Rendered Tiles must not drop to 0 once the dataset has rendered at least once.
- Keep performance stable across devices.

Scope:
- Primary file: `viewer/src/Viewer.tsx` (or your current Viewer component path).
- Do not change unrelated files. Keep lint/build passing.

========================================================
A) Memoize DeckGL objects (avoid re-init flicker)
========================================================
1) In Viewer component, create memoized instances (top-level inside component):
   - `const deckViews = useMemo(() => new OrbitView(), []);`
   - `const deckController = useMemo(() => ({ type: OrbitController }), []);`

2) In the DeckGL JSX, replace any `views={new OrbitView()}` with:
   - `views={deckViews}`
   And replace any inline controller object with:
   - `controller={deckController}`

IMPORTANT:
- Do not include changing values (isInteracting, budgets, etc.) in these useMemo deps.

========================================================
B) Robust interaction tracking (ground truth from onViewStateChange)
========================================================
3) Add a helper `noteInteraction()` in Viewer:
   - Must set `lastInteractionAtRef.current = performance.now()`
   - Must set interacting state TRUE immediately (via your existing setInteracting / setIsInteracting wrapper)
   - Must reset a timeout that turns interacting FALSE after `budgetsRef.current.interactionIdleMs`
   - Must avoid excessive React rerenders: only flip state when value changes.

Example shape (adapt to your naming, but keep behavior):
- If already interacting, still update `lastInteractionAtRef.current` and reset the idle timer.
- Ensure `interactionIdleTimerRef.current` is cleared before setting a new timeout.

4) In `onViewStateChange` handler:
   - Call `noteInteraction()` at the very start of the handler (every time viewState changes due to user input).
   - Then proceed with your existing viewState updates/dispatch.

5) Ensure DeckGL has `onViewStateChange={handleViewStateChange}` wired.
   - If you have `onInteractionStateChange`, keep it optional:
     - Either remove it to avoid conflicting logic, OR keep it but it must call `noteInteraction()` when active.
   - Do not rely solely on onInteractionStateChange anymore.

6) Update runtime stats so Debug shows lastInteractionMs:
   - Ensure `getLastInteractionMs()` reads from `lastInteractionAtRef.current`.
   - Ensure `updateRuntimeStats()` includes `lastInteractionMs` and `isInteracting` and gets called during interaction (at least on debounced selection updates).
   - After this hotfix, “Last Interaction” should not be n/a while moving.

========================================================
C) Keep coarse nodes during interaction (LOD never blanks)
========================================================
7) When calling your node selection function (selectNodes / NodeSelector 2.0):
   - Pass a flag `keepCoarseNodes: isInteractingRef.current` (or equivalent).
   - If NodeSelector signature does not support it yet:
     - Add an optional boolean to selector input (default false) and implement:
       - if keepCoarseNodes is true, allow keeping previously selected coarse parents until children are loaded / available.

The intent:
- During interaction, don’t aggressively swap away coarse coverage.
- After idle, refinement can replace coarse nodes.

========================================================
D) Hard invariant: renderData must never become empty after first render
========================================================
8) In updateRenderDataFromCache (or whichever function builds renderData from cached tiles):
   - Maintain `lastNonEmptyTilesRef` (already present).
   - If computed `tiles.length > 0`:
     - set lastNonEmptyTilesRef.current = tiles
     - dispatch renderData = buildRenderData(manifest, tiles)
   - If computed `tiles.length === 0`:
     - DO NOT dispatch renderData null/empty.
     - Increment zeroTileWarnings if retainedNodesRef.size > 0.
     - If `renderDataRef.current` is null AND lastNonEmptyTilesRef.current has tiles:
       - restore by dispatching buildRenderData(manifest, lastNonEmptyTilesRef.current)
     - Return early.

9) Ensure updateRenderDataFromCache does NOT delete retained nodes or unpin them.
   - Deleting retained entries must only happen in idle prune logic, never in render build.

========================================================
E) Validation / Acceptance
========================================================
Acceptance:
- `npm run lint` passes
- `npm run build` passes
- In dev:
  - During orbit/pan/zoom: point cloud never fully disappears
  - Debug:
    - Interacting toggles to “yes” during movement
    - Last Interaction shows a number (not n/a) during movement
    - Rendered Tiles does not drop to 0 during movement (after first successful render)
    - ZeroTileWarnings stops increasing during normal interaction
- Keep existing dataset loading behavior and streaming features working.

Deliverable:
- Print a short summary: which sections A–D were implemented and which exact files changed.

Hotfix f2: Fix interaction logic + ensure Last Interaction updates during movement.

1) In Viewer.tsx, simplify interaction tracking:
   - Keep noteInteraction() in onViewStateChange (this is the ground truth).
   - Remove onInteractionStateChange handler entirely OR ensure it only calls noteInteraction() when active=true and never calls noteInteraction() when active=false.

2) Fix handleInteractionStateChange if you keep it:
   - If active: call noteInteraction()
   - If not active: only schedule setInteracting(false) after interactionIdleMs (do not call noteInteraction)

3) Make Last Interaction visible:
   - Add a small throttle inside noteInteraction() to call updateRuntimeStats({ lastInteractionMs: 0, isInteracting: true }) at most every 100ms while moving.

Acceptance:
- During pan/zoom/rotate: Last Interaction shows a number, not n/a.
- Interacting toggles correctly.
- No blackouts.
- lint/build pass.
