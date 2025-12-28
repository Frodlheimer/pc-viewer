# Point Cloud Viewer

Web-based viewer for large point clouds built with React + TypeScript + Vite + deck.gl.
Supports streaming tiles (PCT1/PCT2), binary hierarchy paging (PCH1), range requests,
and patch-based edits (add/delete/update) without rewriting base tiles.

## Quick start
```bash
cd viewer
npm install
npm run dev
```

## Verify
```bash
cd viewer
npm run lint
npm run build
```

## Repo structure
- `viewer/` React app (rendering, UI, streaming)
- `docs/spec/` Binary format specs (PCT2, hierarchy paging, edit patches)
- `docs/architecture/` System overview and invariants
- `tools/` Dataset generation helpers
- `tasks/` Historical Codex task prompts (optional reference)

## Key docs
- `docs/architecture/overview.md`
- `docs/spec/pct2.md`
- `docs/spec/hierarchy_paging.md`
- `docs/spec/edit_patches.md`
