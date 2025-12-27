import {
  OrbitController,
  OrbitView,
  OrbitViewport,
  type PickingInfo,
} from "@deck.gl/core";
import DeckGL from "@deck.gl/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPointCloudLayer } from "../layers/PointCloudLayerFactory";
import { createPatchLayers } from "../layers/PatchLayersFactory";
import { getRuntimeBudgets } from "../config/budgets";
import { loadPage } from "../io/HierarchyPagingLoader";
import { loadManifest } from "../io/ManifestLoader";
import { selectNodes, type SelectedNode } from "../io/NodeSelector";
import { getRangeWindowStats } from "../io/RangeFetch";
import { LoadScheduler } from "../io/LoadScheduler";
import { TileService } from "../io/TileService";
import { loadRenderData } from "../io/TileManager";
import { useAppStore } from "../state/store";
import type { RuntimeStats } from "../state/store";
import type { BoundsQuantization, DatasetManifest } from "../types/Dataset";
import type { NodeRecord, Page } from "../types/Hierarchy";
import { getDatasetById } from "../types/Dataset";
import type { Vec3 } from "../types/Point";
import type { RenderData, TileRenderData } from "../types/Tile";
import { getBoundsCenter } from "../utils/bounds";

const getVec3 = (buffer: Float32Array, index: number): Vec3 => {
  const offset = index * 3;
  return [buffer[offset], buffer[offset + 1], buffer[offset + 2]];
};

const getColor = (buffer: Uint8Array, index: number): Vec3 => {
  const offset = index * 3;
  return [buffer[offset], buffer[offset + 1], buffer[offset + 2]];
};

const getWorldPosition = (tile: TileRenderData, index: number): Vec3 => {
  const local = getVec3(tile.positions, index);
  if (!tile.origin) {
    return local;
  }
  return [
    local[0] + tile.origin[0],
    local[1] + tile.origin[1],
    local[2] + tile.origin[2],
  ];
};

const nodeKey = (nodeId: NodeRecord["nodeId"]) =>
  typeof nodeId === "bigint" ? nodeId.toString() : String(nodeId);

const buildRenderData = (
  manifest: DatasetManifest,
  tiles: TileRenderData[]
): RenderData => {
  const pointCountTotal = tiles.reduce(
    (sum, tile) => sum + tile.pointCount,
    0
  );
  return {
    tiles,
    pointCountTotal,
    bounds: manifest.bounds,
    center: getBoundsCenter(manifest.bounds),
  };
};

type HierarchyIndex = {
  nodeById: Map<string, NodeRecord>;
  childrenByParent: Map<string, NodeRecord[]>;
};

const buildHierarchyIndex = (nodes: NodeRecord[]): HierarchyIndex => {
  const nodeById = new Map<string, NodeRecord>();
  const childrenByParent = new Map<string, NodeRecord[]>();
  nodes.forEach((node) => nodeById.set(nodeKey(node.nodeId), node));
  nodes.forEach((node) => {
    const parentKey = nodeKey(node.parentId);
    if (nodeById.has(parentKey) && parentKey !== nodeKey(node.nodeId)) {
      const list = childrenByParent.get(parentKey) ?? [];
      list.push(node);
      childrenByParent.set(parentKey, list);
    }
  });
  return { nodeById, childrenByParent };
};

const decodeQuantizedBounds = (
  bounds: NodeRecord["bounds"],
  quantization: BoundsQuantization
) => {
  const [ox, oy, oz] = quantization.origin;
  const [sx, sy, sz] = quantization.scale;
  return {
    min: [
      ox + bounds.min[0] * sx,
      oy + bounds.min[1] * sy,
      oz + bounds.min[2] * sz,
    ] as Vec3,
    max: [
      ox + bounds.max[0] * sx,
      oy + bounds.max[1] * sy,
      oz + bounds.max[2] * sz,
    ] as Vec3,
  };
};

const getBoundsRadius = (min: Vec3, max: Vec3) => {
  const dx = max[0] - min[0];
  const dy = max[1] - min[1];
  const dz = max[2] - min[2];
  const radius = 0.5 * Math.hypot(dx, dy, dz);
  return Number.isFinite(radius) ? radius : 0;
};

const getFocalLengthPixels = (
  projectionMatrix: number[] | undefined,
  height: number
) => {
  const scale = projectionMatrix?.[5] ?? Number.NaN;
  if (!Number.isFinite(scale)) {
    return height / 2;
  }
  return Math.abs(scale) * (height / 2);
};

const getNodeMetrics = (
  node: NodeRecord,
  quantization: BoundsQuantization,
  cameraPosition: Vec3,
  projectionMatrix: number[] | undefined,
  height: number
) => {
  const bounds = decodeQuantizedBounds(node.bounds, quantization);
  const center: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const radius = getBoundsRadius(bounds.min, bounds.max);
  const dx = center[0] - cameraPosition[0];
  const dy = center[1] - cameraPosition[1];
  const dz = center[2] - cameraPosition[2];
  const distance = Math.max(1e-3, Math.hypot(dx, dy, dz));
  const pixelRadius =
    (radius / distance) * getFocalLengthPixels(projectionMatrix, height);
  return {
    pixelRadius: Number.isFinite(pixelRadius) ? pixelRadius : 0,
    distance,
  };
};

export const Viewer = () => {
  const { state, dispatch } = useAppStore();
  const {
    activeDatasetId,
    renderData,
    showPointCloud,
    viewState,
    patches,
    editMode,
    settings,
  } = state;
  const [manifestState, setManifestState] = useState<{
    datasetId: string;
    manifest: DatasetManifest;
  } | null>(null);
  const [hierarchyState, setHierarchyState] = useState<{
    datasetId: string;
    page: Page;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const tileServiceRef = useRef<TileService>(new TileService());
  const schedulerRef = useRef<LoadScheduler | null>(null);
  const hierarchyIndexRef = useRef<HierarchyIndex | null>(null);
  const manifestRef = useRef<DatasetManifest | null>(null);
  const selectedEntriesRef = useRef<SelectedNode[]>([]);
  const lastRenderKeyRef = useRef<string | null>(null);
  const selectedKeysRef = useRef<Set<string>>(new Set());
  const previousSelectionRef = useRef<Set<string>>(new Set());
  const selectionTimerRef = useRef<number | null>(null);
  const datasetLoadIdRef = useRef(0);
  const idleTimerRef = useRef<number | null>(null);
  const interactionIdleTimerRef = useRef<number | null>(null);
  const isInteractingRef = useRef(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const budgets = useMemo(
    () => getRuntimeBudgets(settings.performanceProfile),
    [settings.performanceProfile]
  );
  const budgetsRef = useRef(budgets);
  const manifest =
    manifestState?.datasetId === activeDatasetId
      ? manifestState.manifest
      : null;
  const hierarchyPage =
    hierarchyState?.datasetId === activeDatasetId ? hierarchyState.page : null;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      setViewportSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height }
      );
    };
    updateSize();
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const orbitViewport = useMemo(
    () =>
      new OrbitViewport({
        width: viewportSize.width,
        height: viewportSize.height,
        target: viewState.target,
        zoom: viewState.zoom,
        rotationX: viewState.rotationX,
        rotationOrbit: viewState.rotationOrbit,
      }),
    [viewportSize, viewState]
  );

  const effectiveTargetVisiblePoints = isInteracting
    ? budgets.targetVisiblePointsInteract
    : budgets.targetVisiblePoints;

  const selectionBudgets = useMemo(
    () => ({ ...budgets, targetVisiblePoints: effectiveTargetVisiblePoints }),
    [budgets, effectiveTargetVisiblePoints]
  );

  useEffect(() => {
    budgetsRef.current = budgets;
    schedulerRef.current?.setMaxConcurrentRequests(budgets.maxConcurrentRequests);
  }, [budgets]);

  useEffect(() => {
    manifestRef.current = manifest;
  }, [manifest]);

  useEffect(() => {
    hierarchyIndexRef.current = hierarchyPage
      ? buildHierarchyIndex(hierarchyPage.records)
      : null;
  }, [hierarchyPage]);

  const updateRenderDataFromCache = useCallback(() => {
    const activeManifest = manifestRef.current;
    if (!activeManifest) {
      return;
    }
    const tiles: TileRenderData[] = [];
    selectedEntriesRef.current.forEach((entry) => {
      const tile = tileServiceRef.current.getCachedTile(
        nodeKey(entry.node.nodeId)
      );
      if (tile) {
        tiles.push(tile);
      }
    });
    if (tiles.length === 0) {
      if (lastRenderKeyRef.current !== null) {
        lastRenderKeyRef.current = null;
        dispatch({ type: "set-render-data", renderData: null });
      }
      return;
    }
    const tileIds = tiles.map((tile) => tile.id).sort();
    const renderKey = `${activeManifest.id}:${tileIds.join("|")}`;
    if (renderKey === lastRenderKeyRef.current) {
      return;
    }
    lastRenderKeyRef.current = renderKey;
    dispatch({
      type: "set-render-data",
      renderData: tiles.length > 0 ? buildRenderData(activeManifest, tiles) : null,
    });
  }, [dispatch]);

  const updateRuntimeStats = useCallback(
    (overrides: Partial<RuntimeStats> = {}) => {
      const cacheStats = tileServiceRef.current.stats();
      const schedulerStats = schedulerRef.current?.stats();
      const rangeStats = getRangeWindowStats();
      dispatch({
        type: "set-runtime-stats",
        stats: {
          loadedTiles: cacheStats.items,
          cpuCacheBytes: cacheStats.bytes,
          inFlightRequests: schedulerStats?.inFlight ?? cacheStats.inFlight,
          queuedRequests: schedulerStats?.queued ?? 0,
          rangeCache: rangeStats,
          isInteracting,
          targetVisiblePoints: effectiveTargetVisiblePoints,
          ...overrides,
        },
      });
    },
    [dispatch, isInteracting, effectiveTargetVisiblePoints]
  );

  const handleTileLoaded = useCallback(() => {
    updateRenderDataFromCache();
    updateRuntimeStats();
  }, [updateRenderDataFromCache, updateRuntimeStats]);

  const handleTileError = useCallback(
    (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unknown loading error.";
      dispatch({ type: "set-status", status: "error", error: message });
    },
    [dispatch]
  );

  useEffect(() => {
    if (schedulerRef.current) {
      return;
    }
    schedulerRef.current = new LoadScheduler({
      tileService: tileServiceRef.current,
      getManifest: () => manifestRef.current,
      getBudgetBytes: () => budgetsRef.current.cpuCacheBudgetBytes,
      maxConcurrentRequests: budgets.maxConcurrentRequests,
      onTileLoaded: handleTileLoaded,
      onError: handleTileError,
    });
  }, [handleTileLoaded, handleTileError, budgets.maxConcurrentRequests]);

  useEffect(() => {
    updateRuntimeStats({
      isInteracting,
      targetVisiblePoints: effectiveTargetVisiblePoints,
    });
  }, [isInteracting, effectiveTargetVisiblePoints, updateRuntimeStats]);

  const requestPrefetch = useCallback(() => {
    const manifestSnapshot = manifestRef.current;
    const hierarchyIndex = hierarchyIndexRef.current;
    const scheduler = schedulerRef.current;
    if (!manifestSnapshot || !hierarchyIndex || !scheduler) {
      return;
    }
    const stats = scheduler.stats();
    if (stats.queued > 4 || stats.inFlight > 0) {
      return;
    }
    const desiredEntries = selectedEntriesRef.current;
    if (desiredEntries.length === 0) {
      return;
    }
    const desiredKeys = selectedKeysRef.current;
    const candidates = new Map<string, NodeRecord>();
    for (const entry of desiredEntries) {
      const parentKey = nodeKey(entry.node.parentId);
      const siblings = hierarchyIndex.childrenByParent.get(parentKey) ?? [];
      for (const sibling of siblings) {
        const key = nodeKey(sibling.nodeId);
        if (desiredKeys.has(key) || candidates.has(key)) {
          continue;
        }
        if (tileServiceRef.current.has(key)) {
          continue;
        }
        candidates.set(key, sibling);
        if (candidates.size >= 20) {
          break;
        }
      }
      if (candidates.size >= 20) {
        break;
      }
    }
    if (candidates.size === 0) {
      scheduler.setPrefetchNodes([]);
      return;
    }
    const cameraPosition = orbitViewport.cameraPosition as Vec3;
    const prefetchEntries = Array.from(candidates.values()).map((node) => {
      const metrics = getNodeMetrics(
        node,
        manifestSnapshot.boundsQuantization,
        cameraPosition,
        orbitViewport.projectionMatrix,
        viewportSize.height
      );
      return {
        node,
        pixelRadius: metrics.pixelRadius,
        distance: metrics.distance,
      };
    });
    scheduler.setPrefetchNodes(prefetchEntries);
    scheduler.tick();
    updateRuntimeStats({
      queuedRequests: scheduler.stats().queued,
      inFlightRequests: scheduler.stats().inFlight,
    });
  }, [orbitViewport, viewportSize.height, updateRuntimeStats]);

  const setInteracting = useCallback((next: boolean) => {
    if (isInteractingRef.current === next) {
      return;
    }
    isInteractingRef.current = next;
    setIsInteracting(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const dataset = getDatasetById(activeDatasetId);
    datasetLoadIdRef.current += 1;
    const loadId = datasetLoadIdRef.current;
    tileServiceRef.current.clear();
    schedulerRef.current?.clear();
    selectedEntriesRef.current = [];
    lastRenderKeyRef.current = null;
    selectedKeysRef.current = new Set();
    previousSelectionRef.current = new Set();
    if (selectionTimerRef.current !== null) {
      window.clearTimeout(selectionTimerRef.current);
      selectionTimerRef.current = null;
    }
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (interactionIdleTimerRef.current !== null) {
      window.clearTimeout(interactionIdleTimerRef.current);
      interactionIdleTimerRef.current = null;
    }
    isInteractingRef.current = false;
    window.setTimeout(() => setIsInteracting(false), 0);
    dispatch({
      type: "set-runtime-stats",
      stats: {
        selectedNodes: 0,
        visiblePoints: 0,
        loadedTiles: 0,
        cpuCacheBytes: 0,
        inFlightRequests: 0,
        queuedRequests: 0,
        lastSelectionUpdateMs: null,
        isInteracting: false,
        targetVisiblePoints: effectiveTargetVisiblePoints,
        rangeCache: getRangeWindowStats(),
      },
    });

    if (!dataset) {
      dispatch({
        type: "set-status",
        status: "error",
        error: `Dataset ${activeDatasetId} not found.`,
      });
      return undefined;
    }

    dispatch({ type: "set-status", status: "loading", error: null });
    dispatch({ type: "set-render-data", renderData: null });

    loadManifest(dataset.manifestUrl)
      .then(async (loadedManifest) => {
        if (cancelled) return;
        if (datasetLoadIdRef.current !== loadId) return;
        setManifestState({ datasetId: activeDatasetId, manifest: loadedManifest });
        dispatch({
          type: "initialize-view-state",
          datasetId: activeDatasetId,
          bounds: loadedManifest.bounds,
        });
        if (loadedManifest.hierarchyUrl) {
          const page = await loadPage(loadedManifest.hierarchyUrl, 0, {
            pageBytes: loadedManifest.hierarchyPageBytes,
          });
          if (cancelled || datasetLoadIdRef.current !== loadId) return;
          setHierarchyState({ datasetId: activeDatasetId, page });
          return;
        }

        const data = await loadRenderData(loadedManifest);
        if (cancelled || datasetLoadIdRef.current !== loadId) return;
        dispatch({ type: "set-render-data", renderData: data });
        dispatch({ type: "set-status", status: "ready", error: null });
        dispatch({
          type: "set-runtime-stats",
          stats: {
            selectedNodes: data.tiles.length,
            visiblePoints: data.pointCountTotal,
            loadedTiles: data.tiles.length,
            cpuCacheBytes: data.tiles.reduce(
              (sum, tile) =>
                sum +
                tile.positions.byteLength +
                (tile.colors?.byteLength ?? 0),
              0
            ),
            inFlightRequests: 0,
            queuedRequests: 0,
            lastSelectionUpdateMs: 0,
            isInteracting: isInteractingRef.current,
            targetVisiblePoints: effectiveTargetVisiblePoints,
            rangeCache: getRangeWindowStats(),
          },
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Unknown loading error.";
        dispatch({ type: "set-status", status: "error", error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [activeDatasetId, dispatch, effectiveTargetVisiblePoints]);

  useEffect(() => {
    if (!manifest?.hierarchyUrl || !hierarchyPage) {
      return;
    }

    if (selectionTimerRef.current !== null) {
      window.clearTimeout(selectionTimerRef.current);
    }

    selectionTimerRef.current = window.setTimeout(() => {
      const selectionStart = performance.now();
      const selectionResult = selectNodes({
        viewport: orbitViewport,
        width: viewportSize.width,
        height: viewportSize.height,
        nodes: hierarchyPage.records,
        boundsQuantization: manifest.boundsQuantization,
        runtimeBudgets: selectionBudgets,
        previousSelection: previousSelectionRef.current,
      });
      const selectedEntries = selectionResult.selected;
      selectedEntriesRef.current = selectedEntries;
      const nextSelectedKeys = new Set(
        selectedEntries.map((entry) => nodeKey(entry.node.nodeId))
      );
      const previousKeys = selectedKeysRef.current;
      selectedKeysRef.current = nextSelectedKeys;
      previousSelectionRef.current = nextSelectedKeys;

      previousKeys.forEach((key) => {
        if (!nextSelectedKeys.has(key)) {
          tileServiceRef.current.unpin(key);
          tileServiceRef.current.cancelTile(key);
        }
      });
      nextSelectedKeys.forEach((key) => tileServiceRef.current.pin(key));

      updateRenderDataFromCache();

      if (import.meta.env.DEV) {
        console.info("[hierarchy] node selection", {
          zoom: viewState.zoom,
          selected: selectedEntries.length,
          levels: selectionResult.diagnostics.selectedLevels,
          reasons: selectionResult.diagnostics.reasonCounts,
        });
      }

      const scheduler = schedulerRef.current;
      scheduler?.setDesiredNodes(selectedEntries);
      scheduler?.tick();

      const schedulerStats = scheduler?.stats();
      updateRuntimeStats({
        selectedNodes: selectionResult.diagnostics.selectedCount,
        visiblePoints: selectionResult.diagnostics.visiblePoints,
        lastSelectionUpdateMs: Math.round(performance.now() - selectionStart),
        queuedRequests: schedulerStats?.queued ?? 0,
        inFlightRequests: schedulerStats?.inFlight ?? 0,
        isInteracting,
        targetVisiblePoints: effectiveTargetVisiblePoints,
      });

      if (!schedulerStats || selectedEntries.length === 0) {
        dispatch({ type: "set-status", status: "ready", error: null });
      } else if (schedulerStats.queued > 0 || schedulerStats.inFlight > 0) {
        dispatch({ type: "set-status", status: "loading", error: null });
      } else {
        dispatch({ type: "set-status", status: "ready", error: null });
      }
    }, selectionBudgets.viewDebounceMs);

    return () => {
      if (selectionTimerRef.current !== null) {
        window.clearTimeout(selectionTimerRef.current);
      }
    };
  }, [
    manifest,
    hierarchyPage,
    viewState,
    viewportSize,
    orbitViewport,
    dispatch,
    selectionBudgets,
    isInteracting,
    effectiveTargetVisiblePoints,
    updateRenderDataFromCache,
    updateRuntimeStats,
  ]);

  const handleHover = useCallback(
    (tile: TileRenderData, info: PickingInfo) => {
      if (info.index === undefined || info.index < 0) {
        dispatch({ type: "set-hover", hover: null });
        return;
      }

      const worldPosition = getWorldPosition(tile, info.index);
      const color = tile.colors
        ? getColor(tile.colors, info.index)
        : undefined;

      dispatch({
        type: "set-hover",
        hover: {
          screen: { x: info.x ?? 0, y: info.y ?? 0 },
          tileId: tile.id,
          nodeId: tile.nodeId,
          indexWithinTile: info.index,
          worldPosition,
          color,
        },
      });
    },
    [dispatch]
  );

  const handleClick = useCallback(
    (tile: TileRenderData, info: PickingInfo) => {
      if (info.index === undefined || info.index < 0) {
        dispatch({ type: "set-selection", selection: null });
        return;
      }

      const worldPosition = getWorldPosition(tile, info.index);
      const color = tile.colors
        ? getColor(tile.colors, info.index)
        : undefined;

      dispatch({
        type: "set-selection",
        selection: {
          tileId: tile.id,
          nodeId: tile.nodeId,
          indexWithinTile: info.index,
          worldPosition,
          color,
        },
      });
    },
    [dispatch]
  );

  const layers = useMemo(() => {
    const baseLayers =
      renderData && showPointCloud
        ? renderData.tiles.map((tile) => {
            const layerKey = tile.nodeId
              ? nodeKey(tile.nodeId)
              : tile.id;
            const layerId = `pointcloud-${activeDatasetId}-${layerKey}`;
            return createPointCloudLayer(
              tile,
              {
                onHover: (info) => handleHover(tile, info),
                onClick: (info) => handleClick(tile, info),
              },
              {
                id: layerId,
                pickable: !isInteracting,
                autoHighlight: !isInteracting,
                pointSize: isInteracting ? 1 : 2,
              }
            );
          })
        : [];
    const patchLayers = createPatchLayers(patches, editMode);
    return [...baseLayers, ...patchLayers];
  }, [
    renderData,
    showPointCloud,
    handleHover,
    handleClick,
    patches,
    editMode,
    activeDatasetId,
    isInteracting,
  ]);

  return (
    <div className="viewer-root" ref={containerRef}>
      <DeckGL
        views={new OrbitView()}
        controller={{ type: OrbitController }}
        viewState={viewState}
        layers={layers}
        onInteractionStateChange={(interactionState) => {
          const active =
            interactionState.isDragging ||
            interactionState.isZooming ||
            interactionState.isPanning ||
            interactionState.isRotating;
          if (active) {
            setInteracting(true);
            if (interactionIdleTimerRef.current !== null) {
              window.clearTimeout(interactionIdleTimerRef.current);
              interactionIdleTimerRef.current = null;
            }
          } else {
            if (interactionIdleTimerRef.current !== null) {
              window.clearTimeout(interactionIdleTimerRef.current);
            }
            interactionIdleTimerRef.current = window.setTimeout(() => {
              setInteracting(false);
              interactionIdleTimerRef.current = null;
            }, budgetsRef.current.interactionIdleMs);
          }
        }}
        onViewStateChange={({ viewState: nextViewState }) => {
          if (idleTimerRef.current !== null) {
            window.clearTimeout(idleTimerRef.current);
          }
          idleTimerRef.current = window.setTimeout(() => {
            requestPrefetch();
          }, 300);
          dispatch({
            type: "set-view-state",
            viewState: {
              target: [
                nextViewState.target?.[0] ?? 0,
                nextViewState.target?.[1] ?? 0,
                nextViewState.target?.[2] ?? 0,
              ],
              zoom: nextViewState.zoom ?? 0,
              rotationX: nextViewState.rotationX ?? 0,
              rotationOrbit: nextViewState.rotationOrbit ?? 0,
            },
          });
        }}
      />
      {state.hover && (
        <div
          className="viewer-tooltip"
          style={{
            left: state.hover.screen.x + 12,
            top: state.hover.screen.y + 12,
          }}
        >
          <div>Tile: {state.hover.tileId}</div>
          <div>Index: {state.hover.indexWithinTile}</div>
          <div>
            Pos:{" "}
            {state.hover.worldPosition
              .map((value) => value.toFixed(2))
              .join(", ")}
          </div>
          {state.hover.nodeId !== undefined && (
            <div>Node: {state.hover.nodeId.toString()}</div>
          )}
          {state.hover.color && (
            <div>
              Color: {state.hover.color.map((value) => Math.round(value)).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
