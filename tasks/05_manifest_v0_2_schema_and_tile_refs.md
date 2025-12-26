# Task 05 — Manifest V0.2 (schema + tile refs)

Copy/paste the whole block below into Codex (VS Code) as a single instruction.

---

Task: Evolve the dataset manifest types to V0.2 while keeping compatibility.

Goal:
- Dataset-level schema: CRS, units, attributes list, roles
- Tile refs support either:
  A) standalone url
  B) containerUrl + byteOffset + byteLength (for range loading)

Steps:
1) Update Dataset.ts types:
   - schemaVersion: number
   - crs: { epsg?: number, wkt?: string }
   - units: string
   - attributes: Array<{ name: string, type: string, components: number, role?: "position"|"color"|"intensity"|"classification"|"custom" }>
   - roles: { position: string, color?: string } (attribute names used for rendering)
   - boundsQuantization: { origin:[number,number,number], scale:[number,number,number] } (for hierarchy bounds decoding)

2) Update ManifestLoader.ts:
   - Accept both old demo manifest and new V0.2 manifest.
   - Basic validation:
     - schemaVersion exists
     - roles.position exists
     - bounds present

3) Update demo manifest in your public dataset folder to include schemaVersion/roles (keep old fields too if needed).

Acceptance:
- npm run lint passes
- npm run build passes
- Demo dataset renders and hover/click picking still works
- No breaking type errors (TypeScript)
