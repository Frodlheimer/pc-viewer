# Edit Patches (v1) – Delta edits without rewriting base tiles

**Goal:** Allow in-browser editing at scale.

## Identity
A base point is referenced by:
- `nodeId` (uint64) + `index` (uint32 within that tile's point array)

## Patch model (in-memory + serializable)
Patches are logically layered over the immutable base dataset.

### 1) Additions
- Stored as a separate small point set (optionally its own mini-octree later).
- Attributes follow the same schema system as base (position is required).

### 2) Deletions
- For each nodeId, store a bitset of deleted indices.
- MVP: boolean[] or Uint8Array mask.
- Scalable: Roaring bitmap or compressed bitset.

### 3) Updates
- For each nodeId, store sparse overrides: Map<index, partialAttrs>.
- Rendering can:
  - ignore overrides in MVP,
  - or apply overrides in shader once attribute override textures/buffers exist.

## Future merge/compact
A backend/local job can materialize patches into a new dataset version:
- apply deletions and updates
- merge additions
- rebuild hierarchy/tiles
