import { describe, expect, it } from "vitest";
import {
  denormalizePoint,
  normalizePoint,
  parseInkAnchor,
  projectEpubInk,
  strokeInsideLasso,
  type InkAnchor,
} from "../src/features/ink/inkGeometry";

describe("inkGeometry", () => {
  it("normalizes and denormalizes coordinates", () => {
    const size = { width: 200, height: 100 };
    const normalized = normalizePoint({ x: 50, y: 25 }, size);
    expect(normalized).toEqual({ x: 0.25, y: 0.25 });
    expect(denormalizePoint(normalized, size)).toEqual({ x: 50, y: 25 });
  });

  it("selects a stroke fully inside the lasso", () => {
    const stroke: InkAnchor = {
      version: 1,
      space: "pdf-page",
      width: 4,
      points: [{ x: 0.35, y: 0.5 }, { x: 0.65, y: 0.5 }],
    };

    expect(strokeInsideLasso(stroke, squareLasso(), { width: 200, height: 100 })).toBe(true);
  });

  it("does not select a stroke outside the lasso", () => {
    const stroke: InkAnchor = {
      version: 1,
      space: "pdf-page",
      width: 4,
      points: [{ x: 0.05, y: 0.5 }, { x: 0.2, y: 0.5 }],
    };

    expect(strokeInsideLasso(stroke, squareLasso(), { width: 200, height: 100 })).toBe(false);
  });

  it("does not select a stroke crossing the lasso boundary", () => {
    const stroke: InkAnchor = {
      version: 1,
      space: "pdf-page",
      width: 4,
      points: [{ x: 0.3, y: 0.6 }, { x: 0.7, y: 0.6 }],
    };

    expect(strokeInsideLasso(stroke, concaveLasso(), { width: 200, height: 100 })).toBe(false);
  });

  it("ignores too-short lasso paths", () => {
    const stroke: InkAnchor = {
      version: 1,
      space: "pdf-page",
      width: 4,
      points: [{ x: 0.35, y: 0.5 }, { x: 0.65, y: 0.5 }],
    };

    expect(strokeInsideLasso(stroke, [{ x: 50, y: 25 }, { x: 150, y: 75 }], { width: 200, height: 100 })).toBe(false);
  });

  it("parses and scales reflow-stable EPUB ink", () => {
    const anchor = parseInkAnchor(JSON.stringify({ version: 2, space: "epub-content", cfi: "epubcfi(/6/2!/4/2)", href: "a.xhtml", fontSize: 10, width: 2, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }));
    expect(anchor?.version).toBe(2);
    if (!anchor || anchor.version !== 2) throw new Error("invalid anchor");
    expect(projectEpubInk(anchor, { x: 5, y: 7 }, 20)).toEqual([{ x: 25, y: 47 }, { x: 65, y: 87 }]);
    expect(parseInkAnchor(JSON.stringify({ ...anchor, version: 1, space: "epub-rendition" }))?.version).toBe(1);
  });
});

function squareLasso() {
  return [
    { x: 50, y: 25 },
    { x: 150, y: 25 },
    { x: 150, y: 75 },
    { x: 50, y: 75 },
  ];
}

function concaveLasso() {
  return [
    { x: 40, y: 20 },
    { x: 160, y: 20 },
    { x: 160, y: 80 },
    { x: 120, y: 80 },
    { x: 120, y: 40 },
    { x: 80, y: 40 },
    { x: 80, y: 80 },
    { x: 40, y: 80 },
  ];
}
