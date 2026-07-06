import { describe, expect, it } from "vitest";
import { buildLinkBoxes } from "../src/features/pdf/PdfLinkLayer";

describe("buildLinkBoxes", () => {
  it("keeps only links and normalizes viewport rectangles", () => {
    const viewport = {
      convertToViewportRectangle: (rect: number[]) => [rect[2], rect[3], rect[0], rect[1]],
    };

    expect(buildLinkBoxes([
      { annotationType: 2, rect: [10, 20, 50, 35], url: "https://example.com" },
      { annotationType: 1, rect: [0, 0, 1, 1] },
    ], viewport)).toEqual([{
      annotationType: 2,
      rect: [10, 20, 50, 35],
      url: "https://example.com",
      box: { left: 10, top: 20, width: 40, height: 15 },
    }]);
  });
});
