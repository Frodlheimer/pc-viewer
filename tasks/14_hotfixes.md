Task 14 — hotfix a (Selection + Measure clicks work again, no Shift required)

Context:
Selection + Measure currently require Shift in Viewer.handleClick(), so normal clicks do nothing.
Also Shift-click in Select mode is intercepted by the rectangle-selection mouse capture handlers.

Goal of hotfix:
- In "select" mode: normal left-click selects a point (nodeId + indexWithinTile).
- In "measure" mode: normal left-click sets A then B (third click starts a new measure).
- Keep rectangle selection as Shift+Drag (to avoid breaking orbit/rotate).
- Update Sidebar helper text (no more “Shift-click”).

Make these edits:

1) src/layers/PointCloudLayerFactory.ts
- Forward the original event to callbacks (optional, but good for future; does not change behavior).
- Update PointCloudCallbacks types accordingly.

PATCH:

--- a/src/layers/PointCloudLayerFactory.ts
+++ b/src/layers/PointCloudLayerFactory.ts
@@
 export type PointCloudCallbacks = {
-  onHover: (info: PickingInfo) => void;
-  onClick: (info: PickingInfo) => void;
+  onHover: (info: PickingInfo, event?: unknown) => void;
+  onClick: (info: PickingInfo, event?: unknown) => void;
 };
@@
   return new PointCloudLayer<BinaryAttributes>({
@@
-    onHover: callbacks.onHover,
-    onClick: callbacks.onClick,
+    onHover: (info, event) => callbacks.onHover(info, event),
+    onClick: (info, event) => callbacks.onClick(info, event),
   });

2) src/viewer/Viewer.tsx
- Remove the Shift-gate from handleClick.
- Route click behavior by editMode:
  - select: replace selection with the clicked point
  - measure: first click sets A, second sets B+distance, third click starts new (A=clicked, clears B)

PATCH:

--- a/src/viewer/Viewer.tsx
+++ b/src/viewer/Viewer.tsx
@@
   const handleClick = useCallback(
     (tile: TileRenderData, info: PickingInfo) => {
-      const shiftKey = Boolean(
-        (
-          info as PickingInfo & {
-            srcEvent?: MouseEvent | PointerEvent;
-          }
-        ).srcEvent?.shiftKey
-      );
-      if (!shiftKey) {
-        return;
-      }
       if (info.index === undefined || info.index < 0) {
         return;
       }
       const item = buildSelectionItem(
         tile,
         info.index,
         Array.isArray(info.coordinate) ? info.coordinate : null
       );
-      if (editMode === "measure") {
-        if (!measurement.a || measurement.b) {
-          dispatch({ type: "set-measurement", measurement: { a: item } });
-          return;
-        }
-        const dx = measurement.a.worldPos[0] - item.worldPos[0];
-        const dy = measurement.a.worldPos[1] - item.worldPos[1];
-        const dz = measurement.a.worldPos[2] - item.worldPos[2];
-        const distance = Math.hypot(dx, dy, dz);
-        dispatch({
-          type: "set-measurement",
-          measurement: { a: measurement.a, b: item, distance },
-        });
-        return;
-      }
-      if (editMode === "select") {
-        dispatch({
-          type: "set-selection",
-          selection: { items: [item] },
-        });
-      }
+      if (editMode === "select") {
+        dispatch({ type: "set-selection", selection: { items: [item] } });
+        return;
+      }
+
+      if (editMode === "measure") {
+        // 1st click -> set A
+        if (!measurement.a) {
+          dispatch({ type: "set-measurement", measurement: { a: item } });
+          return;
+        }
+        // 3rd click (A and B already set) -> start new measurement
+        if (measurement.a && measurement.b) {
+          dispatch({ type: "set-measurement", measurement: { a: item } });
+          return;
+        }
+        // 2nd click -> set B + distance
+        const dx = measurement.a.worldPos[0] - item.worldPos[0];
+        const dy = measurement.a.worldPos[1] - item.worldPos[1];
+        const dz = measurement.a.worldPos[2] - item.worldPos[2];
+        const distance = Math.hypot(dx, dy, dz);
+        dispatch({
+          type: "set-measurement",
+          measurement: { a: measurement.a, b: item, distance },
+        });
+      }
     },
     [buildSelectionItem, dispatch, editMode, measurement]
   );

3) src/ui/Sidebar.tsx
- Update helper text in Measure panel (no more shift-click)
- Add a small hint for Select mode usage (click selects; Shift+Drag box-select)

PATCH:

--- a/src/ui/Sidebar.tsx
+++ b/src/ui/Sidebar.tsx
@@
       <div className="sidebar-section">
         <div className="sidebar-title">Selection</div>
@@
         ) : (
           <div className="sidebar-meta">None</div>
         )}
+        <div className="sidebar-meta">
+          Tip: Click selects a point. Shift+Drag draws a selection rectangle.
+        </div>
@@
       <div className="sidebar-section">
         <div className="sidebar-title">Measure</div>
@@
         ) : (
-          <div className="sidebar-meta">Shift-click to set A</div>
+          <div className="sidebar-meta">Click to set A (then click B)</div>
         )}
       </div>

Verification checklist:
- npm run dev
- Set Edit Mode = Select:
  - Click a point -> Selection updates (Node/Index/Pos shown)
  - Shift+Drag -> rectangle selection returns multiple points
- Set Edit Mode = Measure:
  - Click point A -> A shown in sidebar
  - Click point B -> line appears + distance shown
  - Click a third point -> measurement resets (new A)

Acceptance:
- lint/build should still pass (only type-safe changes)
- orbit/zoom not regressed (rectangle selection still requires Shift)
After:
- Changed files:
  - src/viewer/Viewer.tsx
  - src/ui/Sidebar.tsx
  - src/layers/PointCloudLayerFactory.ts



Task 14 — Hotfix A: Fix picking for Select + Measure

Problem:
- Point layers are set to pickable: !isInteracting
- isInteracting can be true during/around clicks due to controller/viewstate updates
- result: click picks return index=-1/undefined, so selection/measure does nothing.

Fix:
- If editMode is "select" or "measure" (and later also "delete"/"update"), force pickable=true.
- Keep the performance optimization for "none" mode: pickable only when not interacting.
- Optional: disable autoHighlight while interacting.

Steps:
1) Update viewer/Viewer.tsx:
   - Introduce a boolean like:
     const forcePicking = editMode === "select" || editMode === "measure" || editMode === "delete" || editMode === "update";
   - Use it when creating point layers:
     pickable: forcePicking ? true : !isInteracting
     autoHighlight: forcePicking ? false : !isInteracting

2) Keep the rest unchanged:
   - Select mode: normal left click selects a point (nodeId + index)
   - Rectangle selection: Shift+Drag still works
   - Measure mode: normal left click sets A, second click sets B and distance; third click resets A

3) (Optional UX) Update Sidebar tip text to clarify:
   - Select: Click selects, Shift+Drag rectangle
   - Measure: Click A then B

Acceptance:
- Clicking points in Select mode updates Sidebar selection immediately
- Clicking points in Measure mode draws the line + distance
- No regression in orbit/zoom/streaming
- npm run lint/build/dev ok

After:
- List changed files (should be Viewer.tsx, optional Sidebar.tsx)
