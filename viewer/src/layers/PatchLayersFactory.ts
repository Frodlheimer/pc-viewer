import { PointCloudLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { EditMode, PatchState } from "../state/store";

type BinaryAttributes = {
  length: number;
  attributes: {
    getPosition: { value: Float32Array; size: 3 };
    getColor?: { value: Uint8Array; size: 3; normalized: true };
  };
};

export const createPatchLayers = (
  patches: PatchState,
  editMode: EditMode
): Layer[] => {
  const { positions, colors } = patches.addedPoints;
  if (!positions || positions.length === 0) {
    return [];
  }

  const attributes: BinaryAttributes["attributes"] = {
    getPosition: { value: positions, size: 3 },
  };

  if (colors && colors.length > 0) {
    attributes.getColor = {
      value: colors,
      size: 3,
      normalized: true,
    };
  }

  const data: BinaryAttributes = {
    length: Math.floor(positions.length / 3),
    attributes,
  };

  return [
    new PointCloudLayer<BinaryAttributes>({
      id: "patch-added",
      data,
      pickable: false,
      autoHighlight: false,
      pointSize: editMode === "add" ? 6 : 4,
      getColor: colors ? undefined : [120, 255, 180],
    }),
  ];
};
