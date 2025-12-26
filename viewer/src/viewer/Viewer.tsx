import { OrbitController, OrbitView, type PickingInfo } from "@deck.gl/core";
import DeckGL from "@deck.gl/react";
import { useCallback, useEffect, useMemo } from "react";
import { createPointCloudLayer } from "../layers/PointCloudLayerFactory";
import { loadManifest } from "../io/ManifestLoader";
import { loadRenderData } from "../io/TileManager";
import { useAppStore } from "../state/store";
import { getDatasetById } from "../types/Dataset";
import type { Vec3 } from "../types/Point";
import type { TileRenderData } from "../types/Tile";

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

export const Viewer = () => {
  const { state, dispatch } = useAppStore();
  const { activeDatasetId, renderData, showPointCloud, viewState } = state;

  useEffect(() => {
    let cancelled = false;
    const dataset = getDatasetById(activeDatasetId);

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
      .then((manifest) => loadRenderData(manifest))
      .then((data) => {
        if (cancelled) return;
        dispatch({ type: "set-render-data", renderData: data });
        dispatch({ type: "set-status", status: "ready", error: null });
        dispatch({ type: "reset-view-state", bounds: data.bounds });
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
    if (!renderData || !showPointCloud) {
      return [];
    }
    return renderData.tiles.map((tile) =>
      createPointCloudLayer(tile, {
        onHover: (info) => handleHover(tile, info),
        onClick: (info) => handleClick(tile, info),
      })
    );
  }, [renderData, showPointCloud, handleHover, handleClick]);

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
