import { OrbitController, OrbitView, type PickingInfo } from "@deck.gl/core";
import DeckGL from "@deck.gl/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPointCloudLayer } from "../layers/PointCloudLayerFactory";
import { createPatchLayers } from "../layers/PatchLayersFactory";
import { getRuntimeBudgets } from "../config/budgets";
import { loadPage } from "../io/HierarchyPagingLoader";
import { loadManifest } from "../io/ManifestLoader";
import { selectNodes } from "../io/NodeSelector";
import { loadRenderData, loadTilesForNodes } from "../io/TileManager";
import { useAppStore } from "../state/store";
import type { DatasetManifest } from "../types/Dataset";
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
  const tileCacheRef = useRef<Map<string, TileRenderData>>(new Map());
  const loadedNodeIdsRef = useRef<Set<string>>(new Set());
  const selectionTimerRef = useRef<number | null>(null);
  const datasetLoadIdRef = useRef(0);
  const inFlightRequestsRef = useRef(0);
  const budgets = useMemo(
    () => getRuntimeBudgets(settings.performanceProfile),
    [settings.performanceProfile]
  );
  const manifest =
    manifestState?.datasetId === activeDatasetId
      ? manifestState.manifest
      : null;
  const hierarchyPage =
    hierarchyState?.datasetId === activeDatasetId ? hierarchyState.page : null;

  useEffect(() => {
    let cancelled = false;
    const dataset = getDatasetById(activeDatasetId);
    datasetLoadIdRef.current += 1;
    const loadId = datasetLoadIdRef.current;
    tileCacheRef.current = new Map();
    loadedNodeIdsRef.current = new Set();
    inFlightRequestsRef.current = 0;
    if (selectionTimerRef.current !== null) {
      window.clearTimeout(selectionTimerRef.current);
      selectionTimerRef.current = null;
    }
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
        tileCacheRef.current = new Map(
          data.tiles.map((tile) => [tile.id, tile])
        );
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
  }, [activeDatasetId, dispatch]);

  useEffect(() => {
    if (!manifest?.hierarchyUrl || !hierarchyPage) {
      return;
    }

    if (selectionTimerRef.current !== null) {
      window.clearTimeout(selectionTimerRef.current);
    }

    selectionTimerRef.current = window.setTimeout(() => {
      const selectionStart = performance.now();
      const selectedNodes = selectNodes(
        { zoom: viewState.zoom },
        hierarchyPage,
        Math.max(
          1,
          Math.floor(budgets.targetVisiblePoints / budgets.tilePointCap)
        )
      );
      const missingNodes = selectedNodes.filter(
        (node) => !loadedNodeIdsRef.current.has(nodeKey(node.nodeId))
      );
      const selectedPoints = selectedNodes.reduce(
        (sum, node) => sum + node.pointCount,
        0
      );
      const cpuCacheBytes = Array.from(tileCacheRef.current.values()).reduce(
        (sum, tile) =>
          sum +
          tile.positions.byteLength +
          (tile.colors?.byteLength ?? 0),
        0
      );

      if (import.meta.env.DEV) {
        console.info("[hierarchy] node selection", {
          zoom: viewState.zoom,
          selected: selectedNodes.length,
          missing: missingNodes.length,
        });
      }

      dispatch({
        type: "set-runtime-stats",
        stats: {
          selectedNodes: selectedNodes.length,
          visiblePoints: selectedPoints,
          loadedTiles: tileCacheRef.current.size,
          cpuCacheBytes,
          inFlightRequests: inFlightRequestsRef.current,
          queuedRequests: 0,
        },
      });

      if (missingNodes.length === 0) {
        dispatch({
          type: "set-runtime-stats",
          stats: {
            lastSelectionUpdateMs: Math.round(
              performance.now() - selectionStart
            ),
          },
        });
        return;
      }

      const pendingKeys = missingNodes.map((node) => nodeKey(node.nodeId));
      pendingKeys.forEach((key) => loadedNodeIdsRef.current.add(key));

      const loadId = datasetLoadIdRef.current;
      inFlightRequestsRef.current += missingNodes.length;
      dispatch({
        type: "set-runtime-stats",
        stats: { inFlightRequests: inFlightRequestsRef.current },
      });
      if (tileCacheRef.current.size === 0) {
        dispatch({ type: "set-status", status: "loading", error: null });
      }

      loadTilesForNodes(manifest, missingNodes)
        .then((tiles) => {
          if (datasetLoadIdRef.current !== loadId) return;
          tiles.forEach((tile) => tileCacheRef.current.set(tile.id, tile));
          inFlightRequestsRef.current = Math.max(
            0,
            inFlightRequestsRef.current - missingNodes.length
          );
          const merged = buildRenderData(
            manifest,
            Array.from(tileCacheRef.current.values())
          );
          dispatch({ type: "set-render-data", renderData: merged });
          dispatch({ type: "set-status", status: "ready", error: null });
          dispatch({
            type: "set-runtime-stats",
            stats: {
              loadedTiles: tileCacheRef.current.size,
              cpuCacheBytes: Array.from(
                tileCacheRef.current.values()
              ).reduce(
                (sum, tile) =>
                  sum +
                  tile.positions.byteLength +
                  (tile.colors?.byteLength ?? 0),
                0
              ),
              inFlightRequests: inFlightRequestsRef.current,
              lastSelectionUpdateMs: Math.round(
                performance.now() - selectionStart
              ),
            },
          });
        })
        .catch((error: unknown) => {
          if (datasetLoadIdRef.current !== loadId) return;
          pendingKeys.forEach((key) => loadedNodeIdsRef.current.delete(key));
          inFlightRequestsRef.current = Math.max(
            0,
            inFlightRequestsRef.current - missingNodes.length
          );
          const message =
            error instanceof Error ? error.message : "Unknown loading error.";
          dispatch({ type: "set-status", status: "error", error: message });
          dispatch({
            type: "set-runtime-stats",
            stats: {
              inFlightRequests: inFlightRequestsRef.current,
              lastSelectionUpdateMs: Math.round(
                performance.now() - selectionStart
              ),
            },
          });
        });
    }, budgets.viewDebounceMs);

    return () => {
      if (selectionTimerRef.current !== null) {
        window.clearTimeout(selectionTimerRef.current);
      }
    };
  }, [manifest, hierarchyPage, viewState.zoom, dispatch, budgets]);

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
        ? renderData.tiles.map((tile) =>
            createPointCloudLayer(tile, {
              onHover: (info) => handleHover(tile, info),
              onClick: (info) => handleClick(tile, info),
            })
          )
        : [];
    const patchLayers = createPatchLayers(patches, editMode);
    return [...baseLayers, ...patchLayers];
  }, [renderData, showPointCloud, handleHover, handleClick, patches, editMode]);

  return (
    <div className="viewer-root">
      <DeckGL
        views={new OrbitView()}
        controller={{ type: OrbitController }}
        viewState={viewState}
        layers={layers}
        onViewStateChange={({ viewState: nextViewState }) => {
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
