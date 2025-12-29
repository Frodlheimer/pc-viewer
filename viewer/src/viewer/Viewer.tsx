import {
  OrbitController,
  OrbitView,
  OrbitViewport,
  type PickingInfo,
} from "@deck.gl/core";
import DeckGL, { type DeckGLRef } from "@deck.gl/react";
import { LineLayer } from "@deck.gl/layers";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPointCloudLayer } from "../layers/PointCloudLayerFactory";
import { createPatchLayers } from "../layers/PatchLayersFactory";
import { getRuntimeBudgets } from "../config/budgets";
import { createHierarchyPager, type HierarchyPager, type HierarchyPagerUpdate } from "../io/HierarchyPager";
import { loadManifest } from "../io/ManifestLoader";
import { selectNodes, type SelectedNode } from "../io/NodeSelector";
import { getRangeWindowStats } from "../io/RangeFetch";
import { LoadScheduler } from "../io/LoadScheduler";
import { TileService } from "../io/TileService";
import { loadRenderData } from "../io/TileManager";
import { useAppStore } from "../state/store";
import type { RuntimeStats, SelectionItem } from "../state/store";
import type { BoundsQuantization, DatasetManifest } from "../types/Dataset";
import type { NodeRecord } from "../types/Hierarchy";
import { getDatasetById } from "../types/Dataset";
import type { Vec3 } from "../types/Point";
import type { RenderData, TileRenderData } from "../types/Tile";
import { getBoundsCenter } from "../utils/bounds";
import { keyFromNodeId, keyFromTile } from "../utils/nodeKey";
import { applyDeletesToVisibilityMask } from "../utils/visibilityMask";
import { useRectangleSelection } from "./hooks/useRectangleSelection";

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
  roots: NodeRecord[];
};

const buildHierarchyIndex = (nodes: NodeRecord[]): HierarchyIndex => {
  const nodeById = new Map<string, NodeRecord>();
  const childrenByParent = new Map<string, NodeRecord[]>();
  nodes.forEach((node) => nodeById.set(keyFromNodeId(node.nodeId), node));
  nodes.forEach((node) => {
    const parentKey = keyFromNodeId(node.parentId);
    if (nodeById.has(parentKey) && parentKey !== keyFromNodeId(node.nodeId)) {
      const list = childrenByParent.get(parentKey) ?? [];
      list.push(node);
      childrenByParent.set(parentKey, list);
    }
  });
  const roots = nodes.filter((node) => {
    const parentKey = keyFromNodeId(node.parentId);
    return !nodeById.has(parentKey) || parentKey === keyFromNodeId(node.nodeId);
  });
  return { nodeById, childrenByParent, roots };
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
    measurement,
    deleteSelectionRequestId,
  } = state;
  const [manifestState, setManifestState] = useState<{
    datasetId: string;
    manifest: DatasetManifest;
  } | null>(null);
  const [hierarchyState, setHierarchyState] = useState<{
    datasetId: string;
    update: HierarchyPagerUpdate;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const deckRef = useRef<DeckGLRef | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const tileServiceRef = useRef<TileService>(new TileService());
  const schedulerRef = useRef<LoadScheduler | null>(null);
  const hierarchyPagerRef = useRef<HierarchyPager | null>(null);
  const hierarchyIndexRef = useRef<HierarchyIndex | null>(null);
  const hierarchyLoadInFlightRef = useRef(false);
  const manifestRef = useRef<DatasetManifest | null>(null);
  const desiredEntriesRef = useRef<SelectedNode[]>([]);
  const desiredKeysRef = useRef<Set<string>>(new Set());
  const retainedNodesRef = useRef<Map<string, NodeRecord>>(new Map());
  const lastNonEmptyTilesRef = useRef<TileRenderData[]>([]);
  const renderDataRef = useRef<RenderData | null>(null);
  const zeroTileWarningsRef = useRef(0);
  const lastRenderKeyRef = useRef<string | null>(null);
  const previousSelectionRef = useRef<Set<string>>(new Set());
  const selectionTimerRef = useRef<number | null>(null);
  const datasetLoadIdRef = useRef(0);
  const idleTimerRef = useRef<number | null>(null);
  const interactionIdleTimerRef = useRef<number | null>(null);
  const lastInteractionAtRef = useRef<number | null>(null);
  const lastInteractionStatsAtRef = useRef(0);
  const isInteractingRef = useRef(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const budgets = useMemo(
    () => getRuntimeBudgets(settings.performanceProfile),
    [settings.performanceProfile]
  );
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    (window as { __tileService?: TileService }).__tileService =
      tileServiceRef.current;
  }, []);
  const deckViews = useMemo(() => new OrbitView(), []);
  const deckController = useMemo(() => ({ type: OrbitController }), []);
  const budgetsRef = useRef(budgets);
  const manifest =
    manifestState?.datasetId === activeDatasetId
      ? manifestState.manifest
      : null;
  const hierarchy =
    hierarchyState?.datasetId === activeDatasetId ? hierarchyState.update : null;

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
    tileServiceRef.current.setProfile(budgets.profile);
  }, [budgets]);

  useEffect(() => {
    manifestRef.current = manifest;
  }, [manifest]);

  useEffect(() => {
    renderDataRef.current = renderData;
  }, [renderData]);

  const pointLayerIds = useMemo(() => {
    if (!renderData) {
      return [];
    }
    return renderData.tiles.map(
      (tile) => `${activeDatasetId}:${keyFromTile(tile)}`
    );
  }, [renderData, activeDatasetId]);

  const tileByLayerId = useMemo(() => {
    const map = new Map<string, TileRenderData>();
    if (!renderData) {
      return map;
    }
    renderData.tiles.forEach((tile) => {
      map.set(`${activeDatasetId}:${keyFromTile(tile)}`, tile);
    });
    return map;
  }, [renderData, activeDatasetId]);

  const tileByKey = useMemo(() => {
    const map = new Map<string, TileRenderData>();
    if (!renderData) {
      return map;
    }
    renderData.tiles.forEach((tile) => {
      map.set(keyFromTile(tile), tile);
    });
    return map;
  }, [renderData]);

  const modelMatrixByKey = useMemo(() => {
    const map = new Map<string, Float64Array>();
    if (!renderData) {
      return map;
    }
    renderData.tiles.forEach((tile) => {
      if (!tile.origin) {
        return;
      }
      map.set(
        keyFromTile(tile),
        new Float64Array([
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          tile.origin[0], tile.origin[1], tile.origin[2], 1,
        ])
      );
    });
    return map;
  }, [renderData]);

  const buildSelectionItem = useCallback(
    (
      tile: TileRenderData,
      index: number,
      coordinate?: number[] | null
    ): SelectionItem => {
      const nodeKey =
        tile.nodeId !== undefined ? keyFromNodeId(tile.nodeId) : keyFromTile(tile);
      const worldPos: Vec3 =
        coordinate && coordinate.length >= 3
          ? [coordinate[0], coordinate[1], coordinate[2]]
          : getWorldPosition(tile, index);
      return {
        nodeId: nodeKey,
        index,
        worldPos,
        tileKey: keyFromTile(tile),
      };
    },
    []
  );

  const handleSelectionChange = useCallback(
    (items: SelectionItem[]) => {
      dispatch({ type: "set-selection", selection: { items } });
    },
    [dispatch]
  );

  const { selectionRect, handlers: selectionHandlers } = useRectangleSelection({
    editMode,
    containerRef,
    deckRef,
    pointLayerIds,
    tileByLayerId,
    buildSelectionItem,
    onSelectionChange: handleSelectionChange,
  });

  const applyDeleteItems = useCallback(
    (items: SelectionItem[]) => {
      if (items.length === 0) {
        return;
      }
      const grouped = new Map<
        string,
        { tile: TileRenderData; indices: Set<number> }
      >();
      items.forEach((item) => {
        const tileKey = item.tileKey ?? item.nodeId;
        const tile = tileByKey.get(tileKey);
        if (!tile) {
          return;
        }
        if (item.index < 0 || item.index >= tile.pointCount) {
          return;
        }
        const entry = grouped.get(tileKey) ?? {
          tile,
          indices: new Set<number>(),
        };
        entry.indices.add(item.index);
        grouped.set(tileKey, entry);
      });

      if (grouped.size === 0) {
        return;
      }

      const nextDeleted = new Map(patches.deleted);
      const nextVersions = new Map(patches.deletedVersions);
      let updated = false;
      grouped.forEach((entry, tileKey) => {
        const current = nextDeleted.get(tileKey);
        const { mask, deletedDelta } = applyDeletesToVisibilityMask(
          current,
          entry.tile.pointCount,
          entry.indices
        );
        if (deletedDelta === 0) {
          return;
        }
        const view = mask;
        nextDeleted.set(tileKey, mask);
        nextVersions.set(tileKey, (nextVersions.get(tileKey) ?? 0) + 1);
        updated = true;

        if (settings.debugEnabled) {
          let deletedCount = 0;
          for (let i = 0; i < view.length; i += 1) {
            if (view[i] === 0) {
              deletedCount += 1;
            }
          }
          console.info("[delete] visibility mask updated", {
            tileKey,
            pointCount: view.length,
            deletedDelta,
            deletedCount,
            sample: {
              first: view[0],
              middle: view[Math.floor(view.length / 2)],
              last: view[view.length - 1],
            },
          });
          if (deletedCount === view.length && deletedDelta < view.length) {
            console.warn("[delete] visibilityMask all zeros", {
              tileKey,
              deletedCount,
              pointCount: view.length,
            });
          }
        }
      });

      if (updated) {
        dispatch({
          type: "set-deleted-masks",
          deleted: nextDeleted,
          deletedVersions: nextVersions,
        });
      }
    },
    [
      dispatch,
      patches.deleted,
      patches.deletedVersions,
      settings.debugEnabled,
      tileByKey,
    ]
  );

  useEffect(() => {
    hierarchyIndexRef.current = hierarchy
      ? buildHierarchyIndex(hierarchy.records)
      : null;
  }, [hierarchy]);

  const updateRenderDataFromCache = useCallback(() => {
    const activeManifest = manifestRef.current;
    if (!activeManifest) {
      return;
    }
    const tiles: TileRenderData[] = [];
    const fallbackTiles = new Map(
      lastNonEmptyTilesRef.current.map((tile) => [keyFromTile(tile), tile])
    );
    retainedNodesRef.current.forEach((_node, key) => {
      const tile = tileServiceRef.current.getCachedTile(key);
      if (tile) {
        tiles.push(tile);
        return;
      }
      const fallback = fallbackTiles.get(key);
      if (fallback) {
        tiles.push(fallback);
      }
    });
    if (tiles.length === 0) {
      if (retainedNodesRef.current.size > 0) {
        zeroTileWarningsRef.current += 1;
      }
      if (
        !renderDataRef.current &&
        lastNonEmptyTilesRef.current.length > 0
      ) {
        const fallbackTiles = lastNonEmptyTilesRef.current;
        const tileIds = fallbackTiles.map((tile) => tile.id).sort();
        const renderKey = `${activeManifest.id}:${tileIds.join("|")}`;
        if (renderKey !== lastRenderKeyRef.current) {
          lastRenderKeyRef.current = renderKey;
          dispatch({
            type: "set-render-data",
            renderData: buildRenderData(activeManifest, fallbackTiles),
          });
        }
      }
      return;
    }
    lastNonEmptyTilesRef.current = tiles;
    const tileIds = tiles.map((tile) => tile.id).sort();
    const renderKey = `${activeManifest.id}:${tileIds.join("|")}`;
    if (renderKey === lastRenderKeyRef.current) {
      return;
    }
    lastRenderKeyRef.current = renderKey;
    dispatch({
      type: "set-render-data",
      renderData: buildRenderData(activeManifest, tiles),
    });
  }, [dispatch]);

  const getRetainedSummary = useCallback(() => {
    let retainedPoints = 0;
    retainedNodesRef.current.forEach((node) => {
      retainedPoints += node.pointCount;
    });
    return {
      retainedNodes: retainedNodesRef.current.size,
      retainedPoints,
    };
  }, []);

  const getLastInteractionMs = useCallback(() => {
    const last = lastInteractionAtRef.current;
    if (last === null) {
      return null;
    }
    return Math.max(0, Math.round(performance.now() - last));
  }, []);

  const getRenderStats = useCallback(() => {
    const renderedTiles =
      renderDataRef.current?.tiles.length ?? lastNonEmptyTilesRef.current.length;
    return {
      renderedTiles,
      lastNonEmptyTiles: lastNonEmptyTilesRef.current.length,
      zeroTileWarnings: zeroTileWarningsRef.current,
    };
  }, []);

  const addLoadedDesiredToRetained = useCallback((): boolean => {
    let changed = false;
    desiredEntriesRef.current.forEach((entry) => {
      const key = keyFromNodeId(entry.node.nodeId);
      if (!tileServiceRef.current.has(key)) {
        return;
      }
      if (!retainedNodesRef.current.has(key)) {
        retainedNodesRef.current.set(key, entry.node);
        tileServiceRef.current.pin(key);
        changed = true;
      }
    });
    return changed;
  }, []);

  const shouldKeepParent = useCallback(
    (parentKey: string, desiredKeys: Set<string>) => {
      const hierarchyIndex = hierarchyIndexRef.current;
      if (!hierarchyIndex) {
        return false;
      }
      const children = hierarchyIndex.childrenByParent.get(parentKey) ?? [];
      if (children.length === 0) {
        return false;
      }
      const desiredChildren = children.filter((child) =>
        desiredKeys.has(keyFromNodeId(child.nodeId))
      );
      if (desiredChildren.length === 0) {
        return false;
      }
      const anyLoadedChild = desiredChildren.some((child) =>
        tileServiceRef.current.has(keyFromNodeId(child.nodeId))
      );
      return !anyLoadedChild;
    },
    []
  );

  const pruneRetainedNodes = useCallback(
    (desiredKeys: Set<string>) => {
      const now = performance.now();
      const lastInteractionAt = lastInteractionAtRef.current;
      if (
        lastInteractionAt !== null &&
        now - lastInteractionAt < budgetsRef.current.minIdleStableMs
      ) {
        return false;
      }

      const retainedNodes = retainedNodesRef.current;
      const hasDesiredRetained = Array.from(retainedNodes.keys()).some((key) =>
        desiredKeys.has(key)
      );
      if (!hasDesiredRetained && desiredKeys.size > 0) {
        return false;
      }
      const candidates: string[] = [];
      retainedNodes.forEach((_node, key) => {
        if (desiredKeys.has(key)) {
          return;
        }
        if (shouldKeepParent(key, desiredKeys)) {
          return;
        }
        candidates.push(key);
      });

      if (candidates.length === 0) {
        return false;
      }

      let retainedPoints = 0;
      retainedNodes.forEach((node) => {
        retainedPoints += node.pointCount;
      });
      const minRetained =
        desiredKeys.size === 0
          ? 0
          : budgetsRef.current.minRetainedPointsInteract;
      const maxRemovals = Math.max(1, Math.floor(retainedNodes.size * 0.25));
      let removed = 0;
      for (let i = 0; i < candidates.length && removed < maxRemovals; i += 1) {
        const key = candidates[i];
        const node = retainedNodes.get(key);
        if (!node) {
          continue;
        }
        if (retainedPoints - node.pointCount < minRetained) {
          continue;
        }
        retainedNodes.delete(key);
        tileServiceRef.current.unpin(key);
        retainedPoints -= node.pointCount;
        removed += 1;
      }

      return removed > 0;
    },
    [shouldKeepParent]
  );

  const syncRetainedNodes = useCallback(
    (options: { allowPrune: boolean }) => {
      let changed = addLoadedDesiredToRetained();
      if (options.allowPrune && !isInteractingRef.current) {
        if (pruneRetainedNodes(desiredKeysRef.current)) {
          changed = true;
        }
      }
      return changed;
    },
    [addLoadedDesiredToRetained, pruneRetainedNodes]
  );

  const setInteracting = useCallback((next: boolean) => {
    if (isInteractingRef.current === next) {
      return;
    }
    if (next) {
      lastInteractionAtRef.current = performance.now();
    }
    isInteractingRef.current = next;
    setIsInteracting(next);
  }, []);

  const updateRuntimeStats = useCallback(
    (overrides: Partial<RuntimeStats> = {}) => {
      const cacheStats = tileServiceRef.current.stats();
      const schedulerStats = schedulerRef.current?.stats();
      const rangeStats = getRangeWindowStats();
      const retainedSummary = getRetainedSummary();
      const renderStats = getRenderStats();
      const hierarchySnapshot = hierarchyPagerRef.current?.snapshot();
      dispatch({
        type: "set-runtime-stats",
        stats: {
          desiredNodes: desiredEntriesRef.current.length,
          loadedTiles: cacheStats.items,
          renderedTiles: renderStats.renderedTiles,
          lastNonEmptyTiles: renderStats.lastNonEmptyTiles,
          zeroTileWarnings: renderStats.zeroTileWarnings,
          cpuCacheBytes: cacheStats.bytes,
          cacheUniqueBuffers: cacheStats.uniqueBuffers,
          pinnedTiles: cacheStats.pinnedItems,
          pinnedBytes: cacheStats.pinnedBytes,
          rawBufferRetainedCount: cacheStats.rawBufferRetainedCount,
          optionalAttrsDecodedCount: cacheStats.optionalAttrsDecodedCount,
          rawBufferDroppedOnPressureCount:
            cacheStats.rawBufferDroppedOnPressureCount,
          rawBufferBytesDropped: cacheStats.rawBufferBytesDropped,
          retainedNodes: retainedSummary.retainedNodes,
          retainedPoints: retainedSummary.retainedPoints,
          inFlightRequests: schedulerStats?.inFlight ?? cacheStats.inFlight,
          queuedRequests: schedulerStats?.queued ?? 0,
          schedulerCanceled: schedulerStats?.canceled ?? 0,
          hierarchyPagesLoaded: hierarchySnapshot?.pagesLoaded ?? 0,
          hierarchyInFlight: hierarchySnapshot?.inFlight ?? 0,
          hierarchyEof: hierarchySnapshot?.eof ?? false,
          rangeCache: rangeStats,
          lastInteractionMs: getLastInteractionMs(),
          isInteracting,
          targetVisiblePoints: effectiveTargetVisiblePoints,
          ...overrides,
        },
      });
    },
    [
      dispatch,
      isInteracting,
      effectiveTargetVisiblePoints,
      getLastInteractionMs,
      getRetainedSummary,
      getRenderStats,
    ]
  );

  const noteInteraction = useCallback(() => {
    const now = performance.now();
    lastInteractionAtRef.current = now;
    if (interactionIdleTimerRef.current !== null) {
      window.clearTimeout(interactionIdleTimerRef.current);
    }
    interactionIdleTimerRef.current = window.setTimeout(() => {
      setInteracting(false);
      interactionIdleTimerRef.current = null;
    }, budgetsRef.current.interactionIdleMs);
    setInteracting(true);
    if (now - lastInteractionStatsAtRef.current >= 100) {
      lastInteractionStatsAtRef.current = now;
      updateRuntimeStats({ lastInteractionMs: 0, isInteracting: true });
    }
  }, [setInteracting, updateRuntimeStats]);

  useEffect(() => {
    if (deleteSelectionRequestId === 0) {
      return;
    }
    if (editMode !== "delete") {
      return;
    }
    applyDeleteItems(state.selection.items);
  }, [applyDeleteItems, deleteSelectionRequestId, editMode, state.selection.items]);

  const handleTileLoaded = useCallback(() => {
    syncRetainedNodes({ allowPrune: true });
    updateRenderDataFromCache();
    updateRuntimeStats();
    const schedulerStats = schedulerRef.current?.stats();
    if (schedulerStats) {
      const status =
        schedulerStats.queued === 0 && schedulerStats.inFlight === 0
          ? "ready"
          : "loading";
      dispatch({ type: "set-status", status, error: null });
    }
  }, [dispatch, syncRetainedNodes, updateRenderDataFromCache, updateRuntimeStats]);

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

  useEffect(() => {
    if (!manifest?.hierarchyUrl || !hierarchy) {
      return;
    }
    if (isInteracting) {
      return;
    }
    const changed = syncRetainedNodes({ allowPrune: true });
    if (changed) {
      updateRenderDataFromCache();
    }
    updateRuntimeStats();
  }, [
    isInteracting,
    manifest,
    hierarchy,
    syncRetainedNodes,
    updateRenderDataFromCache,
    updateRuntimeStats,
  ]);

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
    const desiredEntries = desiredEntriesRef.current;
    if (desiredEntries.length === 0) {
      return;
    }
    const desiredKeys = desiredKeysRef.current;
    const candidates = new Map<string, NodeRecord>();
    for (const entry of desiredEntries) {
      const parentKey = keyFromNodeId(entry.node.parentId);
      const siblings = hierarchyIndex.childrenByParent.get(parentKey) ?? [];
      for (const sibling of siblings) {
        const key = keyFromNodeId(sibling.nodeId);
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

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    const dataset = getDatasetById(activeDatasetId);
    datasetLoadIdRef.current += 1;
    const loadId = datasetLoadIdRef.current;
    const initialTargetVisiblePoints = budgetsRef.current.targetVisiblePoints;
    tileServiceRef.current.clear();
    schedulerRef.current?.clear();
    hierarchyPagerRef.current = null;
    hierarchyLoadInFlightRef.current = false;
    window.setTimeout(() => setHierarchyState(null), 0);
    desiredEntriesRef.current = [];
    desiredKeysRef.current = new Set();
    retainedNodesRef.current = new Map();
    lastNonEmptyTilesRef.current = [];
    zeroTileWarningsRef.current = 0;
    lastRenderKeyRef.current = null;
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
    lastInteractionAtRef.current = null;
    window.setTimeout(() => setIsInteracting(false), 0);
    dispatch({
      type: "set-runtime-stats",
      stats: {
        desiredNodes: 0,
        selectedNodes: 0,
        retainedNodes: 0,
        retainedPoints: 0,
        visiblePoints: 0,
        loadedTiles: 0,
        renderedTiles: 0,
        lastNonEmptyTiles: 0,
        zeroTileWarnings: 0,
        cpuCacheBytes: 0,
        cacheUniqueBuffers: 0,
        pinnedTiles: 0,
        pinnedBytes: 0,
        inFlightRequests: 0,
        queuedRequests: 0,
        schedulerCanceled: 0,
        rawBufferRetainedCount: 0,
        optionalAttrsDecodedCount: 0,
        rawBufferDroppedOnPressureCount: 0,
        rawBufferBytesDropped: 0,
        lastSelectionUpdateMs: null,
        lastInteractionMs: null,
        isInteracting: false,
        targetVisiblePoints: initialTargetVisiblePoints,
        hierarchyPagesLoaded: 0,
        hierarchyInFlight: 0,
        hierarchyEof: false,
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
          const pager = createHierarchyPager({
            url: loadedManifest.hierarchyUrl,
            pageBytes: loadedManifest.hierarchyPageBytes,
            signal: abort.signal,
          });
          hierarchyPagerRef.current = pager;
          const update = await pager.init();
          if (cancelled || datasetLoadIdRef.current !== loadId) return;
          setHierarchyState({ datasetId: activeDatasetId, update });
          return;
        }

        const data = await loadRenderData(loadedManifest);
        if (cancelled || datasetLoadIdRef.current !== loadId) return;
        dispatch({ type: "set-render-data", renderData: data });
        lastNonEmptyTilesRef.current = data.tiles;
        zeroTileWarningsRef.current = 0;
        dispatch({ type: "set-status", status: "ready", error: null });
        dispatch({
          type: "set-runtime-stats",
          stats: {
            desiredNodes: data.tiles.length,
            selectedNodes: data.tiles.length,
            retainedNodes: data.tiles.length,
            retainedPoints: data.pointCountTotal,
            visiblePoints: data.pointCountTotal,
            loadedTiles: data.tiles.length,
            renderedTiles: data.tiles.length,
            lastNonEmptyTiles: data.tiles.length,
            zeroTileWarnings: 0,
            cpuCacheBytes: data.tiles.reduce(
              (sum, tile) =>
                sum +
                tile.positions.byteLength +
                (tile.colors?.byteLength ?? 0),
              0
            ),
            cacheUniqueBuffers: 0,
            pinnedTiles: 0,
            pinnedBytes: 0,
            inFlightRequests: 0,
            queuedRequests: 0,
            schedulerCanceled: 0,
            rawBufferRetainedCount: 0,
            optionalAttrsDecodedCount: 0,
            rawBufferDroppedOnPressureCount: 0,
            rawBufferBytesDropped: 0,
            lastSelectionUpdateMs: 0,
            lastInteractionMs:
              lastInteractionAtRef.current === null
                ? null
                : Math.max(
                    0,
                    Math.round(
                      performance.now() - lastInteractionAtRef.current
                    )
                  ),
            isInteracting: isInteractingRef.current,
            targetVisiblePoints: initialTargetVisiblePoints,
            hierarchyPagesLoaded: 0,
            hierarchyInFlight: 0,
            hierarchyEof: false,
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
      abort.abort();
    };
  }, [activeDatasetId, dispatch]);

  useEffect(() => {
    if (!manifest?.hierarchyUrl || !hierarchy) {
      return;
    }

    if (selectionTimerRef.current !== null) {
      window.clearTimeout(selectionTimerRef.current);
    }

    selectionTimerRef.current = window.setTimeout(() => {
      const selectionStart = performance.now();
      const hierarchyIndex = hierarchyIndexRef.current ?? undefined;
      const selectionResult = selectNodes({
        viewport: orbitViewport,
        width: viewportSize.width,
        height: viewportSize.height,
        nodes: hierarchy.records,
        hierarchyIndex,
        boundsQuantization: manifest.boundsQuantization,
        runtimeBudgets: selectionBudgets,
        previousSelection: previousSelectionRef.current,
        keepCoarseNodes: isInteractingRef.current,
      });
      const desiredEntries = selectionResult.selected;
      desiredEntriesRef.current = desiredEntries;
      const nextDesiredKeys = new Set(
        desiredEntries.map((entry) => keyFromNodeId(entry.node.nodeId))
      );
      const previousKeys = desiredKeysRef.current;
      desiredKeysRef.current = nextDesiredKeys;
      previousSelectionRef.current = nextDesiredKeys;

      previousKeys.forEach((key) => {
        if (!nextDesiredKeys.has(key)) {
          tileServiceRef.current.cancelTile(key);
        }
      });

      syncRetainedNodes({ allowPrune: true });
      updateRenderDataFromCache();

      if (import.meta.env.DEV) {
        console.info("[hierarchy] node selection", {
          zoom: viewState.zoom,
          selected: desiredEntries.length,
          levels: selectionResult.diagnostics.selectedLevels,
          missingChildren: selectionResult.diagnostics.missingChildrenCount,
          reasons: selectionResult.diagnostics.reasonCounts,
        });
      }

      const pager = hierarchyPagerRef.current;
      if (
        pager &&
        selectionResult.diagnostics.missingChildrenCount > 0 &&
        !pager.snapshot().eof &&
        !hierarchyLoadInFlightRef.current
      ) {
        hierarchyLoadInFlightRef.current = true;
        pager
          .loadNextPages(2)
          .then((update) => {
            setHierarchyState({ datasetId: activeDatasetId, update });
          })
          .catch((error: unknown) => {
            if (error instanceof Error && error.name === "AbortError") {
              return;
            }
            console.error("[hierarchy] page load failed", { error });
          })
          .finally(() => {
            hierarchyLoadInFlightRef.current = false;
          });
      }

      const scheduler = schedulerRef.current;
      scheduler?.setDesiredNodes(desiredEntries);
      scheduler?.tick();

      const schedulerStats = scheduler?.stats();
      updateRuntimeStats({
        desiredNodes: desiredEntries.length,
        selectedNodes: selectionResult.diagnostics.selectedCount,
        ...getRetainedSummary(),
        visiblePoints: selectionResult.diagnostics.visiblePoints,
        lastSelectionUpdateMs: Math.round(performance.now() - selectionStart),
        queuedRequests: schedulerStats?.queued ?? 0,
        inFlightRequests: schedulerStats?.inFlight ?? 0,
        isInteracting,
        targetVisiblePoints: effectiveTargetVisiblePoints,
      });

      if (!schedulerStats || desiredEntries.length === 0) {
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
    activeDatasetId,
    manifest,
    hierarchy,
    viewState,
    viewportSize,
    orbitViewport,
    dispatch,
    selectionBudgets,
    isInteracting,
    effectiveTargetVisiblePoints,
    updateRenderDataFromCache,
    updateRuntimeStats,
    syncRetainedNodes,
    getRetainedSummary,
  ]);

  const handleHover = useCallback(
    (tile: TileRenderData, info: PickingInfo, event?: unknown) => {
      void event;
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
    (tile: TileRenderData, info: PickingInfo, event?: unknown) => {
      void event;
      if (info.index === undefined || info.index < 0) {
        return;
      }
      const item = buildSelectionItem(
        tile,
        info.index,
        Array.isArray(info.coordinate) ? info.coordinate : null
      );
      if (editMode === "delete") {
        applyDeleteItems([item]);
        return;
      }
      if (editMode === "select") {
        dispatch({ type: "set-selection", selection: { items: [item] } });
        return;
      }

      if (editMode === "measure") {
        if (!measurement.a) {
          dispatch({ type: "set-measurement", measurement: { a: item } });
          return;
        }
        if (measurement.a && measurement.b) {
          dispatch({ type: "set-measurement", measurement: { a: item } });
          return;
        }
        const dx = measurement.a.worldPos[0] - item.worldPos[0];
        const dy = measurement.a.worldPos[1] - item.worldPos[1];
        const dz = measurement.a.worldPos[2] - item.worldPos[2];
        const distance = Math.hypot(dx, dy, dz);
        dispatch({
          type: "set-measurement",
          measurement: { a: measurement.a, b: item, distance },
        });
      }
    },
    [applyDeleteItems, buildSelectionItem, dispatch, editMode, measurement]
  );

  const forcePicking =
    editMode === "select" ||
    editMode === "measure" ||
    editMode === "delete" ||
    editMode === "update";

  const baseLayers = useMemo(() => {
    if (!renderData || !showPointCloud) {
      return [];
    }
    return renderData.tiles.map((tile) => {
      const layerKey = keyFromTile(tile);
      const layerId = `${activeDatasetId}:${layerKey}`;
      const pickable = forcePicking ? true : !isInteracting;
      const autoHighlight = forcePicking ? false : !isInteracting;
      const pointSize = isInteracting ? 1 : 2;
      const modelMatrix = modelMatrixByKey.get(layerKey);
      const filterValues = patches.deleted.get(layerKey);
      const filterVersion = patches.deletedVersions.get(layerKey);
      return createPointCloudLayer(
        tile,
        {
          onHover: (info, event) => handleHover(tile, info, event),
          onClick: (info, event) => handleClick(tile, info, event),
        },
        {
          id: layerId,
          pickable,
          autoHighlight,
          pointSize,
          modelMatrix,
          filterValues,
          filterVersion,
        }
      );
    });
  }, [
    renderData,
    showPointCloud,
    activeDatasetId,
    handleHover,
    handleClick,
    forcePicking,
    isInteracting,
    patches.deleted,
    patches.deletedVersions,
    modelMatrixByKey,
  ]);

  const patchLayers = useMemo(
    () => createPatchLayers(patches, editMode),
    [patches, editMode]
  );

  const measurementLayer = useMemo(() => {
    if (!measurement.a || !measurement.b) {
      return null;
    }
    return new LineLayer({
      id: `${activeDatasetId}:measure-line`,
      data: [
        {
          sourcePosition: measurement.a.worldPos,
          targetPosition: measurement.b.worldPos,
        },
      ],
      getSourcePosition: (d) => d.sourcePosition,
      getTargetPosition: (d) => d.targetPosition,
      getColor: [255, 203, 88],
      getWidth: 2,
      widthUnits: "pixels",
    });
  }, [measurement, activeDatasetId]);

  const layers = useMemo(() => {
    return [
      ...baseLayers,
      ...patchLayers,
      ...(measurementLayer ? [measurementLayer] : []),
    ];
  }, [baseLayers, patchLayers, measurementLayer]);

  const handleInteractionStateChange = useCallback(
    (interactionState: {
      isDragging?: boolean;
      isZooming?: boolean;
      isPanning?: boolean;
      isRotating?: boolean;
    }) => {
      const active =
        interactionState.isDragging ||
        interactionState.isZooming ||
        interactionState.isPanning ||
        interactionState.isRotating;
      if (active) {
        noteInteraction();
        return;
      }
      if (interactionIdleTimerRef.current !== null) {
        window.clearTimeout(interactionIdleTimerRef.current);
      }
      interactionIdleTimerRef.current = window.setTimeout(() => {
        setInteracting(false);
        interactionIdleTimerRef.current = null;
      }, budgetsRef.current.interactionIdleMs);
    },
    [noteInteraction, setInteracting]
  );

  return (
    <div
      className="viewer-root"
      ref={containerRef}
      onMouseDownCapture={selectionHandlers.onMouseDownCapture}
      onMouseMoveCapture={selectionHandlers.onMouseMoveCapture}
      onMouseUpCapture={selectionHandlers.onMouseUpCapture}
      onMouseLeave={selectionHandlers.onMouseLeave}
    >
      <DeckGL
        ref={deckRef}
        views={deckViews}
        controller={deckController}
        viewState={viewState}
        layers={layers}
        onInteractionStateChange={handleInteractionStateChange}
        onViewStateChange={({ viewState: nextViewState }) => {
          noteInteraction();
          if (idleTimerRef.current !== null) {
            window.clearTimeout(idleTimerRef.current);
          }
          idleTimerRef.current = window.setTimeout(() => {
            requestPrefetch();
          }, 300);
          const orbitState = nextViewState as {
            target?: number[];
            zoom?: number;
            rotationX?: number;
            rotationOrbit?: number;
          };
          dispatch({
            type: "set-view-state",
            viewState: {
              target: [
                orbitState.target?.[0] ?? 0,
                orbitState.target?.[1] ?? 0,
                orbitState.target?.[2] ?? 0,
              ],
              zoom: orbitState.zoom ?? 0,
              rotationX: orbitState.rotationX ?? 0,
              rotationOrbit: orbitState.rotationOrbit ?? 0,
            },
          });
        }}
      />
      {selectionRect && (
        <div
          className="selection-rect"
          style={{
            left: selectionRect.x,
            top: selectionRect.y,
            width: selectionRect.width,
            height: selectionRect.height,
          }}
        />
      )}
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
