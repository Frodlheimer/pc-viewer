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

