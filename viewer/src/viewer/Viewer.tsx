import { OrbitController, OrbitView, type PickingInfo } from "@deck.gl/core";
import DeckGL from "@deck.gl/react";
import { useCallback, useEffect, useMemo } from "react";
import { createPointCloudLayer } from "../layers/PointCloudLayerFactory";
import { loadManifest } from "../io/ManifestLoader";
import { loadRenderData } from "../io/TileManager";
import { useAppStore } from "../state/store";
import { getDatasetById } from "../types/Dataset";
import type { Vec3 } from "../types/Point";

const getVec3 = (buffer: Float32Array, index: number): Vec3 => {
  const offset = index * 3;
  return [buffer[offset], buffer[offset + 1], buffer[offset + 2]];
};

const getColor = (buffer: Uint8Array, index: number): Vec3 => {
  const offset = index * 3;
  return [buffer[offset], buffer[offset + 1], buffer[offset + 2]];
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
    (info: PickingInfo) => {
      if (!renderData || info.index === undefined || info.index < 0) {
        dispatch({ type: "set-hover", hover: null });
        return;
      }

      const position = getVec3(renderData.positions, info.index);
      const color = renderData.colors
        ? getColor(renderData.colors, info.index)
        : undefined;

      dispatch({
        type: "set-hover",
        hover: {
          screen: { x: info.x ?? 0, y: info.y ?? 0 },
          index: info.index,
          position,
          color,
        },
      });
    },
    [dispatch, renderData]
  );

  const handleClick = useCallback(
    (info: PickingInfo) => {
      if (!renderData || info.index === undefined || info.index < 0) {
        dispatch({ type: "set-selection", selection: null });
        return;
      }

      const position = getVec3(renderData.positions, info.index);
      const color = renderData.colors
        ? getColor(renderData.colors, info.index)
        : undefined;

      dispatch({
        type: "set-selection",
        selection: {
          index: info.index,
          position,
          color,
        },
      });
    },
    [dispatch, renderData]
  );

  const layers = useMemo(() => {
    if (!renderData || !showPointCloud) {
      return [];
    }
    return [
      createPointCloudLayer(renderData, {
        onHover: handleHover,
        onClick: handleClick,
      }),
    ];
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
          <div>Index: {state.hover.index}</div>
          <div>
            Pos: {state.hover.position.map((value) => value.toFixed(2)).join(", ")}
          </div>
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
