# AGENTS.md (Codex instructions for this repo)

## Project summary
A web-based point cloud viewer built with React + TypeScript + Vite + deck.gl.
Current state:
- Viewer renders point clouds via deck.gl PointCloudLayer (WebGL).
- Data is loaded from a JSON manifest and binary tile files.
- State is handled via a React Context + useReducer store (viewState, hover, selection, activeDatasetId, renderData).
- Current loaders include: ManifestLoader, TileLoader (PCT1), TileManager.

## Goal
Evolve the app to support **massive point clouds (billions)** with:
- streaming tiles (no single merged buffer)
- PCT2 tiles: int32 positions + float64 origin/scale decode (high precision, UTM safe)
- binary hierarchy paging (avoid huge JSON)
- tile containers + HTTP Range requests (reduce request overhead)
- patch-based edits (add/delete/update) without rewriting base tiles

## Coding rules
- TypeScript strict; no `any` unless unavoidable.
- Keep changes incremental and keep the demo dataset rendering at all times.
- Prefer small focused commits.
- Add lightweight validation and defensive checks for binary parsing.
- Avoid introducing heavy dependencies unless necessary.

## Verification commands
- `npm run lint`
- `npm run build`
- `npm run dev` (manual smoke test: dataset loads, renders, hover + click picking works)
