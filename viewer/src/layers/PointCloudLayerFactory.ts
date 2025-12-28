import { PointCloudLayer } from "@deck.gl/layers";
import { DataFilterExtension } from "@deck.gl/extensions";
import type { DataFilterExtensionProps } from "@deck.gl/extensions";
import type { PickingInfo } from "@deck.gl/core";
import type { TileRenderData } from "../types/Tile";

type BinaryAttributes = {
  length: number;
  attributes: {
    getPosition: { value: Float32Array; size: 3 };
    getColor?: { value: Uint8Array; size: 3; normalized: true };
    filterValues?: { value: Float32Array; size: 1 };
  };
};

export type PointCloudCallbacks = {
  onHover: (info: PickingInfo, event?: unknown) => void;
  onClick: (info: PickingInfo, event?: unknown) => void;
};

export type PointCloudLayerOptions = {
  id: string;
  pickable?: boolean;
  autoHighlight?: boolean;
  pointSize?: number;
  modelMatrix?: Float32Array | Float64Array;
  filterValues?: Float32Array;
  filterVersion?: number;
};

export const createPointCloudLayer = (
  tile: TileRenderData,
  callbacks: PointCloudCallbacks,
  options: PointCloudLayerOptions
) => {
  const attributes: BinaryAttributes["attributes"] = {
    getPosition: { value: tile.positions, size: 3 },
  };

  if (tile.colors) {
    attributes.getColor = {
      value: tile.colors,
      size: 3,
      normalized: true,
    };
  }
  const filterValues = options.filterValues;
  if (filterValues) {
    attributes.filterValues = {
      value: filterValues,
      size: 1,
    };
  }

  const data: BinaryAttributes = {
    length: tile.pointCount,
    attributes,
  };

  const pickable = options.pickable ?? true;
  const filterTrigger = filterValues
    ? options.filterVersion ?? filterValues
    : undefined;
  const extensions = filterValues
    ? [new DataFilterExtension({ filterSize: 1 })]
    : [];
  return new PointCloudLayer<
    BinaryAttributes,
    DataFilterExtensionProps<BinaryAttributes>
  >({
    id: options.id,
    data,
    pickable,
    autoHighlight: options.autoHighlight ?? pickable,
    pointSize: options.pointSize ?? 2,
    modelMatrix: options.modelMatrix,
    getFilterValue: filterValues
      ? (_d, info: { index: number }) => filterValues[info.index] ?? 1
      : undefined,
    filterEnabled: Boolean(filterValues),
    filterRange: filterValues ? [0.5, 1.5] : undefined,
    extensions,
    updateTriggers: filterTrigger ? { getFilterValue: filterTrigger } : undefined,
    onHover: (info, event) => callbacks.onHover(info, event),
    onClick: (info, event) => callbacks.onClick(info, event),
  });
};
