Task 12cd (Hotfix Bundle): 
(A) Fix "Range slice exceeds payload size" by handling EOF/short windows and cross-window reads.
(B) Prevent point cloud blackout during interaction by retaining previous tiles and delaying unload until replacements are ready.

Context:
- RangeWindowCache is implemented and shows good hits, but sometimes throws "Range slice exceeds payload size".
- During camera interaction (orbit/zoom/pan), the point cloud disappears completely and reappears, losing user orientation.
- We must keep rendering stable on low-end laptops and high-end PCs.

========================
PART A — RangeWindowCache robustness (EOF + cross-window)
========================

A1) Fix Range window fetch near EOF
- In `src/io/RangeFetch.ts` (or equivalent), ensure cache entries store:
  { url, windowStart, windowActualEnd, buffer, lastUsed }
- When fetching an aligned window [windowStart..windowEnd] (default WINDOW_BYTES=16MB):
  - If response is 206, parse `Content-Range: bytes start-end/total`:
    - extract totalSize (if present)
    - note that end may be < requested end near EOF
  - Always compute:
    windowActualEnd = windowStart + buffer.byteLength - 1

A2) Serving a slice must never exceed buffer length
- When serving a tile slice [start..start+length-1]:
  - Find windowStart = floor(start/WINDOW_BYTES)*WINDOW_BYTES
  - Ensure the requested end is within [windowStart..windowActualEnd]
  - If requested end > windowActualEnd:
    - Support cross-window reads:
      - Read the first part from current window
      - Fetch next window and read the remaining part
      - Concatenate into a new Uint8Array/ArrayBuffer and return it
  - Must also work when next window is short at EOF.

A3) Fallback when server does not support Range
- If fetch returns HTTP 200 and full content:
  - Treat it as a single cached window (windowStart=0, windowActualEnd=byteLength-1)
  - Serve slices from it.
- Keep cache budget bounded:
  - max windows per URL = 8
  - total window cache budget = 256MB
  - LRU eviction across windows

A4) Add tile range validation + diagnostics
- In container tile loading code (TileContainerLoader/TileManager):
  - Validate byteOffset>=0 and byteLength>0 before requesting.
  - If totalSize is known (from Content-Range total or cached full fetch):
    - if byteOffset+byteLength > totalSize:
      - log a clear error: nodeId, containerUrl, offset, length, totalSize
      - fail that tile load gracefully (do not crash the whole app)
- On RangeWindow failures, log (only on failure):
  - containerUrl
  - tile offset/length
  - windowStart, requested windowEnd, buffer.byteLength, windowActualEnd
  - response status + Content-Range header (if any)

Acceptance for Part A:
- No "Range slice exceeds payload size" when loading synth dataset
- Tiles load to expected counts
- Network shows stable window fetches; Range hits increase over time

========================
PART B — No blackout during interaction (retain set + delayed unload)
========================

B1) Track desired vs retained sets
- In the controller that applies NodeSelector output (Viewer/TileManager integration):
  - Keep `desiredNodeIds` (latest selector output).
  - Keep `retainedNodeIds` (what we actually render).
  - Initialize retained = desired on first successful selection.

B2) Update rules
- While interacting (orbit/zoom/pan):
  - retained must NEVER be cleared
  - Add already-loaded desired tiles into retained as they become available
  - DO NOT remove tiles from retained while interacting
- When idle (no interaction for MIN_IDLE_STABLE_MS):
  - retained should converge toward desired
  - unload/unpin gradually (not all at once)

B3) Config knobs (profile-aware)
- Add to budgets/config:
  - MIN_RETAINED_POINTS_INTERACT_DEFAULT = 500_000
  - MIN_IDLE_STABLE_MS_DEFAULT = 250
- Profile scaling:
  - low: min retained points 300k
  - balanced: 500k
  - high: 800k
(Clamp to sane bounds.)

B4) Pinning
- Pin tiles for retained set (not only desired set).
- When a tile leaves retained during idle, unpin it (then eviction may remove it).

B5) Progressive refine swap (coarse -> fine)
- If both coarse and fine nodes cover same region:
  - Do not remove coarse until fine children are loaded (present in cache).
- Implement a simple check using hierarchy parent/child relation:
  - keep parent in retained until at least one suitable child set is loaded (or until desired no longer includes that region).

B6) Debug stats
- Add to Debug panel:
  - desiredNodes count
  - retainedNodes count
  - retainedPoints estimate
  - isInteracting
  - lastInteractionMs

Acceptance for Part B:
- During orbit/zoom/pan: point cloud remains visible (no blackout)
- After idle: quality refines progressively (more tiles appear), old tiles unload smoothly
- No infinite reload loops; network remains stable; cache stays within budget

========================
Global Acceptance
========================
- `npm run lint` passes
- `npm run build` passes
- `npm run dev` works
- Synth dataset loads without range errors
- Interaction never blanks the scene

Deliverable:
- List changed files
- Short explanation of EOF handling and retain/unload policy
