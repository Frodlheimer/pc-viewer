# Task 07 — Binary hierarchy paging MVP

Copy/paste the whole block below into Codex (VS Code) as a single instruction.

---

Task: Implement binary hierarchy paging loader + minimal node selector (MVP).

Goal:
- Replace giant JSON tile lists with on-demand hierarchy pages.

Steps:
1) Add Hierarchy types:
   - NodeRecord, Page
2) Add HierarchyPagingLoader.ts:
   - loadPage(url, pageIndex) -> parse PCH1 page
   - LRU cache (max pages configurable)
3) Add NodeSelector.ts:
   - selectNodes(inputs, hierarchy, maxNodes) -> NodeRecord[]
   - MVP rule: choose nodes by a fixed LOD level (zoom->level), no frustum math yet.
4) Integrate:
   - If dataset.json contains hierarchyUrl, use hierarchy pages to determine which tiles to load.
   - Otherwise fall back to old manifest tile list (for demo).

You may add a tiny demo hierarchy.pch file generation script or ship a small binary under the demo dataset folder.

Acceptance:
- npm run lint passes
- npm run build passes
- Demo dataset renders and hover/click picking still works
- No breaking type errors (TypeScript)
