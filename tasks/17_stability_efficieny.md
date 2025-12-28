# Codex-Tasks: Bugfixes & Performance-Optimierung (Gigantische Punktwolken)

Stand: 2025-12-27  
Quelle: Analyse basierend auf `_merged_source.txt` (zusammengeführter Code) sowie den Projekt-Dokumenten.

---

## Epic 0 — Build wieder grün machen (Merge-Artefakte entfernen)

### Task 0.1 — Spread/„Dot“-Syntaxfehler systematisch reparieren
**Problem:** In mehreren Files steht ein einzelnes `.` statt Spread `...` (z. B. `return { .state, ... }` / `return [ .baseLayers, ... ]`). Das kompiliert nicht.

**Codex Steps**
1. Repo-wide Suche nach Mustern:
   - `return { .`
   - `return [ .`
   - `, .state`
   - `, .action`
   - `patches: { .`
2. Ersetze korrekt:
   - `{ .state, x: y }` → `{ ...state, x: y }`
   - `{ .state.settings, .action.settings }` → `{ ...state.settings, ...action.settings }`
   - `[ .baseLayers, .patchLayers ]` → `[ ...baseLayers, ...patchLayers ]`
3. Danach `tsc`/`vite build` laufen lassen und **alle** resultierenden Syntax-/Typefehler fixen (es können weitere Copy/Paste-Artefakte auftauchen).

**Acceptance Criteria / DoD**
- TypeScript Build läuft fehlerfrei.
- Keine “Unexpected token .” / “Expression expected” mehr.

---

## Epic 1 — RangeFetch sicher & performant machen (keine GB-Fallbacks)

### Task 1.1 — Full-File-Fallback bei `200` für große Assets deaktivieren (Range muss `206` liefern)
**Problem:** `RangeFetch` cached bei `response.status === 200` (Server ignoriert Range) den kompletten Download als `isFullFile: true`. Bei gigantischen Container-Dateien ist das fatal.

**Codex Steps**
1. In `io/RangeFetch.ts` eine Option/Policy ergänzen:
   - z. B. `allowFullFileFallback?: boolean` (default: `false`)
   - oder `require206?: boolean` (default: `true` für Container/Hierarchie)
2. Implementiere in `fetchWindow`:
   - Wenn `response.status === 200` und `allowFullFileFallback !== true`:
     - **throw new Error** mit klarer Message:  
       `"Server does not support Range Requests (206)."`
   - Optional: Fallback nur erlauben, wenn Datei klein ist (z. B. `< 32MB`), sonst Error.
3. Option an alle relevanten Aufrufer durchreichen:
   - Hierarchy Header/Page Loads
   - Container Tile Loads
   - Alles, was potentiell sehr groß wird → `allowFullFileFallback: false`
4. DEV-Logging: Wenn `200` kommt, log `range unsupported` + URL + Hint.

**Acceptance Criteria / DoD**
- Container/Hierarchy Loads schlagen **hart** fehl, wenn Server keine Range-Requests unterstützt (statt still GBs zu ziehen).
- Kleine Demo-Dateien können optional weiterhin `200` nutzen (wenn bewusst erlaubt).

---

### Task 1.2 — Zero-Copy Fast Path für Range-Lesen (Views statt Kopien)
**Problem:** `fetchRange` erstellt immer `new Uint8Array(length)` und kopiert aus Window(s). Das ist teuer.

**Codex Steps**
1. Neue API ergänzen (zusätzlich zur bestehenden):
   - `fetchRangeView(url, start, length, signal?, options?) -> Uint8Array`
2. Implementierung:
   - Wenn gewünschter Range komplett in **einem** Window liegt:
     - `return new Uint8Array(windowEntry.buffer, inWindowOffset, length)` (**View**, keine Kopie)
   - Wenn Range über Windows geht:
     - fallback auf bisherigen Copy-Path.
3. Parser/Loader refactoren (Header/Page/Tile):
   - Akzeptiere `(buffer, byteOffset)` oder direkt `Uint8Array`.
4. `fetchRangeView` dort einsetzen, wo häufig gelesen wird:
   - Header lesen
   - Hierarchy Pages
   - Container Tile-Slices

**Acceptance Criteria / DoD**
- Häufige Reads laufen ohne Heap-Kopie (wenn in einem Window).
- Bestehende API `fetchRange` bleibt kompatibel.

---

## Epic 2 — HierarchyPagingLoader: `pageBytes` Bug fixen

### Task 2.1 — `resolvePageBytes` darf Default nicht als Override behandeln
**Problem:** `loadPage` übergibt `options?.pageBytes ?? DEFAULT_PAGE_BYTES` an `resolvePageBytes`. Wenn `options.pageBytes` **nicht** gesetzt ist, verhindert das das Lesen aus dem Header (weil Default wie Override wirkt).

**Codex Steps**
1. In `HierarchyPagingLoader`:
   - `resolvePageBytes(url, options?.pageBytes)` aufrufen (nur bei echtem Override übergeben).
2. `resolvePageBytes` Verhalten sicherstellen:
   - Override vorhanden → nutzen + cachen
   - Override nicht vorhanden → cached value nutzen oder Header lesen (`fetchRangeView` bevorzugt)
3. Unit-Test:
   - Header simulieren mit `pageBytes != DEFAULT_PAGE_BYTES`
   - Prüfen, dass ohne Override der Header-Wert verwendet wird

**Acceptance Criteria / DoD**
- Ohne Override wird `pageBytes` zuverlässig aus dem Header gelesen.
- Mit Override wird Header nicht gelesen und korrekt gecached.

---

## Epic 3 — PCT2 Loader: Kopien entfernen, Decoder hoisten

### Task 3.1 — `TextDecoder` nicht pro Name neu erstellen
**Problem:** `decodeName` erzeugt `new TextDecoder()` pro Call.

**Codex Steps**
1. In `io/Pct2TileLoader.ts`:
   - `const DECODER = new TextDecoder();` auf Module-Level
   - `decodeName` nutzt `DECODER.decode(...)`

**Acceptance Criteria / DoD**
- Kein `new TextDecoder()` mehr im Hotpath.

---

### Task 3.2 — `slice()` vermeiden (Views statt Copies) + sichere “rawBuffer drop” Strategie
**Problem:**
- Positions: `attribute.slice(...)` kopiert große Arrays.
- Colors: `rawColor.slice()` kopiert ebenfalls.

**Codex Steps**
1. Positions:
   - `slice(0, elementCount)` → `subarray(0, elementCount)` (View)
2. Colors:
   - `rawColor.slice()` → `rawColor.subarray(0, pointCount * 3)`
3. “rawBuffer drop” Policy definieren und korrekt machen:
   - Wenn Attributes Views auf `rawBuffer` sind, darf `rawBuffer` nicht gedropped werden, ohne vorher zu detach/copy.
4. Implementiere eine Strategie:
   - **Option A (simpel & sicher):** mandatory attrs (positions/colors) immer detach/copy, optional attrs views
   - **Option B (max perf):** mandatory views; beim Drop: `detachMandatoryAttributes(entry)`
5. Regression-Test:
   - Simuliere Drop und prüfe, dass Positions/Colors weiterhin korrekt sind (keine “use-after-drop”).

**Acceptance Criteria / DoD**
- Standard-Decoding macht keine unnötigen Full-Copies mehr.
- Kein Instability-Bug durch gedropten Buffer.

---

## Epic 4 — PCT2 Origin korrekt im Rendering anwenden (GPU-Translation)

### Task 4.1 — Tile-Origin per `modelMatrix` anwenden (statt CPU Adds)
**Problem:** PCT2 liefert `origin`, aber Positions werden nur mit `scale` decodiert. Ohne Translation liegen Tiles ggf. falsch oder überlagern sich.

**Codex Steps**
1. “Single source of truth” festlegen:
   - Positions bleiben **tile-local** (gut für Quantisierung/Precision)
   - `origin` wird pro Tile-Layer als Translation angewendet
2. In LayerFactory / `createPointCloudLayer`:
   - Erzeuge `modelMatrix` (Translation um `tile.origin`)
   - Setze `modelMatrix` in Layer Props
3. Hover/Selection/Measurement audit:
   - Stelle sicher: Weltposition = localPos + origin (genau einmal)
4. Visueller Test:
   - Zwei Tiles mit verschiedenen Origins dürfen sich nicht überlagern.

**Acceptance Criteria / DoD**
- Tiles liegen korrekt im World-Space.
- Hover/Selection/Messungen liefern korrekte Weltkoordinaten.

---

## Epic 5 — Delete/Filter Pipeline massiv beschleunigen

### Task 5.1 — Lazy Delete-Mask + keine `fill(1)`/Neuanlage pro Update
**Problem:** Bei Deletes werden pro Tile große Arrays neu erstellt/gefüllt; das ist O(N) und teuer.

**Codex Steps**
1. Pro `tileKey` einen State einführen:
   - `mask?: Uint8Array` (lazy)
   - `version: number`
2. Beim ersten Delete:
   - `mask = new Uint8Array(pointCount)`
   - einmal `mask.fill(1)`
3. Bei weiteren Deletes:
   - nur betroffene Indices auf 0 (in-place)
   - `version++`
4. Deck refresh:
   - Wenn Deck neues Ref braucht: neue View-Instanz auf gleicher Buffer-Basis erzeugen (keine Full-Copy).

**Acceptance Criteria / DoD**
- Keine wiederholten `new Uint8Array(pointCount)` + `fill(1)` bei jeder Löschaktion.
- Delete-Update skaliert mit Anzahl gelöschter Punkte, nicht mit tile size.

---

### Task 5.2 — JS-Accessor eliminieren: Filter als Binary Attribute (GPU Upload statt JS pro Punkt)
**Problem:** `getFilterValue: (point, info) => filterValues[info.index]` kostet extrem bei Millionen Punkten (JS pro Punkt).

**Codex Steps**
1. Data auf “binary attributes” umstellen:
   - `data = { length, attributes: { getPosition, getColor, getFilterValue } }`
2. `DataFilterExtension` korrekt konfigurieren:
   - `filterSize: 1`
   - `filterRange` passend (z. B. `[1, 1]` für keep)
3. Beim Mask-Update:
   - Trigger so setzen, dass Deck das Attribut neu hochlädt (ohne per-point Accessor)
4. Mini-Bench/Smoke-Test:
   - Delete auf großem Tile darf nicht mehrere Sekunden CPU blockieren.

**Acceptance Criteria / DoD**
- Filter-Updates verursachen keinen massiven JS CPU Spike durch per-point Accessors.
- FPS bleibt stabil bei großen Punktzahlen.

*(Optional später: Bitset + Custom Shader Extension für 8× weniger Mask-RAM. Das wäre ein separates Epic.)*

---

## Epic 6 — NodeSelector / LOD Hotpath entschlacken (Alloc/Sort reduzieren)

### Task 6.1 — `.slice().sort()` in Hotloops entfernen
**Problem:** `children.slice().sort(...)` in Node-Selection erzeugt Allocation + Sort pro Node.

**Codex Steps**
1. Alle Stellen mit `.slice().sort(...)` im Selector/Traversal finden.
2. Ersetzen durch:
   - a) Keine Sortierung (PriorityQueue regelt global)
   - b) Top-k selection ohne Full sort (bei 8 Kindern hand-rolled compare)
3. Determinismus sicherstellen:
   - Tie-breaker mit `nodeId`/`tileKey` (stabil)

**Acceptance Criteria / DoD**
- Keine `.slice().sort()` mehr im Render/LOD-Hotpath.
- Gleiches visuelles Ergebnis (oder bewusst dokumentierter Unterschied).

---

## Epic 7 — Tests, Guardrails & Performance-Schutz

### Task 7.1 — Regression Tests für kritische Bugs
**Codex Steps**
1. Tests für:
   - RangeFetch: `200` bei Range → wirft Error, wenn `allowFullFileFallback=false`
   - HierarchyPagingLoader: liest `pageBytes` aus Header ohne Override
   - PCT2 decode: keine unnötigen Copies (bzw. definierter detach-mode)
   - Origin: Tiles landen korrekt (Golden Test / deterministic check)
2. Tests als `vitest` (oder euer Setup) integrieren.

**Acceptance Criteria / DoD**
- Bugs können nicht mehr “still” reingeregressen.

---

### Task 7.2 — Micro-Bench Harness (Performance regressions sichtbar machen)
**Codex Steps**
1. Kleine Bench-Skripte für:
   - `fetchRangeView` single-window
   - `loadPage` 100×
   - Mask update + Deck attribute refresh (ohne full rebuild)
2. CI: “bench smoke” (nicht harte Grenzen, aber Warnungen/Output).

**Acceptance Criteria / DoD**
- Performance-Einbrüche werden früh sichtbar.

---

## Empfohlene Ausführungsreihenfolge (für Codex)

1. **Epic 0** (Build fix)  
2. **Epic 1** (Range Safety + Zero-copy)  
3. **Epic 2** (Hierarchy `pageBytes` Bug)  
4. **Epic 3–4** (PCT2 Loader + Origin)  
5. **Epic 5** (Delete/Filter Performance)  
6. **Epic 6** (NodeSelector Hotpath)  
7. **Epic 7** (Tests & Bench)

---

## Hinweise für Codex (Praktisch)

- Bei großen Daten ist **“Range muss 206 liefern”** ein Sicherheitsgurt.
- Jede `slice()`/Copy im Hotpath ist verdächtig.
- Favorisiere **Views**, **GPU-Attribute**, **in-place Updates**.
- Jede Änderung: erst correctness (Tests), dann perf.



# Codex-Tasks: Bugfixes & Performance-Optimierung (Gigantische Punktwolken)

Stand: 2025-12-27  
Quelle: Analyse basierend auf `_merged_source.txt` (zusammengeführter Code) sowie den Projekt-Dokumenten.

---

## Epic 0 — Build wieder grün machen (Merge-Artefakte entfernen)

### Task 0.1 — Spread/„Dot“-Syntaxfehler systematisch reparieren
**Problem:** In mehreren Files steht ein einzelnes `.` statt Spread `...` (z. B. `return { .state, ... }` / `return [ .baseLayers, ... ]`). Das kompiliert nicht.

**Codex Steps**
1. Repo-wide Suche nach Mustern:
   - `return { .`
   - `return [ .`
   - `, .state`
   - `, .action`
   - `patches: { .`
2. Ersetze korrekt:
   - `{ .state, x: y }` → `{ ...state, x: y }`
   - `{ .state.settings, .action.settings }` → `{ ...state.settings, ...action.settings }`
   - `[ .baseLayers, .patchLayers ]` → `[ ...baseLayers, ...patchLayers ]`
3. Danach `tsc`/`vite build` laufen lassen und **alle** resultierenden Syntax-/Typefehler fixen (es können weitere Copy/Paste-Artefakte auftauchen).

**Acceptance Criteria / DoD**
- TypeScript Build läuft fehlerfrei.
- Keine “Unexpected token .” / “Expression expected” mehr.

---

## Epic 1 — RangeFetch sicher & performant machen (keine GB-Fallbacks)

### Task 1.1 — Full-File-Fallback bei `200` für große Assets deaktivieren (Range muss `206` liefern)
**Problem:** `RangeFetch` cached bei `response.status === 200` (Server ignoriert Range) den kompletten Download als `isFullFile: true`. Bei gigantischen Container-Dateien ist das fatal.

**Codex Steps**
1. In `io/RangeFetch.ts` eine Option/Policy ergänzen:
   - z. B. `allowFullFileFallback?: boolean` (default: `false`)
   - oder `require206?: boolean` (default: `true` für Container/Hierarchie)
2. Implementiere in `fetchWindow`:
   - Wenn `response.status === 200` und `allowFullFileFallback !== true`:
     - **throw new Error** mit klarer Message:  
       `"Server does not support Range Requests (206)."`
   - Optional: Fallback nur erlauben, wenn Datei klein ist (z. B. `< 32MB`), sonst Error.
3. Option an alle relevanten Aufrufer durchreichen:
   - Hierarchy Header/Page Loads
   - Container Tile Loads
   - Alles, was potentiell sehr groß wird → `allowFullFileFallback: false`
4. DEV-Logging: Wenn `200` kommt, log `range unsupported` + URL + Hint.

**Acceptance Criteria / DoD**
- Container/Hierarchy Loads schlagen **hart** fehl, wenn Server keine Range-Requests unterstützt (statt still GBs zu ziehen).
- Kleine Demo-Dateien können optional weiterhin `200` nutzen (wenn bewusst erlaubt).

---

### Task 1.2 — Zero-Copy Fast Path für Range-Lesen (Views statt Kopien)
**Problem:** `fetchRange` erstellt immer `new Uint8Array(length)` und kopiert aus Window(s). Das ist teuer.

**Codex Steps**
1. Neue API ergänzen (zusätzlich zur bestehenden):
   - `fetchRangeView(url, start, length, signal?, options?) -> Uint8Array`
2. Implementierung:
   - Wenn gewünschter Range komplett in **einem** Window liegt:
     - `return new Uint8Array(windowEntry.buffer, inWindowOffset, length)` (**View**, keine Kopie)
   - Wenn Range über Windows geht:
     - fallback auf bisherigen Copy-Path.
3. Parser/Loader refactoren (Header/Page/Tile):
   - Akzeptiere `(buffer, byteOffset)` oder direkt `Uint8Array`.
4. `fetchRangeView` dort einsetzen, wo häufig gelesen wird:
   - Header lesen
   - Hierarchy Pages
   - Container Tile-Slices

**Acceptance Criteria / DoD**
- Häufige Reads laufen ohne Heap-Kopie (wenn in einem Window).
- Bestehende API `fetchRange` bleibt kompatibel.

---

## Epic 2 — HierarchyPagingLoader: `pageBytes` Bug fixen

### Task 2.1 — `resolvePageBytes` darf Default nicht als Override behandeln
**Problem:** `loadPage` übergibt `options?.pageBytes ?? DEFAULT_PAGE_BYTES` an `resolvePageBytes`. Wenn `options.pageBytes` **nicht** gesetzt ist, verhindert das das Lesen aus dem Header (weil Default wie Override wirkt).

**Codex Steps**
1. In `HierarchyPagingLoader`:
   - `resolvePageBytes(url, options?.pageBytes)` aufrufen (nur bei echtem Override übergeben).
2. `resolvePageBytes` Verhalten sicherstellen:
   - Override vorhanden → nutzen + cachen
   - Override nicht vorhanden → cached value nutzen oder Header lesen (`fetchRangeView` bevorzugt)
3. Unit-Test:
   - Header simulieren mit `pageBytes != DEFAULT_PAGE_BYTES`
   - Prüfen, dass ohne Override der Header-Wert verwendet wird

**Acceptance Criteria / DoD**
- Ohne Override wird `pageBytes` zuverlässig aus dem Header gelesen.
- Mit Override wird Header nicht gelesen und korrekt gecached.

---

## Epic 3 — PCT2 Loader: Kopien entfernen, Decoder hoisten

### Task 3.1 — `TextDecoder` nicht pro Name neu erstellen
**Problem:** `decodeName` erzeugt `new TextDecoder()` pro Call.

**Codex Steps**
1. In `io/Pct2TileLoader.ts`:
   - `const DECODER = new TextDecoder();` auf Module-Level
   - `decodeName` nutzt `DECODER.decode(...)`

**Acceptance Criteria / DoD**
- Kein `new TextDecoder()` mehr im Hotpath.

---

### Task 3.2 — `slice()` vermeiden (Views statt Copies) + sichere “rawBuffer drop” Strategie
**Problem:**
- Positions: `attribute.slice(...)` kopiert große Arrays.
- Colors: `rawColor.slice()` kopiert ebenfalls.

**Codex Steps**
1. Positions:
   - `slice(0, elementCount)` → `subarray(0, elementCount)` (View)
2. Colors:
   - `rawColor.slice()` → `rawColor.subarray(0, pointCount * 3)`
3. “rawBuffer drop” Policy definieren und korrekt machen:
   - Wenn Attributes Views auf `rawBuffer` sind, darf `rawBuffer` nicht gedropped werden, ohne vorher zu detach/copy.
4. Implementiere eine Strategie:
   - **Option A (simpel & sicher):** mandatory attrs (positions/colors) immer detach/copy, optional attrs views
   - **Option B (max perf):** mandatory views; beim Drop: `detachMandatoryAttributes(entry)`
5. Regression-Test:
   - Simuliere Drop und prüfe, dass Positions/Colors weiterhin korrekt sind (keine “use-after-drop”).

**Acceptance Criteria / DoD**
- Standard-Decoding macht keine unnötigen Full-Copies mehr.
- Kein Instability-Bug durch gedropten Buffer.

---

## Epic 4 — PCT2 Origin korrekt im Rendering anwenden (GPU-Translation)

### Task 4.1 — Tile-Origin per `modelMatrix` anwenden (statt CPU Adds)
**Problem:** PCT2 liefert `origin`, aber Positions werden nur mit `scale` decodiert. Ohne Translation liegen Tiles ggf. falsch oder überlagern sich.

**Codex Steps**
1. “Single source of truth” festlegen:
   - Positions bleiben **tile-local** (gut für Quantisierung/Precision)
   - `origin` wird pro Tile-Layer als Translation angewendet
2. In LayerFactory / `createPointCloudLayer`:
   - Erzeuge `modelMatrix` (Translation um `tile.origin`)
   - Setze `modelMatrix` in Layer Props
3. Hover/Selection/Measurement audit:
   - Stelle sicher: Weltposition = localPos + origin (genau einmal)
4. Visueller Test:
   - Zwei Tiles mit verschiedenen Origins dürfen sich nicht überlagern.

**Acceptance Criteria / DoD**
- Tiles liegen korrekt im World-Space.
- Hover/Selection/Messungen liefern korrekte Weltkoordinaten.

---

## Epic 5 — Delete/Filter Pipeline massiv beschleunigen

### Task 5.1 — Lazy Delete-Mask + keine `fill(1)`/Neuanlage pro Update
**Problem:** Bei Deletes werden pro Tile große Arrays neu erstellt/gefüllt; das ist O(N) und teuer.

**Codex Steps**
1. Pro `tileKey` einen State einführen:
   - `mask?: Uint8Array` (lazy)
   - `version: number`
2. Beim ersten Delete:
   - `mask = new Uint8Array(pointCount)`
   - einmal `mask.fill(1)`
3. Bei weiteren Deletes:
   - nur betroffene Indices auf 0 (in-place)
   - `version++`
4. Deck refresh:
   - Wenn Deck neues Ref braucht: neue View-Instanz auf gleicher Buffer-Basis erzeugen (keine Full-Copy).

**Acceptance Criteria / DoD**
- Keine wiederholten `new Uint8Array(pointCount)` + `fill(1)` bei jeder Löschaktion.
- Delete-Update skaliert mit Anzahl gelöschter Punkte, nicht mit tile size.

---

### Task 5.2 — JS-Accessor eliminieren: Filter als Binary Attribute (GPU Upload statt JS pro Punkt)
**Problem:** `getFilterValue: (point, info) => filterValues[info.index]` kostet extrem bei Millionen Punkten (JS pro Punkt).

**Codex Steps**
1. Data auf “binary attributes” umstellen:
   - `data = { length, attributes: { getPosition, getColor, getFilterValue } }`
2. `DataFilterExtension` korrekt konfigurieren:
   - `filterSize: 1`
   - `filterRange` passend (z. B. `[1, 1]` für keep)
3. Beim Mask-Update:
   - Trigger so setzen, dass Deck das Attribut neu hochlädt (ohne per-point Accessor)
4. Mini-Bench/Smoke-Test:
   - Delete auf großem Tile darf nicht mehrere Sekunden CPU blockieren.

**Acceptance Criteria / DoD**
- Filter-Updates verursachen keinen massiven JS CPU Spike durch per-point Accessors.
- FPS bleibt stabil bei großen Punktzahlen.

*(Optional später: Bitset + Custom Shader Extension für 8× weniger Mask-RAM. Das wäre ein separates Epic.)*

---

## Epic 6 — NodeSelector / LOD Hotpath entschlacken (Alloc/Sort reduzieren)

### Task 6.1 — `.slice().sort()` in Hotloops entfernen
**Problem:** `children.slice().sort(...)` in Node-Selection erzeugt Allocation + Sort pro Node.

**Codex Steps**
1. Alle Stellen mit `.slice().sort(...)` im Selector/Traversal finden.
2. Ersetzen durch:
   - a) Keine Sortierung (PriorityQueue regelt global)
   - b) Top-k selection ohne Full sort (bei 8 Kindern hand-rolled compare)
3. Determinismus sicherstellen:
   - Tie-breaker mit `nodeId`/`tileKey` (stabil)

**Acceptance Criteria / DoD**
- Keine `.slice().sort()` mehr im Render/LOD-Hotpath.
- Gleiches visuelles Ergebnis (oder bewusst dokumentierter Unterschied).

---

## Epic 7 — Tests, Guardrails & Performance-Schutz

### Task 7.1 — Regression Tests für kritische Bugs
**Codex Steps**
1. Tests für:
   - RangeFetch: `200` bei Range → wirft Error, wenn `allowFullFileFallback=false`
   - HierarchyPagingLoader: liest `pageBytes` aus Header ohne Override
   - PCT2 decode: keine unnötigen Copies (bzw. definierter detach-mode)
   - Origin: Tiles landen korrekt (Golden Test / deterministic check)
2. Tests als `vitest` (oder euer Setup) integrieren.

**Acceptance Criteria / DoD**
- Bugs können nicht mehr “still” reingeregressen.

---

### Task 7.2 — Micro-Bench Harness (Performance regressions sichtbar machen)
**Codex Steps**
1. Kleine Bench-Skripte für:
   - `fetchRangeView` single-window
   - `loadPage` 100×
   - Mask update + Deck attribute refresh (ohne full rebuild)
2. CI: “bench smoke” (nicht harte Grenzen, aber Warnungen/Output).

**Acceptance Criteria / DoD**
- Performance-Einbrüche werden früh sichtbar.

---

## Empfohlene Ausführungsreihenfolge (für Codex)

1. **Epic 0** (Build fix)  
2. **Epic 1** (Range Safety + Zero-copy)  
3. **Epic 2** (Hierarchy `pageBytes` Bug)  
4. **Epic 3–4** (PCT2 Loader + Origin)  
5. **Epic 5** (Delete/Filter Performance)  
6. **Epic 6** (NodeSelector Hotpath)  
7. **Epic 7** (Tests & Bench)

---

## Hinweise für Codex (Praktisch)

- Bei großen Daten ist **“Range muss 206 liefern”** ein Sicherheitsgurt.
- Jede `slice()`/Copy im Hotpath ist verdächtig.
- Favorisiere **Views**, **GPU-Attribute**, **in-place Updates**.
- Jede Änderung: erst correctness (Tests), dann perf.


---

## Epic 6 — Delete Selection darf nicht das ganze Tile „wegfiltern“

### Hintergrund / Root Cause
Im Code existieren **zwei widersprüchliche Bedeutungen** der Delete-Mask:

- Variante A: `mask[i] === 1` bedeutet **deleted** (dann wird später zu „keep=1“ invertiert)
- Variante B: `mask[i] === 1` bedeutet **keep/visible** (deleted = 0) und wird **direkt** als `filterValues` genutzt

Wenn beide Varianten gleichzeitig im Code aktiv sind (z. B. `applyDeleteItems` setzt *keep=1, delete=0*, aber `filterValuesByTileKey` interpretiert *1=deleted* und invertiert), dann wird beim ersten Delete nahezu jedes `filterValue` auf 0 gesetzt → **das komplette Tile wird ausgeblendet**.

---

### Task 6.1 — Semantik der Delete-Mask global festlegen (Single Source of Truth)
**Entscheidung (empfohlen):** `visibilityMask` pro Tile:
- `1 = sichtbar / keep`
- `0 = gelöscht / hidden`

**Codex Steps**
1. Repo-wide Suche nach allen Stellen, die `patches.deleted` / `deletedMask` / `filterValuesByTileKey` verwenden.
2. Benenne intern (oder via Kommentar + Typalias) eindeutig:
   - `deleted` → `visibilityMaskByTileKey` (oder `filterMaskByTileKey`)
3. Passe alle Stellen an die Semantik an:
   - **Delete** setzt Index auf `0`
   - **Default** ist `1` (sichtbar)

**Acceptance Criteria / DoD**
- Es gibt nur noch **eine** Semantik.
- Kein Codepfad invertiert die Mask ungeplant.

---

### Task 6.2 — `filterValuesByTileKey` entfernen (O(N) pro Tile) und Maske direkt an deck.gl geben
**Problem:** Der `filterValuesByTileKey`-UseMemo erzeugt pro Patch-Update neue `Uint8Array(pointCount)` und läuft O(N) pro Tile — für große Tiles extrem teuer.

**Codex Steps**
1. Entferne `filterValuesByTileKey` komplett.
2. In `Viewer.tsx` / BaseLayer-Builder:
   - `const filterValues = patches.deleted.get(layerKey)` (wobei das jetzt `visibilityMask` ist)
   - `const filterVersion = patches.deletedVersions.get(layerKey)` (siehe Task 6.3)
3. Stelle sicher, dass der Key identisch ist:
   - immer `layerKey = keyFromTile(tile)` verwenden.
4. Passe Debug/Sidebar “Deleted Points” an:
   - DeletedCount = Summe der **0**-Werte (oder `pointCount - sum(mask)`).

**Acceptance Criteria / DoD**
- Beim Delete verschwindet **nur** der selektierte Punkt.
- Kein per-render “invert copy” großer Arrays mehr.

---

### Task 6.3 — DeckGL-Update robust machen, ohne JS-per-Point Accessor
**Problem:** `getFilterValue: (_d, info) => ...` ist ein JS-Accessor und skaliert schlecht bei Millionen Punkten.

**Codex Steps**
1. In `PointCloudLayerFactory.ts`:
   - Entferne den JS-Accessor `getFilterValue: ...` vollständig.
   - Nutze ausschließlich das Binary-Attribute:
     - `attributes.getFilterValue = { value: filterValues, size: 1 }`
   - `DataFilterExtension({ filterSize: 1 })` bleibt.
   - `filterRange` so lassen, dass `1` sichtbar ist (z. B. `[0.5, 1.5]`).
2. Für In-Place Mask Updates:
   - Führe `deletedVersions: Map<string, number>` in `PatchState` ein (falls nicht vorhanden).
   - Bei jeder Änderung an einer Tile-Maske: `version++`.
   - Übergib `filterVersion` an `createPointCloudLayer`.
3. Stelle sicher, dass ein Versions-Change Deck zwingt, das Attribut neu hochzuladen:
   - Falls Deck bei unverändertem TypedArray-Ref nicht updatet: bei Update zusätzlich eine neue View-Instanz setzen:
     - `const view = new Uint8Array(mask.buffer, mask.byteOffset, mask.byteLength);`
     - Map setzt `view` (O(1), keine Kopie)

**Acceptance Criteria / DoD**
- Keine JS-per-point Filter-Berechnung mehr.
- Mask-Änderungen werden zuverlässig im Rendering sichtbar (auch bei In-Place Updates).

---

### Task 6.4 — `applyDeleteItems` korrekt & effizient implementieren (lazy init + multi-delete)
**Codex Steps**
1. In `applyDeleteItems`:
   - Hole `mask = nextMasks.get(tileKey)` (tileKey/layerKey, nicht nodeKey-mix).
   - Wenn `!mask || mask.length !== tile.pointCount`:
     - `mask = new Uint8Array(tile.pointCount); mask.fill(1);`
   - Für jeden zu löschenden Index: `mask[index] = 0`
   - Speichere aktualisierte Maske (ggf. als View) + bump version.
2. Optional: Duplikate in `items` deduplizieren (`tileKey:index`), um doppeltes Arbeiten zu vermeiden.

**Acceptance Criteria / DoD**
- Delete von 1 Punkt macht O(1) Work + O(Upload) ohne O(N)-CPU-Schleifen.
- Mehrfach-Deletes in einem Tile werden korrekt zusammengeführt.

---

### Task 6.5 — Regression-Tests & Debug-Guards für Mask-Semantik
**Codex Steps**
1. Füge eine kleine pure Funktion ein (testbar ohne Deck):
   - `applyDeletesToVisibilityMask(mask, pointCount, indices) -> {mask, deletedCountDelta}`
2. Unit-Tests (vitest):
   - Init: pointCount=10, keine Maske → after delete(3) genau 1 Punkt hidden
   - Multi-delete: delete(3,7) → 2 hidden
   - Reinit bei pointCount-change
3. Debug-Guard (nur debugEnabled):
   - Wenn eine Maske existiert und `mask.every(v=>v===0)` aber `deletedCount << pointCount`, warn log:
     - “visibilityMask all zeros – semantics mismatch?”

**Acceptance Criteria / DoD**
- Der “Tile verschwindet” Bug ist reproduzierbar als Test und danach fixed.
- Debug gibt klare Hinweise, falls Semantik erneut kippt.

---


# Codex Tasks – Fix “Delete hides entire tile” + Stabilize GPU filtering

Context: Nach `Delete Selection` verschwindet aktuell oft **das komplette Tile**. Nach schnellem Zoom/Pan/Rotation taucht es wieder auf. Das deutet stark darauf hin, dass die **GPU-Filter-Attribute (DataFilterExtension)** entweder
- nicht korrekt mit `getFilterValue` verbunden sind, oder
- nicht zuverlässig invalidiert / neu auf die GPU hochgeladen werden (z.B. weil derselbe `Uint8Array` in-place mutiert wird und deck.gl keinen Update-Trigger sieht).

Die Codebasis enthält außerdem mehrere (teilweise veraltete) Delete-Pfade (z.B. `filterValuesByTileKey` + alte Semantik), die widersprüchliche Masken-Semantik erzeugen können.

---

## Zielzustand (Definition)

**Visibility-Mask Semantik (KANONISCH):**
- `mask[i] === 1` → Punkt **sichtbar**
- `mask[i] === 0` → Punkt **gelöscht / unsichtbar**

Rendering:
- `DataFilterExtension(filterSize: 1)`
- `filterRange = [0.5, 1.5]` (zeigt nur Werte 1)
- `attributes.getFilterValue.value = mask` (binary attribute)
- **zusätzlich** `getFilterValue`-Prop am Layer setzen (damit die Extension sicher “verdrahtet” ist)
- Änderungen müssen **sofort** sichtbar sein, ohne dass Interaktion (Zoom/Pan) nötig ist.

---

## Task 1 — PointCloudLayerFactory: getFilterValue “verdrahten” (Bugfix mit höchster Priorität)

**Problem:** In einer Version von `layers/PointCloudLayerFactory.ts` ist `getFilterValue` als Layer-Prop entfernt, obwohl `attributes.getFilterValue` gesetzt wird. Dann kann die DataFilterExtension je nach deck.gl-Interna die Filterwerte nicht korrekt verwenden → Tile wird komplett gefiltert/verschwindet.

### Schritte
1. Öffne `layers/PointCloudLayerFactory.ts`.
2. Stelle sicher, dass **gleichzeitig** unterstützt werden:
   - `modelMatrix` (für `tile.origin`)
   - `filterValues` (binary attr `getFilterValue`)
   - `filterVersion` (Update-Trigger)
   - **`getFilterValue`-Prop** auf dem Layer (siehe unten)

3. Implementiere/rekonstruiere im Return von `new PointCloudLayer(...)`:

- `getFilterValue: filterValues ? (_d, info) => filterValues[info.index] ?? 1 : undefined`
- `filterEnabled: Boolean(filterValues)`
- `filterRange: filterValues ? [0.5, 1.5] : undefined`
- `extensions: filterValues ? [new DataFilterExtension({ filterSize: 1 })] : []`
- `updateTriggers: filterValues ? { getFilterValue: (options.filterVersion ?? filterValues) } : undefined`

> Wichtig: Wir behalten das Binary-Attribut `attributes.getFilterValue.value = filterValues`, damit KEIN CPU-Loop pro Punkt entsteht. Der `getFilterValue`-Prop dient primär als “Contract” für deck.gl, damit die Extension das Attribut eindeutig erkennt.

### Akzeptanzkriterien
- `Delete Selection` blendet **nur** die selektierten Punkte aus.
- Das Tile verschwindet nicht komplett.
- Kein “kommt erst nach Zoom/Pan wieder”.

---

## Task 2 — Viewer Delete-Pipeline konsolidieren (nur ein Delete-Pfad)

**Problem:** In `_merged_source.txt` existieren mehrere alte Varianten (z.B. `filterValuesByTileKey` + invertierte Semantik). Das ist extrem fehleranfällig.

### Schritte
1. In `viewer/Viewer.tsx`:
   - Entferne dauerhaft den alten Pfad `filterValuesByTileKey` (falls im Projekt noch vorhanden).
   - In `baseLayers` nur noch:
     - `const filterValues = patches.deleted.get(layerKey);`
     - `const filterVersion = patches.deletedVersions.get(layerKey);`
2. Stelle sicher, dass `applyDeleteItems(...)` ausschließlich die Visibility-Mask nutzt:
   - Nutzung von `applyDeletesToVisibilityMask(...)`
   - `nextDeleted.set(tileKey, mask);`
   - `nextVersions.set(tileKey, (prev ?? 0) + 1);`

### Akzeptanzkriterien
- Es gibt **keine** zweite/alte Stelle mehr, die Filterwerte invertiert oder neu generiert.
- Die Masken-Semantik ist überall gleich (1 sichtbar, 0 gelöscht).

---

## Task 3 — Sichere “GPU Update” Semantik: Mask-Updates müssen deck.gl erreichen

**Problem:** `applyDeletesToVisibilityMask` mutiert bestehende `Uint8Array` ggf. in-place. Selbst mit `updateTriggers` kann es passieren, dass deck.gl den Buffer nicht neu hochlädt (abhängig von interner Change Detection).

### Schritte (robust, O(1), ohne Copy)
1. In `applyDeleteItems(...)` (oder direkt in `applyDeletesToVisibilityMask(...)`), wenn `deletedDelta > 0`:
   - Erzeuge **einen neuen View** auf denselben Buffer, um die **Objektidentität** zu ändern:
     - `const view = new Uint8Array(mask.buffer, mask.byteOffset, mask.byteLength);`
   - Speichere `view` in `nextDeleted` statt `mask`.

2. Behalte zusätzlich `deletedVersions` bei (doppelte Absicherung).

### Akzeptanzkriterien
- Ein Delete führt **immer** sofort zu einem sichtbaren Update.
- Keine Abhängigkeit von ViewState-Änderungen.

---

## Task 4 — Reducer/Types: set-deleted-masks muss deletedVersions sicher speichern

**Problem:** Es gab/ gibt Varianten, wo der Reducer `deletedVersions` ignoriert. Dann fehlen Update-Triggers und Effekte treten “nur nach Interaktion” auf.

### Schritte
1. In `state/store.tsx`:
   - Stelle sicher, dass `AppAction` für `set-deleted-masks` **beide** Maps enthält:
     - `deleted: Map<string, Uint8Array>`
     - `deletedVersions: Map<string, number>`
2. Im Reducer case `"set-deleted-masks"`:
   - setze **beide**: `state.patches.deleted` und `state.patches.deletedVersions`
3. Initial State (`defaultPatchState`) muss `deletedVersions: new Map()` enthalten.

### Akzeptanzkriterien
- `filterVersion` ist für betroffene Tiles immer definiert/inkrementiert.
- UI reagiert ohne Interaktions-“Workaround”.

---

## Task 5 — Tests: Regression-Test für “Tile verschwindet komplett”

### Unit Tests
1. `utils/visibilityMask.test.ts` (existiert) erweitern:
   - Test: bei initialer Maske + delete eines Index bleibt Mehrheit `1`.

2. `layers/PointCloudLayerFactory.test.ts` erweitern:
   - Wenn `filterValues` gesetzt:
     - `layer.props.getFilterValue` existiert und liefert für `info.index` korrekt 0/1
     - `layer.props.filterEnabled === true`
     - `layer.props.filterRange === [0.5, 1.5]`
     - `layer.props.extensions` enthält `DataFilterExtension`

### Akzeptanzkriterien
- Tests schlagen fehl, wenn `getFilterValue` versehentlich wieder entfernt wird.
- Tests schlagen fehl, wenn `filterRange` oder Semantik bricht.

---

## Task 6 — Performance: Remove “Array.from(entry.indices)” (vermeidet unnötige Allokationen)

**Problem:** `Array.from(entry.indices)` allokiert ein Array und kopiert Indizes. Bei großen Selektionen unnötig.

### Schritte
1. Ändere `applyDeletesToVisibilityMask` Signatur:
   - `indices: Iterable<number>` statt `number[]`
2. Iteriere per `for (const index of indices) { ... }`
3. In `applyDeleteItems`:
   - übergib `entry.indices` direkt.

### Akzeptanzkriterien
- Keine `Array.from(...)` mehr in der Delete-Pipeline.
- Funktional identisch.

---

## Task 7 — Debugging: schnelle Diagnose bei “Mask all zeros”

**Ziel:** Wenn ein Tile komplett verschwindet, wollen wir sofort sehen, ob die Maske fälschlich alles auf 0 gesetzt hat oder ob Filterwerte nicht in der GPU ankommen.

### Schritte
1. In `applyDeleteItems`, wenn `settings.debugEnabled`:
   - logge bei `deletedDelta > 0`:
     - `tileKey`, `pointCount`, `deletedDelta`, `deletedCount`
     - optional: `mask[0]`, `mask[someIndex]`, `mask[last]`
2. Optional: in `PointCloudLayerFactory` bei `filterValues`:
   - in Debug-Mode prüfen, ob `attributes.getFilterValue.value.length === tile.pointCount`.

### Akzeptanzkriterien
- Debug-Logs erlauben binnen Sekunden zu entscheiden:
  - “Maske falsch” vs “GPU-Upload/Layer-Wiring falsch”.

---

## Task 8 — Cleanup: Duplicate/Legacy Dateien entfernen

**Problem:** `_merged_source.txt` zeigt mehrfach vorhandene/duplizierte Implementationen (mehrere `PointCloudLayerFactory.ts` Varianten).

### Schritte
1. Finde doppelte/obsolete Implementationen:
   - `layers/PointCloudLayerFactory.ts` (ohne `getFilterValue`) vs (mit `getFilterValue`)
   - alte Viewer-Delete-Pfade (`filterValuesByTileKey`)
2. Entferne/vereinheitliche auf genau **eine** Quelle pro Modul.
3. Stelle sicher, dass alle Imports auf die kanonische Datei zeigen.

### Akzeptanzkriterien
- Es gibt im Repo nur **eine** `createPointCloudLayer` Implementierung.
- Keine alten `filterValuesByTileKey` oder invertierte Maskenlogik mehr.

---

## Quick sanity checklist (nach Implementation)

- [ ] Delete eines einzelnen Punkts blendet nur diesen Punkt aus.
- [ ] Tile bleibt sichtbar.
- [ ] Kein “kommt nach Pan/Zoom wieder”.
- [ ] `deletedVersions` steigt pro Tile bei Deletes.
- [ ] Keine Vollkopien großer Masken (O(n)) pro Delete.
