# Task 15 — Delete MVP: Per-tile Mask + GPU Discard (no array rebuild)

> **How to use:** Copy the entire block under **PROMPT** into Codex (VS Code).
> Run in the `viewer/` project.

## PROMPT

Task 15: Implement Delete MVP using per-tile deletion mask and GPU-side discard (no heavy CPU rebuilds).

Goal:
- Deleting points must not rebuild positions/colors arrays.
- Must scale across many tiles and devices.

Requirements:
1) Patch state:
   - Ensure patches.deleted is present and keyed by nodeId:
     - Map<string, Uint8Array> where length == pointCount (0 keep, 1 deleted)
   - Keep it stable and simple for MVP (bitset optimization can be later).

2) Tool behavior:
   - In delete mode:
     - click deletes a single picked point (nodeId + index).
     - if selection exists, provide "Delete selection" action.
   - Update only the affected nodeId mask (do not touch other tiles).

3) Rendering (GPU discard):
   - Implement GPU filtering in point layers:
     - Preferred: use deck.gl DataFilterExtension (or equivalent) with a per-point attribute:
       - keepValue = 1 for keep, 0 for deleted
       - filterRange = [0.5, 1.5] to keep only keepValue==1
   - Update strategy:
     - When a tile's delete mask changes, update only that tile layer's filter attribute buffer.
     - Avoid recreating all layers; keep layer keys stable and only update props/attributes for the affected tile.

4) Debug:
   - Show total deleted count in Sidebar debug stats.
   - Optionally show deleted count for currently hovered nodeId.

Acceptance:
- `npm run lint` passes
- `npm run build` passes
- `npm run dev` works
- Deleted points disappear immediately
- No full reload or thrash when deleting many points

After:
- List changed files and explain how you avoided copying big arrays.
