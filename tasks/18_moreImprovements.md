# Verbesserungen Punkt für Punkt (mit Dateinamen + Code)


## 1) Hierarchie-Paging korrekt laden (nicht nur Page 0)

Aktuell lädt der Viewer bei `hierarchyUrl` **nur Seite 0** und bricht dann ab.  
Das führt dazu, dass Selektion/Prefetching nur einen Teilbaum “kennt”.

### 1a) `io/HierarchyPagingLoader.ts` – AbortSignal durchreichen + `loadAllPages` hinzufügen

Der Loader nutzt derzeit `fetchRangeView` ohne `signal`.

**Änderungen:**
- `LoadPageOptions` um `signal?: AbortSignal` erweitern
- `signal` an `fetchRangeView(...)` durchreichen
- Neue Funktion `loadAllPages(...)` hinzufügen (lädt alle Pages anhand `getKnownTotalSize()`; fallback: bis `recordCount===0` oder `maxPages`)

```ts
// io/HierarchyPagingLoader.ts
import { fetchRangeView, getKnownTotalSize } from "./RangeFetch";
import type { NodeRecord, Page } from "./types/Hierarchy";

// ...

type LoadPageOptions = {
  maxPages?: number;
  pageBytes?: number;
  signal?: AbortSignal;
};

const resolvePageBytes = async (
  url: string,
  pageBytesOverride?: number,
  signal?: AbortSignal
): Promise<number> => {
  if (pageBytesOverride) {
    pageBytesByUrl.set(url, pageBytesOverride);
    return pageBytesOverride;
  }
  const cached = pageBytesByUrl.get(url);
  if (cached) {
    return cached;
  }

  const header = await fetchRangeView(url, 0, PAGE_HEADER_BYTES, signal, {
    allowFullFileFallback: false,
  });
  const parsed = parseHeader(header);
  pageBytesByUrl.set(url, parsed.pageBytes);
  return parsed.pageBytes;
};

export const loadPage = async (
  url: string,
  pageIndex: number,
  options?: LoadPageOptions
): Promise<Page> => {
  const pageBytes = await resolvePageBytes(url, options?.pageBytes, options?.signal);

  const key = getCacheKey(url, pageIndex);
  const cached = pageCache.get(key);
  if (cached) {
    touchCache(key, cached);
    return cached;
  }

  const start = pageIndex * pageBytes;
  const buffer = await fetchRangeView(url, start, pageBytes, options?.signal, {
    allowFullFileFallback: false,
  });

  const header = parseHeader(buffer);
  const page: Page = {
    pageIndex: header.pageIndex,
    pageBytes: header.pageBytes,
    recordCount: header.recordCount,
    records: parseRecords(buffer, header.recordCount),
  };

  touchCache(key, page);
  return page;
};

export type LoadAllPagesResult = {
  pageBytes: number;
  pages: Page[];
  records: NodeRecord[];
};

export const loadAllPages = async (
  url: string,
  options?: { pageBytes?: number; maxPages?: number; signal?: AbortSignal }
): Promise<LoadAllPagesResult> => {
  const first = await loadPage(url, 0, {
    pageBytes: options?.pageBytes,
    signal: options?.signal,
  });

  const pageBytes = first.pageBytes;
  const totalSize = getKnownTotalSize(url);
  const pageCountFromSize =
    totalSize !== null ? Math.ceil(totalSize / pageBytes) : null;

  const hardMax = options?.maxPages ?? 4096;
  const targetPages =
    pageCountFromSize !== null ? Math.min(pageCountFromSize, hardMax) : hardMax;

  const pages: Page[] = [first];

  for (let i = 1; i < targetPages; i += 1) {
    const page = await loadPage(url, i, { pageBytes, signal: options?.signal });
    if (page.recordCount === 0) break;
    pages.push(page);
  }

  return {
    pageBytes,
    pages,
    records: pages.flatMap((p) => p.records),
  };
};
```

### 1b) `viewer/Viewer.tsx` – statt `hierarchyPage` künftig `hierarchyNodes` verwenden

Der Viewer hängt aktuell überall an `hierarchyPage.records` (Index + Selektion).  
Du ersetzt das durch ein “flattened” Array aller Records.

**Änderungen:**
1) State-Typ ändern (Page → Nodes)  
2) Beim Manifest-Load: `loadAllPages` verwenden  
3) Alle Stellen `hierarchyPage` → `hierarchyNodes` anpassen  

Beispiel-Patch (die Blöcke ersetzen):

```ts
// viewer/Viewer.tsx
import { loadAllPages } from "../io/HierarchyPagingLoader";
import { selectNodes, type HierarchyIndex } from "../io/NodeSelector"; // (siehe Punkt 2)

// ...

type HierarchyState = {
  datasetId: string;
  nodes: NodeRecord[];
  pagesLoaded: number;
  pageBytes: number;
};

const [hierarchyState, setHierarchyState] = useState<HierarchyState | null>(null);

const hierarchyNodes =
  hierarchyState?.datasetId === activeDatasetId ? hierarchyState.nodes : null;

// ...

useEffect(() => {
  let cancelled = false;
  const controller = new AbortController();

  const run = async () => {
    // ... loadManifest etc.

    if (loadedManifest.hierarchyUrl) {
      const { pages, records, pageBytes } = await loadAllPages(
        loadedManifest.hierarchyUrl,
        {
          pageBytes: loadedManifest.hierarchyPageBytes,
          signal: controller.signal,
        }
      );

      if (cancelled) return;

      setHierarchyState({
        datasetId: activeDatasetId,
        nodes: records,
        pagesLoaded: pages.length,
        pageBytes,
      });

      return; // keep existing behavior: don’t eager-load renderData for hierarchy datasets
    }

    // ... existing non-hierarchy path
  };

  run().catch((e) => {
    if (!cancelled) console.error(e);
  });

  return () => {
    cancelled = true;
    controller.abort();
  };
}, [activeDatasetId]);

// --- hierarchy index building:
const hierarchyIndexRef = useRef<HierarchyIndex | null>(null);

useEffect(() => {
  if (!hierarchyNodes) {
    hierarchyIndexRef.current = null;
    return;
  }
  hierarchyIndexRef.current = buildHierarchyIndex(hierarchyNodes);
}, [hierarchyNodes]);

// --- selection effect:
useEffect(() => {
  if (!manifest || !manifest.hierarchyUrl || !hierarchyNodes) return;

  const { selected, diagnostics } = selectNodes({
    nodes: hierarchyNodes,
    hierarchyIndex: hierarchyIndexRef.current ?? undefined,
    viewState,
    runtimeBudgets,
    previousSelection: previousSelectionRef.current,
    keepCoarseNodes: true,
  });

  // ... existing “selectedTilesRef.current = selected;”
}, [manifest, hierarchyNodes, viewState, runtimeBudgets]);
```

Und `buildHierarchyIndex` solltest du so erweitern, dass er auch `roots` liefert (wird in Punkt 2 benutzt):

```ts
// viewer/Viewer.tsx (oder besser: siehe Punkt 2 in NodeSelector exportieren)
const buildHierarchyIndex = (nodes: NodeRecord[]): HierarchyIndex => {
  const nodeById = new Map<string, NodeRecord>();
  nodes.forEach((node) => nodeById.set(keyFromNodeId(node.nodeId), node));

  const childrenByParent = new Map<string, NodeRecord[]>();
  nodes.forEach((node) => {
    const parentKey = keyFromNodeId(node.parentId);
    const list = childrenByParent.get(parentKey);
    if (list) list.push(node);
    else childrenByParent.set(parentKey, [node]);
  });

  const roots = nodes.filter((node) => {
    const key = keyFromNodeId(node.nodeId);
    const parentKey = keyFromNodeId(node.parentId);
    return key === parentKey || !nodeById.has(parentKey);
  });

  return { nodeById, childrenByParent, roots };
};
```

---

## 2) NodeSelector: Index wiederverwenden (nicht jedes Mal Maps neu bauen)

Der Selector baut derzeit jedes Mal `nodeById`/`childrenByParent` neu.  
Der Viewer baut aber ohnehin einen Index (für Prefetching). Ziel: **einmal bauen, überall nutzen**.

### `io/NodeSelector.ts` ändern

- `export type HierarchyIndex` hinzufügen
- `NodeSelectionInput` um `hierarchyIndex?: HierarchyIndex` ergänzen
- Wenn Index vorhanden: keine Maps neu erzeugen

```ts
// io/NodeSelector.ts
export type HierarchyIndex = {
  nodeById: Map<string, NodeRecord>;
  childrenByParent: Map<string, NodeRecord[]>;
  roots: NodeRecord[];
};

export type NodeSelectionInput = {
  nodes: NodeRecord[];
  hierarchyIndex?: HierarchyIndex;
  // ... rest unchanged
};

export const selectNodes = (input: NodeSelectionInput): NodeSelectionOutput => {
  const nodes = input.nodes;

  let nodeById: Map<string, NodeRecord>;
  let childrenByParent: Map<string, NodeRecord[]>;
  let roots: NodeRecord[];

  if (input.hierarchyIndex) {
    nodeById = input.hierarchyIndex.nodeById;
    childrenByParent = input.hierarchyIndex.childrenByParent;
    roots = input.hierarchyIndex.roots;
  } else {
    nodeById = new Map<string, NodeRecord>();
    nodes.forEach((node) => nodeById.set(keyFromNodeId(node.nodeId), node));

    childrenByParent = new Map<string, NodeRecord[]>();
    nodes.forEach((node) => {
      const parentKey = keyFromNodeId(node.parentId);
      const list = childrenByParent.get(parentKey);
      if (list) list.push(node);
      else childrenByParent.set(parentKey, [node]);
    });

    roots = nodes.filter((node) => {
      const key = keyFromNodeId(node.nodeId);
      const parentKey = keyFromNodeId(node.parentId);
      return key === parentKey || !nodeById.has(parentKey);
    });
  }

  // ... ab hier: deine bestehende Logik weiterverwenden, aber roots/nodeById/childrenByParent nutzen
};
```

---

## 3) Tile-Container: RangeFetch-“Window”-Buffer nicht in den TileCache pinnen

`loadTileBufferFromContainer` gibt aktuell das `Uint8Array` direkt zurück.  
Wenn das `Uint8Array` ein View in einen **16MB RangeFetch-Window-Buffer** ist, hält der TileCache diese 16MB u.U. unnötig am Leben und rechnet ungünstig.

### `io/TileContainerLoader.ts` – beim Return kopieren

```ts
// io/TileContainerLoader.ts
const buffer = await fetchRangeView(containerUrl, offset, length, signal, {
  allowFullFileFallback: false,
});

// NEU: Kopie mit eigenem ArrayBuffer (nur "length" Bytes)
return buffer.slice();
```

Das ist eine 1-Zeilen-Änderung, aber wirkt oft extrem gut gegen “mysteriöses” RAM-Wachstum.

---

## 4) LoadScheduler: nicht während `forEach` aus dem Set löschen

`cancelNotDesired` löscht während der Iteration aus `inFlight` (Set) heraus.  
Das kann Elemente überspringen.

### `io/LoadScheduler.ts` – 2-Phasen Cancel

```ts
// io/LoadScheduler.ts
private cancelNotDesired() {
  const toCancel: string[] = [];
  for (const key of this.inFlight) {
    if (!this.allowedKeys.has(key)) {
      toCancel.push(key);
    }
  }

  toCancel.forEach((key) => {
    this.tileService.cancelTile(key);
    this.inFlight.delete(key);
  });
}
```

---

## 5) PCT2: Zstd (und/oder generell “codec != None”) sauber behandeln

Aktuell wird **alles außer `CodecEnum.None` hart abgelehnt**.  
Wenn du Compressed Attributes willst, musst du hier ansetzen.

### 5a) Dependency hinzufügen

Ich würde für Zstd **fzstd** nehmen (sync `decompress`, Browser-tauglich).  
→ `package.json`: `fzstd` hinzufügen (z.B. `npm i fzstd`)

### 5b) `io/Pct2TileLoader.ts` – Codec nicht sofort throwen, sondern im Decoder behandeln

Oben:

```ts
import * as fzstd from "fzstd";
```

Im Directory-Parsing: ersetze den Block

```ts
if (codec !== CodecEnum.None) {
  throw new Error(`PCT2 codec ${codec} not supported.`);
}
```

durch:

```ts
if (
  codec !== CodecEnum.None &&
  codec !== CodecEnum.Zstd &&
  codec !== CodecEnum.Lz4
) {
  throw new Error(`PCT2 unknown codec (${codec}).`);
}

if (codec === CodecEnum.None) {
  if (uncompressedByteLength !== 0 && uncompressedByteLength !== byteLength) {
    throw new Error("PCT2 uncompressed byte length mismatch.");
  }
} else {
  if (uncompressedByteLength === 0) {
    throw new Error("PCT2 compressed attribute missing uncompressedByteLength.");
  }
}
```

In `decodePct2Attributes(...)` (Kernänderung):

```ts
export const decodePct2Attributes = (
  buffer: BufferSource,
  directory: Pct2Directory,
  attrNames: string[]
): Record<string, TypedArray> => {
  const sourceBuffer = getSourceBuffer(buffer);
  const sourceOffset = getSourceOffset(buffer);
  const attributes: Record<string, TypedArray> = {};
  const uniqueNames = Array.from(new Set(attrNames));

  for (const name of uniqueNames) {
    const entry = directory.byName[name];
    if (!entry) throw new Error(`PCT2 attribute missing (${name}).`);

    const ArrayType = TYPE_INFO[entry.type];
    if (!ArrayType) throw new Error(`PCT2 unsupported attribute type ${entry.type}.`);

    const elementCount = directory.header.pointCount * entry.components;
    const expectedByteLength = elementCount * ArrayType.BYTES_PER_ELEMENT;

    if (entry.payloadOffset + entry.byteLength > buffer.byteLength) {
      throw new Error("PCT2 attribute block out of range.");
    }

    if (entry.codec === CodecEnum.None) {
      if (entry.byteLength < expectedByteLength) {
        throw new Error("PCT2 attribute payload truncated.");
      }
      attributes[name] = new ArrayType(
        sourceBuffer,
        sourceOffset + entry.payloadOffset,
        elementCount
      );
      continue;
    }

    // compressed
    if (entry.uncompressedByteLength != expectedByteLength) {
      throw new Error(
        `PCT2 uncompressed size mismatch for ${name} (${entry.uncompressedByteLength} != ${expectedByteLength}).`
      );
    }

    const compressed = new Uint8Array(
      sourceBuffer,
      sourceOffset + entry.payloadOffset,
      entry.byteLength
    );

    if (entry.codec === CodecEnum.Zstd) {
      const decompressed = fzstd.decompress(compressed);
      if (decompressed.byteLength < expectedByteLength) {
        throw new Error(`PCT2 zstd payload truncated for ${name}.`);
      }
      const bytes =
        decompressed.byteLength === expectedByteLength
          ? decompressed
          : decompressed.subarray(0, expectedByteLength);

      attributes[name] = new ArrayType(bytes.buffer, bytes.byteOffset, elementCount);
      continue;
    }

    // LZ4: je nach Container/Frame-Format brauchst du ggf. eine passende Lib.
    // lz4js z.B. ist "framed data" orientiert.
    throw new Error(`PCT2 codec ${entry.codec} not supported yet (${name}).`);
  }

  return attributes;
};
```

---

## 6) Default Budgets entschärfen (RAM/GPU)

In `config/budgets.ts` sind die Defaults recht hoch.  
Wenn du “out of memory / GPU reset” vermeiden willst, senke die Defaults:

```ts
// config/budgets.ts
// alt: 2.5GB
const CPU_TILE_CACHE_BUDGET_BYTES_DEFAULT = 1.0 * 1024 * 1024 * 1024;

// alt: 1.0GB
const GPU_TILE_CACHE_BUDGET_BYTES_DEFAULT = 0.5 * 1024 * 1024 * 1024;
```

---

## Nächster Schritt

Wenn du willst, gehen wir danach den nächsten Punkt wirklich **hands-on** durch:  
Du sagst mir, welchen Punkt du als nächstes umgesetzt hast, und ich prüfe kurz, ob irgendwo noch eine Referenz auf `hierarchyPage`/`loadPage` übrig ist (oder ob TS dich eh drauf stößt).



# Codex Tasks (detailliert, copy/paste-ready)

Diese Liste ist so strukturiert, dass du **jede Task als einzelne Codex-Prompt** verwenden kannst.
Reihenfolge ist empfohlen (1 → 6, Bonus optional).

---

## Task 1 — Hierarchy Paging on-demand (progressive loading statt eager)

```text
TASK
Implementiere echtes on-demand Hierarchy Paging: initial nur Page 0 laden, weitere Pages nachladen wenn Refinement/LOD sie benötigt.

KONTEXT
Aktuell lädt Viewer.tsx die komplette Hierarchie über loadAllPages(...). Das ist funktional, aber nicht progressive.
NodeSelector entscheidet "has children" derzeit effektiv nur über geladene Children; es gibt aber childMask als Hinweis auf potenzielle Children.

ZIELE
- Initial Load: nur Page 0
- Nachladen weiterer Pages automatisch, wenn Selection "Children fehlen" diagnostiziert
- Kein Nachladen während aktiver Interaktion (isInteracting)
- Abbruch bei Dataset-Switch über AbortSignal

DATEIEN (touchpoints)
- src/viewer/Viewer.tsx
- src/io/HierarchyPagingLoader.ts
- src/io/NodeSelector.ts
- (neu) src/io/HierarchyPager.ts  (oder HierarchyStore.ts)

IMPLEMENTATION SCHRITTE
1) NodeSelector: declaredHasChildren unterstützen
   - Definiere declaredHasChildren := node.childMask !== 0
   - loadedChildren := childrenByParent.get(key) ?? []
   - canRefine := loadedChildren.length > 0
   - Wenn declaredHasChildren && !canRefine && pixelRadius > refineThreshold:
     - Node bleibt als coarse selektiert
     - Diagnostics erweitern: missingChildrenCount, missingChildrenParents (NodeKeys)

2) Viewer: initial nur Page 0 laden
   - Ersetze loadAllPages(...) durch loadPage(url, 0, ...)
   - Halte State/Refs:
     - pagesLoaded: Set<number>
     - pageBytes (wenn vom Loader bekannt)
     - nodes: NodeRecord[] + Dedup/merge (Map keyed by nodeId/key)

3) Pager/Store implementieren (neu)
   - createHierarchyPager({ url, pageBytes?, signal })
   - init(): lädt Page 0, liefert nodes + pagesLoaded
   - loadNextPages(maxPages): lädt sequenziell pageIndex+1 ... und merged nodes
   - Stop-Kriterien:
     - EOF (keine Records)
     - bekannte Totalgröße überschritten (falls verfügbar)
     - maxPages erreicht

4) Trigger fürs Nachladen
   - Nach jeder Selection:
     - if diagnostics.missingChildrenCount > 0 AND !isInteracting:
       - pager.loadNextPages(1 oder 2) (throttled)
       - bei changed:
         - setHierarchyNodes(mergedNodes)
         - rebuild hierarchyIndexRef.current = buildHierarchyIndex(mergedNodes)
         - re-run selection (oder auf nächsten Debounce)

5) Throttling/Sicherheit
   - Kein Nachladen in tight loop: throttle (z.B. max 1 request / 250ms)
   - AbortSignal durchreichen und bei Dataset change cancellen

AKZEPTANZKRITERIEN
- App startet mit großen Hierarchien schneller (nur Page 0 initial)
- Beim Reinzoomen werden weitere Pages nachgeladen, bis Refinement möglich ist
- Diagnostics zeigt missingChildrenCount konsistent
- Keine Endlosschleife beim Nachladen (EOF/MaxPages stoppt)

TESTS
- Unit: NodeSelector
  - Node mit childMask!=0, aber ohne geladene Children -> missingChildrenCount>0, Node bleibt selektiert
- Unit/Integration: HierarchyPager
  - Mock fetch für 2 Pages: init() lädt Page0; loadNextPages(1) merged Page1 korrekt
NON-GOALS
- Keine UI für manuelles Paging
- Kein vollständiges Rework des Hierarchieformats
```

---

## Task 2 — NodeSelector: Index-Rebuild im Hot-Path hart verhindern

```text
TASK
Stelle sicher, dass buildHierarchyIndex(...) nicht aus Versehen im Hot-Path von selectNodes(...) aufgerufen wird, wenn ein prebuilt hierarchyIndex verfügbar ist.

KONTEXT
Viewer baut hierarchyIndexRef.current = buildHierarchyIndex(hierarchyNodes). selectNodes(...) hat Fallback buildHierarchyIndex(...) wenn hierarchyIndex fehlt.

ZIELE
- Bei vorhandener hierarchyIndex darf buildHierarchyIndex niemals laufen
- Optional: DEV-Warnung falls selectNodes ohne hierarchyIndex bei großen node sets aufgerufen wird

DATEIEN
- src/io/NodeSelector.ts
- src/viewer/Viewer.tsx
- src/io/NodeSelector.test.ts (neu/erweitern)

SCHRITTE
1) NodeSelector:
   - Wenn !input.hierarchyIndex && input.nodes.length > 50000:
     - console.warn(...) (nur DEV)
2) Tests:
   - vi.spyOn(NodeSelectorModule, "buildHierarchyIndex")
   - rufe selectNodes({ hierarchyIndex: prebuiltIndex, nodes, ... })
   - expect(spy).not.toHaveBeenCalled()

AKZEPTANZKRITERIEN
- Test grün und verhindert Regression
NON-GOALS
- Keine algorithmische Änderung am Indexaufbau
```

---

## Task 3 — Memory Budgets: konservative Defaults + harte Caps + optionale Heap-Pressure Anpassung

```text
TASK
Reduziere Default Budgets und implementiere harte Caps pro Profil. Optional: dynamische Reduktion bei hoher JS-Heap-Auslastung.

KONTEXT
Defaults sind derzeit sehr groß (z.B. CPU ~1GB, GPU ~0.5GB). Clamp ist relativ, aber nicht absolut. Große Defaults führen zu RAM-Spikes und Browser-Jank.

ZIELE
- Neue Defaults browser-sicher:
  - CPU default ~512MB
  - GPU default ~256MB
- Harte Caps pro Profil (low/balanced/high)
- Optional: Heap-Pressure heuristik reduziert effective budgets (mit Hysterese)

DATEIEN
- src/config/budgets.ts
- src/viewer/Viewer.tsx (optional pressure loop)
- src/config/budgets.test.ts (neu/erweitern)

SCHRITTE
1) budgets.ts:
   - Definiere Caps:
     - low:  CPU max 256MB, GPU max 256MB
     - balanced: CPU max 512MB, GPU max 512MB
     - high: CPU max 1024MB, GPU max 1024MB (oder konservativer)
   - Implementiere clampAbsolute(value, min, max)
   - Setze Defaults: CPU 512MB, GPU 256MB
   - Wende clampAbsolute auf runtime budgets an

2) Optional: Heap-Pressure
   - Wenn performance.memory existiert:
     - pressure = usedJSHeapSize / jsHeapSizeLimit
     - ab >0.75: scale 0.7; ab >0.85: scale 0.5
     - Hysterese (z.B. erst zurück wenn <0.70)
   - Update nur effectiveBudgetsRef, kein persistentes Settings-Flapping

3) Tests:
   - Stub deviceMemory + profile -> Budgets <= cap, >= min
   - (optional) pressure -> effectiveBudgets sinken

AKZEPTANZKRITERIEN
- getRuntimeBudgets(profile) liefert immer Werte innerhalb Caps
- low/balanced sind konservativ und verhindern GiB-Defaults
NON-GOALS
- Kein komplettes Cache-Refactor
```

---

## Task 4 — RangeFetch Window-Sharing vs Cache-Accounting: Copy-Out dokumentieren + Regression-Test

```text
TASK
Dokumentiere die Absicht hinter buffer.slice() (copy-out) und schreibe einen Test, der sicherstellt, dass keine shared window buffers zurückgegeben werden.

KONTEXT
TileContainerLoader.loadTileBufferFromContainer() gibt buffer.slice() zurück, um nicht den 16MB-RangeFetch-Window-Buffer zu teilen.
Wenn Sharing wieder eingeführt wird, kann Cache-Accounting/Eviction thrashen.

ZIELE
- Kommentar/Doc direkt im Code
- Unit-Test: returned Uint8Array nutzt einen anderen ArrayBuffer als das Fetch-Window

DATEIEN
- src/io/TileContainerLoader.ts
- src/io/TileContainerLoader.test.ts (neu)

SCHRITTE
1) TileContainerLoader.ts:
   - Erkläre im Kommentar: Warum copy-out nötig ist (Cache accounting, Eviction stability)
2) Test:
   - Mock RangeFetch.fetchRangeView(...) -> liefert Uint8Array view auf shared buffer
   - Call loadTileBufferFromContainer(...)
   - Assert: result.buffer !== mockView.buffer

AKZEPTANZKRITERIEN
- Test grün; verhindert Regression
NON-GOALS
- Keine Optimierung auf shared buffers
```

---

## Task 5 — LoadScheduler.cancelNotDesired: Regression-Test gegen “skipped cancels”

```text
TASK
Schreibe einen Unit-Test, der beweist, dass cancelNotDesired() alle ungewollten inflight Loads cancelt (keine skipped Elemente bei Iteration).

KONTEXT
Bug-Fix war: erst toCancel sammeln, dann löschen. Test verhindert Regression zurück zum delete-while-iterating.

ZIELE
- Test erstellt mehrere inflight keys und stellt sicher, dass alle gecancelt werden.

DATEIEN
- src/io/LoadScheduler.ts
- src/io/LoadScheduler.test.ts (neu/erweitern)

SCHRITTE
1) Setup:
   - Mock tileService: getTile(...) erzeugt promises, cancelTile spy
2) Fülle inFlight:
   - setDesiredNodes(keys A,B,C...) + tick() sodass A,B,C inflight sind
3) Ändere desired so, dass nur A desired bleibt
4) Call cancelNotDesired()
5) Expect cancelTile called for B,C,... (alle unerwünschten)

AKZEPTANZKRITERIEN
- cancelTile wird für alle unerwünschten inflight keys genau einmal aufgerufen
NON-GOALS
- Kein Refactor vom Scheduler
```

---

## Task 6 — PCT2 Codec: LZ4 (implementieren) ODER Hard-Fail im Parser (früh)

> Wähle **6A** oder **6B** – nicht beide.

### Task 6A — LZ4 Support implementieren

```text
TASK
Implementiere LZ4-Decoder für PCT2 Attribute, sodass LZ4-komprimierte Tiles korrekt decodiert werden.

KONTEXT
Zstd ist implementiert; LZ4 wird erkannt, aber wirft aktuell “not supported yet” im Decode-Pfad.

ZIELE
- LZ4-komprimierte Attribute werden korrekt dekomprimiert und in TypedArrays gemappt
- Validierung: decompressed length >= expected

DATEIEN
- src/io/Pct2TileLoader.ts
- package.json (dep hinzufügen)
- src/io/Pct2TileLoader.test.ts (neu/erweitern)

SCHRITTE
1) Library auswählen (JS oder WASM) und einbauen (z.B. lz4js oder ähnlich)
2) In decodePct2Attributes:
   - if codec==Lz4: decompress(payload) -> Uint8Array
   - verify size
   - parse TypedArrays wie bisher
3) Test:
   - Erzeuge bekannte Raw-Attribute -> komprimiere mit LZ4 im Test -> decode -> assert equality

AKZEPTANZKRITERIEN
- Tile decode funktioniert für LZ4 und Zstd
NON-GOALS
- Kein Neuerfindung des PCT2 Formats
```

### Task 6B — Hard-Fail früh im Parser

```text
TASK
Wenn LZ4 nicht vorkommen darf: wirf Fehler früh beim Parsen (Header/Directory), nicht erst beim Decode.

KONTEXT
Aktuell kann ein LZ4 Tile bis zum Decode laufen und dann erst failen. Frühzeitiges Fail ist klarer.

ZIELE
- Bei codec==Lz4: throw Error("PCT2 LZ4 not supported") im Parse-Schritt

DATEIEN
- src/io/Pct2TileLoader.ts
- src/io/Pct2TileLoader.test.ts

SCHRITTE
1) In parsePct2HeaderAndDirectory (oder äquivalent):
   - Wenn codec==Lz4 -> throw
2) Test:
   - Parse input mit LZ4 codec -> expect throw

AKZEPTANZKRITERIEN
- Fehler ist früh, eindeutig, reproduzierbar
NON-GOALS
- Keine LZ4 Implementierung
```

---

## Bonus Task — Debug UI: Hierarchy Paging & Diagnostics sichtbar machen

```text
TASK
Erweitere Debug UI/Sidebar um Stats, damit man sofort sieht ob on-demand paging triggert.

ZIELE
- Anzeige: pagesLoaded count, pageBytes, total nodesCount
- Anzeige: missingChildrenCount aus Selection diagnostics

DATEIEN
- src/state/store.tsx (RuntimeStats)
- src/ui/Sidebar.tsx
- src/viewer/Viewer.tsx

AKZEPTANZKRITERIEN
- Stats aktualisieren sich beim Nachladen / beim Reinzoomen sichtbar
NON-GOALS
- Kein neues Design-System
```


"DU BIST EIN SENIOR TYPESCRIPT / WEBGL-WEBGPU PERFORMANCE ENGINEER.
Ziel: Ultra-effiziente Web-Viewer-Pipeline für MASSIV große Punktwolken. Im Code existieren bereits Budgets für CPU/RawBuffer/TileCache, sowie GPU_TILE_CACHE_BUDGET_BYTES_DEFAULT, aber GPU-Budgeting wird NICHT angewendet. Außerdem ist LZ4 im Enum vorhanden, aber Pct2TileLoader.ts wirft bei Lz4. Das muss vollständig implementiert werden.

Harte Anforderungen
- LZ4 muss End-to-End funktionieren (kein TODO/throw), inkl. Unit-Tests und mindestens einem Fixture.
- GPU Tile Cache Budgeting muss tatsächlich enforced werden (LRU/evict), basierend auf GPU_TILE_CACHE_BUDGET_BYTES_DEFAULT (und Konfiguration, falls vorhanden).
- Keine Memory Leaks: evicted GPU resources müssen wirklich freigegeben werden (deleteBuffer/destroy/whatever die Backend-API verlangt).
- Performance: keine unnötigen Kopien, keine großen Main-Thread-Blocks; Dekompression bevorzugt in Worker; typed-array Views statt Re-Pack.
- Robustheit: Validate sizes, handle corrupt tiles gracefully (klare Fehlermeldungen, kein Crash), und stelle sicher, dass falsche Größen nicht zu OOB führen.

Arbeitsauftrag (konkret)
1) Repo-Analyse
   - Finde das Compression Enum (LZ4 ist drin) und alle Stellen, wo die Kompression entschieden wird.
   - Finde Pct2TileLoader.ts und die Stelle, wo für Lz4 geworfen wird.
   - Finde wo GPU_TILE_CACHE_BUDGET_BYTES_DEFAULT definiert ist und wo GPU Tile Caching passiert (Renderer/TileUploader/GpuTileCache/ResourceCache o.ä.).
   - Finde bestehende CPU-Budgetierung (RawBufferCache/TileCache) und das Eviction-Verhalten (LRU, FIFO, ref-count, etc.) als Vorbild.

2) LZ4 Implementierung
   - Implementiere echte LZ4-Dekompression für die PCT2 Tiles.
   - Entscheide dich für eine der folgenden Strategien (wähle die beste für Web-Bundling + Speed):
     A) WASM LZ4 (bevorzugt für Speed). Sicherstellen, dass Vite/Webpack/ESBuild .wasm korrekt bundlet. Lazy-load, instantiateStreaming wenn möglich.
     B) Schnelle JS LZ4 Lib als Fallback (wenn WASM-Bundling im Repo problematisch ist).
   - Dekompressions-API:
     - Input: compressed Uint8Array/ArrayBuffer + erwartete uncompressedByteLength.
     - Output: ArrayBuffer oder Uint8Array mit exakt erwarteter Größe.
     - Validate: Falls result length != expected -> error.
   - Integration:
     - In Pct2TileLoader.ts den Lz4 case implementieren statt throw.
     - Wenn der Tile-Header eine uncompressed size enthält, nutze die; ansonsten berechne sie deterministisch (pointCount * stride + header offsets).
     - Stelle sicher, dass weitere Parsing-Schritte keine Kopien machen (z.B. Float32Array Views auf den dekomprimierten Buffer).
   - Threading:
     - Wenn es bereits einen Worker/Decoder-Worker gibt: LZ4 dort implementieren, sodass Main Thread nicht blockiert.
     - Falls kein Worker existiert: Implementiere minimalen Worker nur für Dekompression+Decode (mit Transferables), ohne Architektur zu sprengen.

3) GPU Budgeting (VRAM) wirklich anwenden
   - Implementiere oder erweitere einen GPU Tile Cache (z.B. GpuTileCache):
     - Tracke pro Tile die GPU-Bytes (Summe aller GPUBuffer/Textures die das Tile belegt).
       * Für WebGL buffers: byteLength der zugrundeliegenden Daten (oder tracked size beim Upload).
       * Für Texturen: width*height*bytesPerPixel (oder API-reported, falls verfügbar).
     - LRU-Policy:
       * Bei Zugriff: mark as most-recent.
       * Beim Insert: wenn totalBytes + newBytes > budget => evict least-recent tiles bis <= budget.
     - Eviction muss GPU Ressourcen freigeben (deleteBuffer/gl.deleteBuffer, deviceBuffer.destroy(), texture.destroy(), etc.).
     - Verknüpfe CPU Tile Eviction mit GPU Eviction:
       * Wenn ein Tile aus CPU TileCache fliegt, muss auch dessen GPU-Pendant freigegeben werden (oder ref-counted).
   - Budget-Quelle:
     - Nutze GPU_TILE_CACHE_BUDGET_BYTES_DEFAULT als Default.
     - Wenn bereits eine Config/Settings existiert (URL params, JSON config, UI): respektiere diese, aber fallback auf default.
   - Observability:
     - Füge Debug/Stats hinzu (falls es bereits Stats gibt): gpuTileBytes, gpuTileCount, evictions, peakBytes.
     - Optional: simple console debug hook oder overlay toggle, aber minimal invasiv.

4) Tests / Fixtures / Regression-Schutz
   - Unit-Test(s) für LZ4:
     - Lege ein kleines PCT2 Fixture an (oder generiere in Test: known raw -> compress -> load).
     - Test: Loader akzeptiert Compression.Lz4, liefert identische decoded Attribute wie uncompressed Version.
     - Test: corrupt / wrong expected size -> sauberer Fehler.
   - Unit-Test(s) für GPU Budgeting:
     - Mock GPU resource objects mit destroy/delete; insert multiple tiles; assert evictions happen; assert destroy called.
     - Test: LRU order korrekt.

5) Performance & Safety Review
   - Achte auf:
     - Keine extra Buffer Copies im Hot Path.
     - Transferables nutzen (ArrayBuffer transfer) wenn Worker.
     - Pooled allocations wenn es bereits Pools gibt.
   - Stelle sicher, dass Bundling (dev+prod) funktioniert und TypeScript sauber baut.

6) Abschluss / Akzeptanzkriterien (müssen erfüllt sein)
   - Loading einer LZ4-komprimierten Punktwolke funktioniert ohne throw, korrektes Rendering.
   - GPU Budget wird eingehalten: Bei Überschreitung werden alte Tiles evicted und GPU memory usage stabilisiert sich.
   - Tests laufen grün (führe die vorhandenen Test/Build Commands aus; wenn unklar, finde sie in package.json).
   - Keine unbenutzten Flags/Dead Code; Update der relevanten Docs/README falls vorhanden.

Output-Format
- Arbeite direkt im Repo, erstelle sinnvolle Commits (oder zumindest eine saubere Diff-Serie).
- Gib am Ende eine kurze Liste der geänderten Dateien und wie man es verifiziert (commands).
- Wenn du Annahmen triffst (z.B. uncompressed size), dokumentiere sie im Code an der Stelle.

JETZT STARTEN: Repo scannen, dann Schritt für Schritt umsetzen."

# Codex-Prompt: pc-viewer gezielt verbessern (Paging, Memory, NodeSelector, Cancellation)

Du arbeitest in einem TypeScript/React/WebGL-Repo (pc-viewer). Ziel ist **konkret messbare** Verbesserungen in 4 Problemfeldern:

1) **Hierarchy Paging** lädt derzeit nur die **erste Seite** – weitere Seiten werden nicht nachgeladen.  
2) **NodeSelector** baut seinen Index (oder Teile davon) zu oft neu → unnötig O(N) pro Frame/Interaktion.  
3) **Memory-/Cache-Accounting** überschätzt Speicher, weil **geteilte ArrayBuffer** (z. B. Window-/Shared-Buffer) über mehrere Tiles/Entries **mehrfach gezählt** werden; Budgets wirken zu hoch/instabil.  
4) **LoadScheduler.cancelNotDesired** / Cancel-Logik: Iteration/Mutation ist fehleranfällig, `toCancel` wird nicht sauber geführt → es bleiben Jobs laufen, die nicht mehr benötigt werden.

Bitte implementiere die folgenden Änderungen **ohne** bestehende öffentliche APIs grundlos zu brechen. Wenn Dateinamen abweichen, suche im Repo nach den genannten Symbolen/Strings.

---

## Leitplanken

- **Sprache im Code:** Englisch (Kommentare/Logs), wie im Repo üblich.
- **Keine neuen schweren Dependencies.** Kleine Utilities okay, aber bevorzugt Standard-TS.
- **Performance first:** keine O(N)-Operationen pro Frame, wenn vermeidbar.
- **Correctness:** Memory-Accounting muss deterministisch und nachvollziehbar sein.
- **Tests:** Ergänze/erweitere Unit-Tests (oder vorhandene Teststruktur), um Regressionen zu verhindern.
- **Observability:** Füge minimal-invasive Debug-Metriken/Logs hinzu (feature-flag / optional), um Paging & Memory nachvollziehen zu können.

---

## A. Bugfix: Hierarchy Paging lädt nur erste Seite

### Problem
`HierarchyPagingLoader` (oder äquivalent) scheint nach der initialen Page **nicht** weiter zu fetchen. Typische Ursachen:
- Page-Continuation/Next-Page Token wird nicht gespeichert oder nicht genutzt
- Loader markiert den Parent/Node als “done” zu früh
- Nachfrage-Trigger fehlt: UI/Selector fordert Kinder an, aber Loader löst kein Fetch aus
- Concurrency/Cancellation: spätere Requests werden gecancelt oder dedupliziert falsch

### Zielverhalten
- Wenn der Nutzer in der Hierarchie weiter navigiert/expandiert, werden fehlende Pages **on demand** nachgeladen.
- Pages werden **dedupliziert** (keine Doppel-Fetches) und **gecached**.
- Cancels funktionieren: Wenn der Nutzer weg navigiert, sollen Fetches abbrechen (AbortController).

### Umsetzungsschritte
1. **Reproduzierbarkeit**: Schreibe/erweitere einen Test oder eine kleine Debug-Route, die:
   - eine Hierarchie mit `pageSize` und z. B. 3 Pages simuliert
   - beim Expandieren/Anfordern von Kind-Indizes > pageSize sicherstellt, dass Page 2/3 gefetcht wird
2. **Paging-State pro Node/Parent** einführen oder reparieren:
   - Speichere pro parentId:
     - `loadedRanges` oder `loadedPages`
     - `nextCursor`/`nextPage` (falls Cursor-basiert)
     - `inflight` Map (pageKey -> Promise), damit parallel Requests dedupliziert werden
3. **Fetch-Trigger**:
   - Wenn NodeSelector/TreeView Kinder `i..j` benötigt: rufe `ensureChildrenLoaded(parentId, neededRange)` auf.
   - `ensureChildrenLoaded` prüft, welche Page(s) fehlen, und startet Fetch.
4. **Robuste Deduplizierung**:
   - Wenn Page bereits inflight: await bestehendes Promise.
   - Wenn Page loaded: no-op.
5. **Edge Cases**:
   - “No more pages” korrekt erkennen (z. B. `nextCursor == null` oder `returnedCount < pageSize`).
   - Partial pages: wenn server weniger liefert, markiere done.
   - Fehler: Retry (max 1–2) oder Fehlerzustand pro parentId speichern; UI kann Hinweis zeigen.

### Dateien/Orte (wahrscheinlich)
- `HierarchyPagingLoader.ts` / `HierarchyLoader.ts`
- `NodeSelector.tsx` / `TreeView.tsx` (Anforderung von Kindern)
- Fetch-Layer: `RangeFetch.ts` oder API-Client
- Scheduler: `LoadScheduler.ts`

### Acceptance Criteria
- **Manueller Check**: Expandieren/Scrollen über >1 Page zeigt zuverlässig weitere Nodes.
- **Keine Doppel-Fetches**: gleiche Page wird nicht mehrfach geladen.
- **Cancel**: Bei schnellem Wechsel zwischen Nodes werden alte inflight Requests abgebrochen.

---

## B. Performance: NodeSelector Index nur bei Hierarchy-Änderung bauen

### Problem
NodeSelector rekonstruiert einen Index (z. B. nodeId→offset, parent→children, visibility sets) zu häufig (z. B. bei jeder Selection/Render).

### Zielverhalten
- Index wird **einmal** gebaut und nur dann aktualisiert, wenn sich die zugrundeliegende Hierarchie-Datenstruktur ändert.
- Selection/hover/filter arbeitet auf O(log N) oder O(1) Strukturen.

### Umsetzung
1. Identifiziere den teuren Schritt (z. B. `buildIndex(...)`).
2. Verschiebe Index-Lebenszyklus:
   - `const hierarchyIndexRef = useRef<HierarchyIndex | null>(null);`
   - `useMemo` / `useEffect` triggert rebuild **nur** bei `hierarchyVersion` / `hierarchyData` Wechsel.
3. Wenn Hierarchy paging nachlädt:
   - aktualisiere Index inkrementell (optional), oder
   - rebuild nur, wenn neue Pages angekommen sind (hierarchyVersion++).

### Zusätzlich
- Wenn aktuell jedes Mal ein Array aller Nodes gescannt wird: ersetze durch Map/Typed Arrays.
- Falls es eine “frame loop” gibt: verbiete Index-Rebuild innerhalb des Render-Loops.

### Acceptance Criteria
- Profiler zeigt keine O(N)-Spikes beim Klicken/Selecten, nur beim tatsächlichen Nachladen/Hierarchy-Update.
- Index-Build wird geloggt/gezählt und passiert nur, wenn Daten sich ändern.

---

## C. Memory & Cache Accounting: Globale Unique-Buffer-Erfassung statt Double Counting

### Problem
Auch wenn bereits ein `Set` innerhalb eines Tiles genutzt wird, kann das TileCache/TileService auf Entry-Ebene dieselben Buffer mehrfach zählen:
- `rawBuffer` / shared window buffers
- positions/normals/colors, die zwischen Tiles geteilt werden (oder identische ArrayBuffer-Objekte)

### Zielverhalten
- Cache-Byte-Schätzung zählt **jede Buffer-Identity nur einmal**, egal wie viele Entries darauf zeigen.
- Wenn ein Entry evicted/dropped wird, sinkt die globale Schätzung entsprechend (Refcount).

### Implementationsvorschlag: Global BufferRefCounter
1. Implementiere eine zentrale Struktur, z. B. in `io/TileService.ts` oder `io/TileCache.ts`:
   - `class BufferRefCounter {`
     - `private refs = new Map<ArrayBufferLike, {bytes:number, refCount:number}>()`
     - `add(buffers: ArrayBufferLike[]): numberDelta`
     - `release(buffers: ArrayBufferLike[]): numberDelta`
     - `get totalBytes(): number`
   - Nutze `WeakMap` optional für Metadaten; Refcounts brauchen aber i. d. R. `Map`.
2. Definiere *einheitlich*, was als “Buffer” gilt:
   - `ArrayBuffer`, `SharedArrayBuffer`
   - ggf. `Uint8Array.buffer` etc. (immer `.buffer` normalisieren)
3. In jedem Cache-Entry speichere:
   - `buffers: ArrayBufferLike[]` (dedupliziert pro Entry!)
   - `bytesEstimate: number` = Summe *unique* buffers (aber **global** wird’s refcounted)
4. Beim `TileCache.set(...)`:
   - wenn Entry neu: `globalCounter.add(entry.buffers)`
   - wenn Entry ersetzt: `globalCounter.release(old.buffers)` dann `add(new.buffers)`
5. Beim `evict`/`dropRawBuffers`:
   - Stelle sicher, dass wirklich `release(...)` aufgerufen wird, wenn ein Buffer nicht mehr referenced ist.
   - Wenn `dropRawBuffers()` Arrays “detacht” oder `rawBuffer = null` setzt: behandle das wie Release des Buffers.

### Wichtig: Shared Buffer Across Entries
- Auch wenn Entry A & B denselben `rawBuffer` haben, soll global nur +1x bytes gezählt werden.
- Verwende Identity des `ArrayBufferLike` als Map-Key.

### Budgets
- Senke konstante Budgets auf realistischere Defaults (z. B. in MB):
  - Desktop: moderat
  - Mobile: deutlich kleiner
- Mache Budgets konfigurierbar (URL param / settings), aber sichere Defaults.

### Timing-Bug vermeiden
Wenn `lastUsed` via `Date.now()` gesetzt wird, darf `dropRawBuffersToFitBudget` nicht mit `performance.now()` vergleichen.  
- Verwende **überall Date.now()** für wall-clock epoch ms, oder
- speichere `lastUsedMonotonic` separat und nutze konsequent `performance.now()`.  
Entscheide dich für **eine** Variante und mache sie konsistent.

### Acceptance Criteria
- Globale `totalBytes` reagiert korrekt:
  - zwei Entries teilen Buffer → total steigt nur einmal
  - evict eines Entries → total bleibt, solange anderer Entry noch referenziert
  - evict aller → total sinkt auf 0
- `dropRawBuffersToFitBudget` entfernt die ältesten RawBuffers korrekt und nachvollziehbar.
- Keine Zeitbasis-Mismatch-Bugs.

---

## D. LoadScheduler: cancelNotDesired / toCancel korrekt und stabil

### Problem
`cancelNotDesired` iteriert über eine Collection, während sie mutiert wird, oder baut `toCancel` unvollständig. Ergebnis:
- Jobs, die nicht mehr gebraucht werden, laufen weiter
- oder es werden falsche Jobs gecancelt

### Zielverhalten
- Deterministische Cancel-Entscheidung:
  - Input: `desiredKeys:Set<string>`
  - Scheduler cancelt alles, was inflight ist und **nicht** desired ist (mit Grace/priority Regeln).
- Keine Mutation während Iteration über dieselbe Map/Set.

### Umsetzung
1. Snapshot statt Live-Iteration:
   - `const inflight = Array.from(this.inflight.entries());`
   - Filter auf `!desiredKeys.has(key)` → `toCancel`.
2. Cancel in separater Schleife durchführen.
3. Falls es Prioritäten gibt:
   - Cancel zuerst low-priority, dann high-priority (oder nach Alter).
4. Stelle sicher, dass Cancel auch wirklich `AbortController.abort()` triggert und der Promise-Reject sauber gehandhabt wird (keine unhandled rejections).

### Acceptance Criteria
- Unit-Test: Wenn `desiredKeys` sich ändert, werden nicht gewünschte Jobs abgebrochen.
- Kein Flattern: Jobs werden nicht sofort neu gestartet, wenn sie gerade erst gecancelt wurden (optional: small cooldown).

---

## E. PCT2 Codec: Bound-Checks, Robustness, Tests

Du hast bereits Verbesserungen (zstd decompress + validation). Bitte ergänze:

1. **Harte Größenlimits** (konfigurierbar):
   - Max compressed chunk
   - Max decompressed size
   - Max points per tile
2. **Defensive Parsing**:
   - Jeder Read aus `DataView` bounds-checken
   - Bei Inkonsistenz: klare Fehlermeldung mit Kontext (tile id, offset)
3. **Tests**:
   - Valid minimal file
   - Corrupted header (offset out of range)
   - Decompressed > limit → sauberer Error

---

## F. Minimal-Observability (Debug-only)

Füge eine optionale Debug-Ausgabe hinzu (z. B. `debugStats`), ohne Default-Spam:
- `hierarchyPagesLoaded`, `hierarchyInflight`
- `cacheTotalBytes`, `uniqueBuffers`, `entries`, `pinnedBytes`
- `schedulerInflight`, `schedulerCanceled`

Kann als kleines Overlay oder console log mit Feature-Flag sein.

---

## Deliverables (am Ende)

1. Code-Änderungen in den relevanten Modulen
2. Neue/angepasste Tests
3. Kurze Doku-Notiz in README oder `docs/`:
   - wie Paging funktioniert
   - wie Memory accounting funktioniert (unique buffers + refcount)
   - wie man Budgets konfiguriert

---

## Definition of Done

- `pnpm test` / `npm test` (je nach Repo) grün  
- Viewer lädt Hierarchy über mehrere Pages  
- NodeSelector Index-Rebuild nur bei Data-Change  
- Memory accounting zählt shared buffers nicht doppelt  
- Cancel-Logik zuverlässig  
- Keine unhandled promise rejections, keine Zeitbasis-Mismatch

# Codex-Auftrag: Render Point Budget + gleichmäßiges Random-Thinning (ohne Tiles zu verlieren)

**Ziel:**  
Implementiere eine **einstellbare Render-Punktanzahl** (Render Point Budget), ohne dass Tiles komplett ausgelassen werden. Wenn das Budget kleiner als die sichtbaren Punkte ist, soll in **allen Tiles gleichmäßig zufällig ausgedünnt** gerendert werden (random thinning), sodass **alle Tiles weiterhin angezeigt** werden – nur mit weniger Punkten.

## Anforderungen / Verhalten
1. Es gibt eine neue Einstellung `renderPointBudget` (number), z.B. Default `6_000_000`.
2. **Kein Hard-Cap mehr in der Node/Tile-Selection**: `NodeSelector` darf nicht wegen `visiblePoints >= targetPoints` abbrechen. Tiles sollen nicht “verschwinden”, nur weil weniger Punkte gerendert werden sollen.
3. Wenn `renderPointBudget < renderData.pointCountTotal`, dann:
   - Berechne `samplingRate = renderPointBudget / renderData.pointCountTotal` (clamp 0..1)
   - Render in **jedem Tile** zufällig nur `samplingRate` der Punkte.
   - Zufall soll **deterministisch pro Tile** sein (stabil beim Navigieren), aber tile-übergreifend “anders”.
   - Optional: **mindestens 1 Punkt pro Tile** behalten (damit wirklich jedes Tile sichtbar bleibt).
4. Das Random-Thinning soll **GPU-seitig** passieren (Shader discard), nicht durch Tiles weglassen.
5. Bestehendes Delete-Filtering (`DataFilterExtension`) muss weiterhin funktionieren.

---

## Schritt 1: Setting hinzufügen (`renderPointBudget`)
### Datei: `src/state/store.tsx`
- Erweitere `export type AppSettings` um:
```ts
renderPointBudget: number;
```
- Setze Default im `initialState.settings` (z.B. 6 Mio):
```ts
settings: {
  performanceProfile: "auto",
  debugEnabled: false,
  renderPointBudget: 6_000_000,
},
```
- Der existing Reducer-Case `"set-settings"` merged schon – keine weitere Logik nötig.

---

## Schritt 2: UI-Control in Sidebar
### Datei: `src/ui/Sidebar.tsx`
Füge ein Eingabefeld (Number Input) hinzu, z.B. im Debug-Block nahe `performanceProfile`:

- UI:
  - Label: “Render Points”
  - Input: number, min 0, step z.B. 100000
  - OnChange dispatch `set-settings` mit `renderPointBudget`

Beispiel-Snippet:
```tsx
<label className="sidebar-label">
  <span>Render Points</span>
  <input
    type="number"
    min={0}
    step={100000}
    value={settings.renderPointBudget}
    onChange={(e) =>
      dispatch({
        type: "set-settings",
        settings: { renderPointBudget: Math.max(0, Number(e.target.value) || 0) },
      })
    }
  />
</label>
```

- Optional: Wenn `settings.debugEnabled`, zeige zusätzlich Sampling-Rate (nur wenn `renderData` vorhanden):
  - `samplingRate = Math.min(1, settings.renderPointBudget / renderData.pointCountTotal)`
  - Anzeige z.B. “Sampling: 62%”

---

## Schritt 3: Hard-Cap aus der Node-Selection entfernen
### Datei: `src/io/NodeSelector.ts`
Aktuell bricht die Schleife ab mit:
```ts
if (selected.length >= maxNodes || visiblePoints >= targetPoints) {
  reasonCounts.budgetLimited += 1;
  break;
}
```

**Ändere das so**, dass **nur `maxNodes` limitiert** (kein Punktbudget-Break):
```ts
if (selected.length >= maxNodes) {
  reasonCounts.budgetLimited += 1;
  break;
}
```

- `targetPoints` kann im Code bleiben (für Diagnostics/Debug), wird aber nicht mehr zum Abbruch genutzt.
- Ergebnis: Tiles verschwinden nicht mehr durch “Target Points” Cap.

---

## Schritt 4: SamplingExtension (Shader-Discard) in PointCloudLayerFactory
### Datei: `src/layers/PointCloudLayerFactory.ts`

### 4.1: Options erweitern
Erweitere `PointCloudLayerOptions` um:
```ts
samplingRate?: number;        // 0..1
samplingValues?: Uint8Array;  // length == tile.pointCount
samplingVersion?: number;     // optional trigger, wenn Rate/Seed ändert
```

### 4.2: BinaryAttributes erweitern
Füge eine binary attribute definition hinzu:
```ts
getSamplingValue?: { value: Uint8Array; size: 1; normalized: true };
```

> Hinweis: Wir verwenden `Uint8Array` + `normalized: true`, damit der Shader 0..1 bekommt, aber nur 1 Byte pro Punkt.

### 4.3: Custom Deck.gl Extension implementieren
Importe:
```ts
import { LayerExtension } from "@deck.gl/core";
```

Implementiere im selben File (oben oder unten) eine Extension, die:
- ein instanced attribute (z.B. `instanceSampling`) registriert
- `samplingRate` als uniform setzt
- im fragment shader discards macht

Beispiel (evtl. minimale Typanpassungen nötig je nach deck.gl Version):
```ts
class SamplingExtension extends LayerExtension {
  static extensionName = "SamplingExtension";

  initializeState(this: any) {
    const attributeManager = this.getAttributeManager?.();
    attributeManager?.addInstanced({
      instanceSampling: {
        size: 1,
        accessor: "getSamplingValue",
        type: 5121,        // gl.UNSIGNED_BYTE
        normalized: true,
      },
    });
  }

  getShaders() {
    return {
      inject: {
        "vs:#decl": `
          attribute float instanceSampling;
          varying float vSampling;
        `,
        "vs:#main-end": `
          vSampling = instanceSampling;
        `,
        "fs:#decl": `
          varying float vSampling;
          uniform float samplingRate;
        `,
        "fs:#main-start": `
          if (vSampling > samplingRate) {
            discard;
          }
        `,
      },
    };
  }

  draw(this: any, opts: any) {
    // opts.uniforms ist das Standard-Muster in deck.gl
    opts.uniforms.samplingRate = this.props.samplingRate ?? 1.0;
  }
}
```

> Wenn Codex bei `draw()`/`opts.uniforms` Typfehler bekommt, soll es die Parameter als `any` lassen (dieser Teil ist abhängig von deck.gl Typings). Wichtig ist: uniform `samplingRate` muss gesetzt werden.

### 4.4: Layer wiring
In `createPointCloudLayer(...)`:
- Wenn `options.samplingValues` vorhanden UND `options.samplingRate < 1`, dann:
  - setze `attributes.getSamplingValue = { value: options.samplingValues, size: 1, normalized: true }`
  - füge `new SamplingExtension()` zu `extensions` hinzu
  - übergib `samplingRate` als Prop auf den Layer (damit Extension ihn lesen kann)

Beispiel-Logik:
```ts
const samplingEnabled =
  options.samplingValues &&
  typeof options.samplingRate === "number" &&
  options.samplingRate >= 0 &&
  options.samplingRate < 1;

if (samplingEnabled) {
  attributes.getSamplingValue = {
    value: options.samplingValues!,
    size: 1,
    normalized: true,
  };
}

const extensions = [
  ...(filterValues ? [new DataFilterExtension({ filterSize: 1 })] : []),
  ...(samplingEnabled ? [new SamplingExtension()] : []),
];
```

Und im Layer Props:
```ts
return new PointCloudLayer({...,
  extensions,
  samplingRate: samplingEnabled ? options.samplingRate : 1,
  updateTriggers: {
    ...(filterTrigger ? { getFilterValue: filterTrigger } : {}),
    ...(options.samplingVersion ? { getSamplingValue: options.samplingVersion } : {}),
  },
});
```

---

## Schritt 5: SamplingRate berechnen + per Tile SamplingValues erzeugen
### Datei: `src/viewer/Viewer.tsx`

### 5.1: effectiveRenderBudget bestimmen
Nutze `settings.renderPointBudget` als primäres Budget.

Optional (wenn du während Interaction automatisch niedriger willst):  
`effectiveRenderBudget = isInteracting ? Math.min(settings.renderPointBudget, budgets.targetVisiblePointsInteract) : settings.renderPointBudget`

Sonst:
```ts
const effectiveRenderBudget = settings.renderPointBudget;
```

### 5.2: samplingRate berechnen
In der Nähe, wo `layers` gebaut werden (das `useMemo` für Layers):
```ts
const samplingRate =
  renderData && renderData.pointCountTotal > 0
    ? Math.min(1, effectiveRenderBudget / renderData.pointCountTotal)
    : 1;
```

### 5.3: Deterministische Random-Bytes pro Tile (mit Cache)
Lege einen Ref-Cache an:
```ts
const samplingCacheRef = useRef(new Map<string, Uint8Array>());
```

Implementiere eine kleine Hash+RNG Helper-Funktion im `Viewer.tsx` (lokal, oberhalb der Component), z.B.:
```ts
const hashString32 = (str: string) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const mulberry32 = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
```

Dann beim Layer-Build pro Tile:
- key: `${activeDatasetId}:${keyFromTile(tile)}:${tile.pointCount}`
- wenn nicht im Cache: generate `Uint8Array(tile.pointCount)` und füllen
- “mindestens 1 Punkt pro Tile”: wähle `keepIndex = seed % tile.pointCount` und setze `arr[keepIndex] = 0`

Beispiel:
```ts
const getSamplingValuesForTile = (tile: TileRenderData) => {
  const baseKey = `${activeDatasetId}:${keyFromTile(tile)}`;
  const cacheKey = `${baseKey}:${tile.pointCount}`;
  const cached = samplingCacheRef.current.get(cacheKey);
  if (cached) return cached;

  const seed = hashString32(cacheKey);
  const rng = mulberry32(seed);
  const arr = new Uint8Array(tile.pointCount);
  for (let i = 0; i < arr.length; i += 1) {
    arr[i] = Math.floor(rng() * 256);
  }

  if (arr.length > 0) {
    const keepIndex = seed % arr.length;
    arr[keepIndex] = 0; // garantiert mindestens 1 Punkt sichtbar
  }

  samplingCacheRef.current.set(cacheKey, arr);
  return arr;
};
```

Optional: Cache aufräumen, wenn Dataset wechselt (Map neu setzen).

### 5.4: createPointCloudLayer aufrufen
Im `renderData.tiles.map(...)`:
- Wenn `samplingRate < 1`, gib `samplingValues` und `samplingRate` als options rein.
- Wenn `samplingRate === 1`, lass es weg (keine Extension, kein extra Attribut).

```ts
const samplingEnabled = samplingRate < 1;

return createPointCloudLayer(tile, callbacks, {
  id: layerId,
  pickable,
  autoHighlight,
  pointSize,
  modelMatrix,
  filterValues,
  filterVersion,
  ...(samplingEnabled
    ? {
        samplingRate,
        samplingValues: getSamplingValuesForTile(tile),
        samplingVersion: Math.round(samplingRate * 1e6), // trigger on changes
      }
    : {}),
});
```

---

## Schritt 6: RuntimeStats.targetVisiblePoints korrekt anzeigen
### Datei: `src/viewer/Viewer.tsx`
In `updateRuntimeStats(...)` wird aktuell `targetVisiblePoints: effectiveTargetVisiblePoints` gesetzt.

Ändere es so, dass es das neue **effectiveRenderBudget** ist:
```ts
targetVisiblePoints: effectiveRenderBudget,
```

Damit zeigt dein Debug (“Target Points”) wirklich das Render-Budget an.

---

## Akzeptanzkriterien (manuell prüfen)
1. **UI:** In der Sidebar kann ich “Render Points” ändern (z.B. 1M, 6M, 20M).
2. **Tiles:** Bei niedrigem Budget bleiben **alle Tiles sichtbar** (Rendered Tiles ~ Loaded Tiles, sofern sie im View sind).
3. **Thinning:** Bei Budget < visible: die Punktwolke wird sichtbar dünner, aber **nicht tile-weise weg**.
4. **Stabilität:** Beim Orbit/Zoom flackert das Sampling nicht wild (deterministisch pro Tile).
5. **Delete Mode:** Delete-Mask funktioniert weiterhin, zusätzlich zum Sampling.
6. **Debug:** “Target Points” entspricht dem eingestellten Render-Budget.
