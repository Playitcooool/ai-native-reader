import { describe, expect, it } from "vitest";
import { buildCumulativeOffsets, computeVisibleRange, findPageIndexAtOffset } from "../src/features/pdf/useVisibleRange";

describe("visible range offsets", () => {
  const heights = [100, 200, 50, 150];
  const tops = buildCumulativeOffsets(heights, heights.length);

  it("builds page top offsets for variable heights", () => {
    expect(tops).toEqual([0, 100, 300, 350]);
  });

  it("finds first and last visible pages with buffer", () => {
    expect(computeVisibleRange(120, 181, heights, tops, heights.length, 1)).toEqual([0, 3]);
    expect(computeVisibleRange(360, 80, heights, tops, heights.length, 0)).toEqual([3, 3]);
  });

  it("looks up page index from a page top", () => {
    expect(findPageIndexAtOffset(tops, tops[2])).toBe(2);
  });

  it("looks up page index from the viewport center", () => {
    const center = 80 + 60;
    expect(findPageIndexAtOffset(tops, center)).toBe(1);
  });
});
