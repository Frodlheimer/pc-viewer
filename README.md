# Codex Prompt Pack (PCT2 int32+scale) – for your Point-Cloud Viewer

This pack contains **copy/paste prompts** you run in **Codex inside VS Code** to evolve your current project towards:
- PCT2 binary tiles (int32 positions + origin/scale)
- tile-based rendering (no global merge)
- range-request tile containers
- binary hierarchy paging
- patch-based edits (delta layer)

## How to use (VS Code + Codex)
1. Unzip this folder into your repo root (so you get `AGENTS.md`, `docs/spec/*`, `tasks/*`).
2. Commit it to GitHub.
3. In VS Code, open one task file under `tasks/` and **paste the entire prompt** into Codex (one task at a time).
4. After each task, run:
   - `npm run lint`
   - `npm run build`
   - `npm run dev` (verify demo renders & picking works)

## Branching suggestion
```bash
git checkout -b feat/pct2-v0
git add -A
git commit -m "Add Codex prompt pack + specs"
git push -u origin feat/pct2-v0
```

## Task order
Run tasks in numeric order:
- 01 -> 08

## Notes
- Prompts assume your current files exist (Viewer.tsx, TileManager.ts, TileLoader.ts, store.tsx, etc.).
  If your repo uses a `src/` folder, Codex should locate files via search and apply changes in the correct paths.
