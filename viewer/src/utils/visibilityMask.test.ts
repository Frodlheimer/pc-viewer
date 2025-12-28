import { describe, expect, it } from "vitest";
import { applyDeletesToVisibilityMask } from "./visibilityMask";

describe("applyDeletesToVisibilityMask", () => {
  it("initializes a mask and hides one point", () => {
    const result = applyDeletesToVisibilityMask(undefined, 10, [3]);
    expect(result.deletedDelta).toBe(1);
    expect(result.mask.length).toBe(10);
    expect(result.mask[3]).toBe(0);
    expect(result.mask[0]).toBe(1);
    const visibleCount = Array.from(result.mask).filter((value) => value === 1)
      .length;
    expect(visibleCount).toBe(9);
  });

  it("applies multiple deletes without double counting", () => {
    const result = applyDeletesToVisibilityMask(undefined, 10, [3, 7, 3]);
    expect(result.deletedDelta).toBe(2);
    expect(result.mask[3]).toBe(0);
    expect(result.mask[7]).toBe(0);
    expect(result.mask[5]).toBe(1);
  });

  it("reinitializes when pointCount changes", () => {
    const initial = applyDeletesToVisibilityMask(undefined, 4, [1]);
    const next = applyDeletesToVisibilityMask(initial.mask, 6, [5]);
    expect(next.mask.length).toBe(6);
    expect(next.mask[1]).toBe(1);
    expect(next.mask[5]).toBe(0);
  });
});
