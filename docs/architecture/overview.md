# Architecture Overview
*Updated:* 2025-12-27

This document explains how the viewer streams, selects, renders, and edits
large point clouds.

## Data flow (high level)
1) **Dataset selection**
   - UI chooses a dataset from `viewer/src/types/Dataset.ts`.
2) **Manifest load**
   - `viewer/src/io/ManifestLoader.ts` fetches and normalizes `dataset.json`.
3) **Hierarchy (optional)**
   - If `hierarchyUrl` is present, `viewer/src/viewer/Viewer.tsx` initializes a
     `viewer/src/io/HierarchyPager.ts` which loads hierarchy pages sequentially.
   - Additional pages are requested when node selection detects missing children
     needed for refinement (no hard crash on EOF / unknown total size).
4) **Node selection**
   - `viewer/src/io/NodeSelector.ts` selects nodes based on view frustum,
      SSE, and runtime budgets.
5) **Tile streaming**
   - `viewer/src/io/LoadScheduler.ts` queues desired nodes and limits
     concurrent requests.
   - `viewer/src/io/TileService.ts` loads tiles, applies cache budgets,
     and optionally decodes extra attributes.
6) **Render**
   - `viewer/src/layers/PointCloudLayerFactory.ts` builds deck.gl layers
     per tile.
7) **Edits (patches)**
   - Adds: `viewer/src/layers/PatchLayersFactory.ts` draws added points.
   - Deletes: `viewer/src/utils/visibilityMask.ts` creates a filter mask
     used by the PointCloudLayer DataFilterExtension.

## Key modules
- **Viewer orchestration**
  - `viewer/src/viewer/Viewer.tsx` ties together view state, selection,
    scheduling, and UI events.
- **I/O**
  - `viewer/src/io/Pct2TileLoader.ts` parses PCT2 tiles.
  - `viewer/src/io/HierarchyPager.ts` pages hierarchy records on demand.
  - `viewer/src/io/RangeFetch.ts` performs HTTP range window caching.
  - `viewer/src/io/TileContainerLoader.ts` loads tiles from .pctc containers.
- **State**
  - `viewer/src/state/store.tsx` owns view state, patches, and runtime stats.
- **Budgets**
  - `viewer/src/config/budgets.ts` resolves device-aware runtime budgets.
  - The active profile comes from `state.settings.performanceProfile` (Debug sidebar).

## Runtime invariants
- Base tiles are immutable; edits are patches layered on top.
- Point identity is `(nodeId, indexWithinTile)`.
- Selection and caching are budget-driven to keep FPS stable.

## Scaling notes
- PCT2 uses int32 positions with float64 origin/scale for high precision.
- Range requests minimize request overhead for tile containers.
- Cache budgets guard CPU memory.
- `viewer/src/io/TileCache.ts` accounts CPU bytes by unique buffer identity (global
  refcounts) to avoid double counting shared `ArrayBufferLike` instances.
