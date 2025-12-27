Task 15: Implement Delete MVP using per-tile deletion mask and GPU-side discard (no heavy CPU rebuilds).

IMPORTANT CONSTRAINTS (do not violate):
- Do not change dataset-load effect deps; keep [activeDatasetId, dispatch] only.
- Do not set renderData to null except on dataset change.
- Layer IDs must remain stable: `${activeDatasetId}:${keyFromTile(tile)}` only.
- Use canonical keys everywhere: keyFromNodeId / keyFromTile.
- Avoid recreating all layers just because one tile's delete mask changed. Update per-tile attributes.

Goal:
- Deleting points must not rebuild positions/colors arrays.
- Must scale across many tiles and devices.

Requirements:
1) Patch state:
   - Ensure patches.deleted exists and is keyed by nodeKey (string):
     - Map<string, Uint8Array> where length == pointCount (0 keep, 1 deleted)
   - MVP uses Uint8Array; bitset optimization later.

2) Tool behavior:
   - Add editMode "delete".
   - Delete actions only trigger with Shift (to not compete with orbit):
     - Shift-click deletes one picked point (nodeKey + indexWithinTile).
   - If selection exists:
     - Provide a "Delete selection" action in Sidebar.
     - Deleting selection updates only affected nodeKey masks.

3) Rendering: GPU discard without rebuilding arrays
   - Use deck.gl DataFilterExtension OR equivalent shader-based discard.
   - Implement per-point filter attribute:
     - keepValue = 1 for keep, 0 for deleted
     - filterRange = [0.5, 1.5] to keep only keepValue==1
   - Per-tile update strategy (critical):
     - Maintain a ref/map: filterValuesByTileKey: Map<string, Uint8Array>
     - For each tile layer, supply its filterValues (typed array) as an instanced attribute.
     - When a tile's delete mask changes, update ONLY that tile’s filterValues array and trigger a redraw.
     - Do NOT rebuild big position/color arrays.

4) Integration with layer factory:
   - Update createPointCloudLayer (or factory options) to accept an optional filterValues array.
   - Keep layer id stable and keyed only by datasetId + tileKey.
   - Ensure changes to delete mask do not cause layer ids to change.

5) Debug:
   - Show:
     - totalDeletedCount (sum over all masks) in Sidebar debug stats.
     - optionally, deleted count for hovered tile/nodeKey.

Acceptance:
- npm run lint passes
- npm run build passes
- npm run dev works
- Deleted points disappear immediately
- No full reload / no tile cache clear / no thrash when deleting many points
- Camera navigation still works normally when Shift is NOT held
- Streaming and retained rendering remain stable (no blackouts)

After:
- List changed files and explain how you avoided copying big arrays and minimized updates.


Task 15 Hotfix A: Fix GPU discard so deleting a single point does NOT hide the whole tile.

Problem:
- Viewer builds filterValues with 255 for keep and 0 for delete.
- PointCloudLayerFactory passes getFilterValue as Uint8Array with normalized:true and filterRange [0.5, 1.5].
- Depending on attribute normalization path, 255 may not normalize to 1.0 -> everything filtered out.

Fix:
1) Use 0/1 filter values (keep=1, deleted=0) instead of 0/255.
2) Do NOT set normalized:true for getFilterValue (leave undefined/false).
3) (Optional but aligns with Task 15 spec) In delete mode, delete on normal click (remove shift requirement).

Edits:

A) viewer/Viewer.tsx
- In filterValuesByTileKey:
  - change filterValues.fill(255) -> filterValues.fill(1)
  - keep deleted points at 0 (already ok)
- In handleClick delete mode:
  - remove the shiftKey gating so a normal click deletes one picked point.

B) layers/PointCloudLayerFactory.ts
- When setting attributes.getFilterValue:
  - remove normalized:true (set nothing or normalized:false)

After:
- npm run dev
- Switch to Delete mode, click 1 point:
  - only that point disappears
  - tile remains visible
- Delete counter still increases.



Hotfix 15: Fix DataFilterExtension wiring so deleting a single point does NOT hide the entire tile.

Context:
Currently after deleting one point, the whole tile disappears. This happens because DataFilterExtension is enabled with filterRange, but getFilterValue is not provided as a layer prop. As a result, filter values default to 0 and filterRange [0.5,1.5] discards all points.

Goal:
- When delete mask exists for a tile, only deleted points are discarded on GPU.
- Non-deleted points remain visible immediately.
- No CPU rebuild of position/color arrays.

Steps:

1) Update layers/PointCloudLayerFactory.ts
   - Keep existing binary mode data object.
   - If options.filterValues is provided:
     a) Ensure data.attributes includes getFilterValue as a binary attribute:
        attributes.getFilterValue = { value: options.filterValues, size: 1, normalized: false }
        (normalized must be false, because we use 0/1 values)
     b) ALSO set the layer prop getFilterValue to a fallback accessor that reads from the same array:
        getFilterValue: (_d: unknown, info: { index: number }) => options.filterValues![info.index] ?? 1
        This must exist even if binary attributes are present, to ensure the extension is wired and works consistently.
     c) Ensure DataFilterExtension is enabled only when options.filterValues exists:
        extensions: [new DataFilterExtension({ filterSize: 1 })]
        filterEnabled: true
        filterRange: [0.5, 1.5]
     d) Ensure updateTriggers includes getFilterValue:
        updateTriggers: { getFilterValue: options.filterVersion ?? options.filterValues }

   - If options.filterValues is NOT provided:
     - Do not enable the extension
     - Do not set filterRange/getFilterValue props

2) Validate deletion value convention:
   - The filterValues array must be: 1 = keep, 0 = deleted.
   - If current code uses a deleteMask with 1 = deleted, ensure the derived filterValues are inverted before passing to createPointCloudLayer.

3) Checks:
   - npm run lint
   - npm run build
   - npm run dev
   - In delete mode:
     - click one point => only that point disappears, rest of tile remains visible
     - delete multiple points => only those points disappear
     - camera movement does not cause tile to vanish

After completion:
- Print which files changed
- Briefly explain why missing getFilterValue caused the whole tile to disappear.
