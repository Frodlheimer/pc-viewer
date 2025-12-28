import { describe, expect, it } from "vitest";
import { createPointCloudLayer } from "./PointCloudLayerFactory";
import type { TileRenderData } from "../types/Tile";

describe("PointCloudLayerFactory", () => {
  it("passes modelMatrix through to the layer props", () => {
    const tile: TileRenderData = {
      id: "tile-1",
      nodeId: 1,
      pointCount: 1,
      positions: new Float32Array([0, 0, 0]),
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    };
    const modelMatrix = new Float64Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      5, 6, 7, 1,
    ]);
    const layer = createPointCloudLayer(
      tile,
      { onHover: () => undefined, onClick: () => undefined },
      { id: "layer-1", modelMatrix }
    );
    expect(layer.props.modelMatrix).toEqual(modelMatrix);
  });

  it("wires DataFilterExtension when filterValues are provided", () => {
    const tile: TileRenderData = {
      id: "tile-2",
      nodeId: 2,
      pointCount: 3,
      positions: new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]),
      bounds: { min: [0, 0, 0], max: [2, 2, 2] },
    };
    const filterValues = new Float32Array([1, 0, 1]);
    const layer = createPointCloudLayer(
      tile,
      { onHover: () => undefined, onClick: () => undefined },
      { id: "layer-2", filterValues }
    );
    const data = layer.props.data as {
      attributes?: { filterValues?: { value: Float32Array } };
    };
    expect(data.attributes?.filterValues?.value).toBe(filterValues);
    expect(layer.props.getFilterValue).toBeDefined();
    const accessor = layer.props.getFilterValue as (
      _d: unknown,
      info: { index: number }
    ) => number;
    expect(accessor(null, { index: 0 })).toBe(1);
    expect(accessor(null, { index: 1 })).toBe(0);
    expect(layer.props.filterEnabled).toBe(true);
    expect(layer.props.filterRange).toEqual([0.5, 1.5]);
    expect(layer.props.extensions?.length).toBe(1);
  });
});
