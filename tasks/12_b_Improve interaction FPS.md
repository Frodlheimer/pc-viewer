Task 12b (Hotfix): Improve interaction FPS by (1) preventing layer rebuild thrash and (2) applying an interaction budget while moving.

Context:
- After tasks 9–12, a 5M dataset still has low FPS while orbiting/zooming.
- Debug shows SelectedNodes=1, LoadedTiles=1, VisiblePoints=5,000,000 (single big tile).
- We must improve responsiveness on low/mid devices immediately.

Goal:
- While the user is actively interacting (dragging/zooming), render fewer points (or lower LOD selection) to keep FPS usable.
- Ensure we do NOT rebuild layers or reset renderData on every viewState update.

Requirements:

A) Add interaction detection (stable, cross-device)
1) In Viewer (where DeckGL viewState is controlled), track an `isInteracting` boolean:
   - set true on pointerdown / wheel start (DeckGL onInteractionStateChange preferred)
   - set false after an idle timeout (e.g. 250–400ms after last interaction event)
2) Store it in React state or store, BUT update it minimally (do not cause expensive rerenders).

B) Apply "interaction budgets"
3) In `src/config/budgets.ts`, add:
   - TARGET_VISIBLE_POINTS_INTERACT_DEFAULT = 2_000_000
   - INTERACTION_IDLE_MS = 350
   Document them.
4) When isInteracting is true, use `targetVisiblePoints = TARGET_VISIBLE_POINTS_INTERACT_DEFAULT` (or derived from device profile).
   When isInteracting is false, revert to normal `targetVisiblePoints`.

Important:
- If NodeSelector selection uses `runtimeBudgets.targetVisiblePoints`, make it depend on isInteracting.
- Do NOT change MAX_VISIBLE_POINTS, only the target.

C) Prevent layer rebuild thrash
5) Ensure point layers are memoized and independent of viewState:
   - Layers should be created from `renderData.tiles` (and patch layers etc.) using `useMemo`.
   - The memo dependencies MUST NOT include raw viewState.
   - Layer keys must be stable: key = `${datasetId}:${nodeId}` (or tileId).
6) Ensure `renderData` is not recreated on every viewState update:
   - ViewState changes should only trigger selection recompute (debounced) and scheduler actions.
   - Already loaded tiles should remain; avoid clearing arrays/maps.

D) Reduce expensive work while interacting (quick win)
7) While `isInteracting`:
   - set `pickable` to false on point layers (or globally disable picking)
   - (optional) reduce point radius/size slightly IF your layer supports it
   These should revert when idle.

E) Debug metrics
8) Add to Debug panel:
   - show `isInteracting`
   - show current `targetVisiblePoints` being used (interact vs idle)

Acceptance:
- `npm run lint` passes
- `npm run build` passes
- `npm run dev` works
- While orbiting/zooming, FPS improves noticeably on low/mid devices
- Debug shows isInteracting toggling and targetVisiblePoints switching
- No regressions: dataset still renders, streaming still works, no infinite reload loops

Deliverable:
- List changed files
- Briefly explain how you avoided layer rebuilds and how interaction budget works
