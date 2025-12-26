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

export const createPointCloudLayer = (
  tile: TileRenderData,
  callbacks: PointCloudCallbacks
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

  return new PointCloudLayer<BinaryAttributes>({
    id: `pointcloud-${tile.id}`,
    data,
    pickable: true,
    autoHighlight: true,
    pointSize: 2,
    onHover: callbacks.onHover,
    onClick: callbacks.onClick,
  });
};
