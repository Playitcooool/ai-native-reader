import { describe, expect, it } from "vitest";
import {
  denormalizePoint,
  normalizePoint,
  splitStrokeByEraser,
  strokeHitByEraser,
  type InkAnchor,
} from "../src/features/ink/inkGeometry";

describe("inkGeometry", () => {
  it("normalizes and denormalizes coordinates", () => {
    const size = { width: 200, height: 100 };
    const normalized = normalizePoint({ x: 50, y: 25 }, size);
    expect(normalized).toEqual({ x: 0.25, y: 0.25 });
    expect(denormalizePoint(normalized, size)).toEqual({ x: 50, y: 25 });
  });

  it("detects eraser hits against a stroke", () => {
    const stroke: InkAnchor = {
      version: 1,
      space: "pdf-page",
      width: 4,
      points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
    };

    expect(strokeHitByEraser(stroke, [{ x: 95, y: 40 }, { x: 105, y: 60 }], { width: 200, height: 100 }, 8)).toBe(true);
    expect(strokeHitByEraser(stroke, [{ x: 95, y: 5 }, { x: 105, y: 10 }], { width: 200, height: 100 }, 8)).toBe(false);
  });

  it("splits erased stroke portions into remaining fragments", () => {
    const stroke: InkAnchor = {
      version: 1,
      space: "pdf-page",
      width: 2,
      points: [
        { x: 0.1, y: 0.5 },
        { x: 0.3, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.7, y: 0.5 },
        { x: 0.9, y: 0.5 },
      ],
    };

    const fragments = splitStrokeByEraser(
      stroke,
      [{ x: 95, y: 35 }, { x: 105, y: 65 }],
      { width: 200, height: 100 },
      12,
    );

    expect(fragments).toHaveLength(2);
    expect(fragments[0].points).toEqual([{ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.5 }]);
    expect(fragments[1].points).toEqual([{ x: 0.7, y: 0.5 }, { x: 0.9, y: 0.5 }]);
  });

  it("drops a sparse segment crossed by the eraser between sampled points", () => {
    const stroke: InkAnchor = {
      version: 1,
      space: "pdf-page",
      width: 2,
      points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
    };

    const fragments = splitStrokeByEraser(
      stroke,
      [{ x: 95, y: 35 }, { x: 105, y: 65 }],
      { width: 200, height: 100 },
      12,
    );

    expect(fragments).toEqual([]);
  });
});
