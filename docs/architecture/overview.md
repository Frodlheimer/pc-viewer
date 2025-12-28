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
   - If `hierarchyUrl` is present, page 0 is loaded via
     `viewer/src/io/HierarchyPagingLoader.ts`.
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
  - `viewer/src/io/RangeFetch.ts` performs HTTP range window caching.
  - `viewer/src/io/TileContainerLoader.ts` loads tiles from .pctc containers.
- **State**
  - `viewer/src/state/store.tsx` owns view state, patches, and runtime stats.
- **Budgets**
  - `viewer/src/config/budgets.ts` resolves device-aware runtime budgets.

## Runtime invariants
- Base tiles are immutable; edits are patches layered on top.
- Point identity is `(nodeId, indexWithinTile)`.
- Selection and caching are budget-driven to keep FPS stable.

## Scaling notes
- PCT2 uses int32 positions with float64 origin/scale for high precision.
- Range requests minimize request overhead for tile containers.
- Cache budgets guard CPU memory; GPU budget is tracked by layer count/size.
