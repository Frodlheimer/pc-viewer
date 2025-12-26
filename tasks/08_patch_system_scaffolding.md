# Task 08 — Patch system scaffolding

Copy/paste the whole block below into Codex (VS Code) as a single instruction.

---

Task: Add patch system scaffolding (delta edits) without heavy UI.

Steps:
1) Extend store.tsx:
   - editMode: "none" | "add" | "delete" | "update" | "measure" | "select"
   - patches:
     - addedPoints: { positions: Float32Array, colors?: Uint8Array, attributes?: Record<string, TypedArray> }
     - deleted: Map<string /*tileId or nodeId*/, Uint8Array|boolean[] /*mask*/>
     - updatedAttributes: Map<string, Map<number, Record<string, number>>> (MVP structure)

2) Add PatchLayersFactory.ts:
   - Added points rendered as ScatterplotLayer or PointCloudLayer
   - Deletions/updates can be TODO visually; data model must exist

3) Add minimal UI toggles (Toolbar or Sidebar) to switch editMode and display patch counts.

Acceptance:
- npm run lint passes
- npm run build passes
- Demo dataset renders and hover/click picking still works
- No breaking type errors (TypeScript)
