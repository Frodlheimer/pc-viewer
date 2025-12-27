import { PointCloudLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import type { TileRenderData } from "../types/Tile";

type BinaryAttributes = {
  length: number;
  attributes: {
    getPosition: { value: Float32Array; size: 3 };
    getColor?: { value: Uint8Array; size: 3; normalized: true };
  };
};

export type PointCloudCallbacks = {
  onHover: (info: PickingInfo) => void;
  onClick: (info: PickingInfo) => void;
};

export type PointCloudLayerOptions = {
  id: string;
  pickable?: boolean;
  autoHighlight?: boolean;
  pointSize?: number;
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

  const data: BinaryAttributes = {
    length: tile.pointCount,
    attributes,
  };

  const pickable = options.pickable ?? true;
  return new PointCloudLayer<BinaryAttributes>({
    id: options.id,
    data,
    pickable,
    autoHighlight: options.autoHighlight ?? pickable,
    pointSize: options.pointSize ?? 2,
    onHover: callbacks.onHover,
    onClick: callbacks.onClick,
  });
};
