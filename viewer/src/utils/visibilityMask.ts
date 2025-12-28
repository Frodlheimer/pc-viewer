export type VisibilityMaskResult = {
  mask: Float32Array;
  deletedDelta: number;
};

export const applyDeletesToVisibilityMask = (
  mask: Float32Array | undefined,
  pointCount: number,
  indices: Iterable<number>
): VisibilityMaskResult => {
  let nextMask = mask;
  if (!nextMask || nextMask.length !== pointCount) {
    nextMask = new Float32Array(pointCount);
    nextMask.fill(1);
  }
  let deletedDelta = 0;
  for (const index of indices) {
    if (index < 0 || index >= pointCount) {
      continue;
    }
    if (nextMask[index] !== 0) {
      nextMask[index] = 0;
      deletedDelta += 1;
    }
  }
  return { mask: nextMask, deletedDelta };
};
