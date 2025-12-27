Task 13 Hotfix a: Make Task 13 spec-complete by (1) removing the “decode-all” footgun in parsePct2Tile and (2) adding a real rawBuffer drop-on-pressure step before tile eviction.

IMPORTANT CONSTRAINTS (do not violate):
- Do not change the dataset-load useEffect deps; keep [activeDatasetId, dispatch] only.
- Do not set renderData to null except on dataset change.
- Keep canonical keys (keyFromNodeId/keyFromTile) and stable layer ids as-is.

Background:
- Current implementation supports lazy optional attrs via TileService.ensureTileAttributes.
- Two gaps remain:
  A) parsePct2Tile() still decodes ALL attrs (footgun).
  B) “memory pressure triggers drop” is not explicit; rawBuffers are mostly kept until eviction.

Goal:
- Ensure no code path decodes all attributes by default.
- Implement a budget-pressure step: drop rawBuffers on old tiles first, then evict tiles if needed.

========================================================
1) Remove “decode all attrs” from parsePct2Tile (footgun fix)
========================================================
Files: io/Pct2TileLoader.ts (or your current path)

Do this:
1.1) Rename the existing parsePct2Tile(buffer) (which decodes all attrs) to:
     - parsePct2TileEager(buffer)
     Keep its behavior, but DO NOT use it by default in streaming paths.

1.2) Implement a new parsePct2Tile(buffer) that decodes only mandatory attrs:
     - Use parsePct2HeaderAndDirectory(buffer) + decodePct2Mandatory(...)
     - Return the same TileRenderData shape needed by rendering: positions + (optional) colors + origin + pointCount + nodeId if available.
     - Do NOT decode classification/intensity/etc.

1.3) Grep the codebase for parsePct2Tile( and ensure:
     - Streaming/tile loading uses the new mandatory-only parsePct2Tile (or decodePct2Mandatory).
     - If any tools/tests truly need eager decode, they must call parsePct2TileEager explicitly.

Acceptance for (1):
- No default code path decodes all attributes for every tile.
- Lint/build passes.

========================================================
2) Add rawBuffer drop-on-pressure BEFORE tile eviction (true “memory pressure” handling)
========================================================
Files: io/TileService.ts (or wherever cache+budget enforcement lives), possibly io/LoadScheduler.ts

Goal:
- When cpuCacheBudgetBytes is exceeded (or about to be exceeded), drop rawBuffers from cached tiles (balanced/high) before evicting whole tiles.
- Low profile already drops immediately; keep that.

Implement:
2.1) Add a method on TileService:
     - dropRawBuffersToFitBudget(targetBytes: number): number
       Returns how many rawBuffers were dropped.

2.2) Selection policy for which tiles to drop rawBuffer from:
     - Only consider tiles that currently retain rawBuffer.
     - Prefer oldest first (LRU / lastUsed / lastOptionalAccess).
     - Prefer dropping from pinned tiles only if they have not requested optional attrs recently (respect your existing pinned grace logic).
     - Never drop if rawBuffer is already absent.

2.3) Integrate into budget enforcement:
     - Wherever you currently enforce cpu budget / evict tiles (TileService or LoadScheduler):
       BEFORE evicting tiles, call dropRawBuffersToFitBudget(budgetsRef.current.cpuCacheBudgetBytes).
     - Then recompute current bytes (or decrement as you drop).
     - Only if still over budget, proceed with tile eviction.

2.4) Stats:
     - Extend TileService.stats() to include:
       - rawBufferDroppedOnPressureCount (counter)
       - rawBufferBytesDropped (counter)
     - Expose these in runtimeStats (Sidebar debug is optional but preferred).

Acceptance for (2):
- On balanced/high, when budget is exceeded, rawBuffers are dropped first and tiles remain cached if possible.
- low profile behavior unchanged.
- No crashes when ensureTileAttributes triggers refetch after rawBuffer drop.
- Lint/build passes.

========================================================
3) Final verification checklist
========================================================
- npm run lint
- npm run build
- In dev, load dataset, move camera: no regressions.
- Confirm in debug:
  - rawBufferRetainedCount decreases under pressure without immediately reducing loadedTiles.
  - optional attrs can still be fetched after rawBuffer drop (ensureTileAttributes triggers refetch).

Deliverable:
- List changed files and briefly explain:
  - New parsePct2Tile behavior (mandatory-only) and parsePct2TileEager usage.
  - How rawBuffer drop-on-pressure works and why it improves stability.



Task 13 Hotfix A: Make rawBuffer dropping actually reduce memory + fix pinned rawBuffer policy

Context:
- Current code drops entry.rawBuffer in low profile, but if positions are Float32Array views into the original buffer, memory isn't actually freed.
- Also, pinned policy drops rawBuffer immediately because lastOptionalAccess is undefined (treated as 0).

Goals:
1) Ensure mandatory positions do NOT retain the raw PCT2 buffer (copy Float32 positions).
2) Remove the "pinned auto-drop after grace without pressure" behavior. Raw buffers should be kept in balanced/high unless:
   - low profile, OR
   - memory pressure path (dropRawBuffersToFitBudget) drops them.

Changes:

A) viewer/src/io/Pct2TileLoader.ts
- In decodePositions():
  - When attribute is Float32Array, validate length, then RETURN A COPY so it does not reference the original buffer.
  - Use attribute.slice(0, elementCount) (or new Float32Array(attribute.subarray(0, elementCount))).
  - Keep strict error checks unchanged.

Pseudo patch:

if (attribute instanceof Float32Array) {
  if (attribute.length < elementCount) throw new Error("PCT2 position attribute truncated.");
  return attribute.slice(0, elementCount);
}

B) viewer/src/io/TileService.ts
- In applyRawBufferPolicy():
  - Keep: if profile === "low" -> entry.rawBuffer = undefined
  - REMOVE pinnedKeys-based time drop (the OPTIONAL_ATTR_GRACE_MS logic) from applyRawBufferPolicy.
  - Reason: pinned/rawBuffer dropping should be driven by memory pressure (dropRawBuffersToFitBudget) or low profile, not by pin state.

So applyRawBufferPolicy becomes:

private applyRawBufferPolicy(entry: CachedTileEntry, _key: string) {
  if (!entry.rawBuffer) return;
  if (this.profile === "low") {
    entry.rawBuffer = undefined;
  }
}

- Keep dropRawBuffersToFitBudget() logic as-is (this is the "memory pressure triggers drop" path).

Verification steps:
1) npm run lint
2) npm run build
3) npm run dev
4) In UI enable Debug + set Profile=low:
   - Raw Buffers count should stay near 0
   - CPU Cache bytes should go down vs balanced/high when similar tiles are loaded (since Float32 positions no longer keep the raw buffer alive).
5) Optional: call ensureTileAttributes() (from console / future tool) and confirm it can refetch + decode without crashing.

After:
- List changed files:
  - src/io/Pct2TileLoader.ts
  - src/io/TileService.ts
- Briefly explain why copying Float32 positions is needed for actual rawBuffer memory release.


Task 13 — Hotfix A: Make rawBuffer dropping actually free memory

Problem:
Optional attributes decoded with decodePct2Attributes() are views into rawBuffer.
Dropping entry.rawBuffer = undefined does NOT free the underlying ArrayBuffer if any decodedOptional TypedArray still references it.

Fix:
Before clearing rawBuffer, detach any decodedOptional arrays that share rawBuffer (copy via slice()).

Implement in: viewer/src/io/TileService.ts

Changes:
1) Add helpers:
   - cloneTypedArray(value: TypedArray): TypedArray
   - detachOptionalFromRawBuffer(entry: CachedTileEntry): void
   - dropEntryRawBuffer(entry: CachedTileEntry): void

2) Use dropEntryRawBuffer():
   - in applyRawBufferPolicy() when profile === "low"
   - in dropRawBuffersToFitBudget() when deciding to drop
   - in dropAllRawBuffers() (when switching to low)

Keep behavior otherwise unchanged.

After:
- npm run lint
- npm run build
- npm run dev
- In low profile: raw buffers should truly be releasable even after optional attrs were requested.


Task 13 Hotfix A: Per-tile debug in Sidebar (hovered tile)

Implement:
1) In Viewer.tsx: expose tileService instance in DEV only:
   - inside Viewer component, add:
     if (import.meta.env.DEV) (window as any).__tileService = tileServiceRef.current;

2) In Sidebar.tsx:
   - When hover exists and settings.debugEnabled:
     - compute key = hover.nodeId ? keyFromNodeId(hover.nodeId) : null
     - read entry via (window as any).__tileService?.getCachedEntry(key)
     - display:
       - RawBuffer retained: entry?.rawBuffer ? "yes" : "no"
       - Optional attrs decoded: entry?.decodedOptional?.size ?? 0
   - Keep it guarded so it does nothing in prod / when not available.

Acceptance:
- npm run lint passes (add safe optional chaining + guard for window)
- UI shows per-hover tile debug only when Debug Enabled
