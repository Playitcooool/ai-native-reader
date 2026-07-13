import { describe, expect, it, vi } from "vitest";
import { displayEpubStart } from "../src/features/epub/epubDisplay";

describe("EPUB startup display", () => {
  it("falls back when a saved CFI is stale", async () => {
    const display = vi.fn(async (target: string | number) => {
      if (typeof target === "string") throw new Error("bad CFI");
    });

    await expect(displayEpubStart(display, "epubcfi(bad)", 3, 1)).resolves.toBe(false);
    expect(display.mock.calls).toEqual([["epubcfi(bad)"], [3]]);
  });

  it("times out a display that never resolves", async () => {
    const display = () => new Promise<never>(() => {});
    await expect(displayEpubStart(display, null, undefined, 0, 1)).rejects.toThrow("timed out");
  });

  it("tries database progress and section zero after saved fallbacks fail", async () => {
    const display = vi.fn(async (target: string | number) => { if (target !== 0) throw new Error("bad location"); });
    await displayEpubStart(display, "epubcfi(bad)", 4, 2);
    expect(display.mock.calls).toEqual([["epubcfi(bad)"], [4], [2], [0]]);
  });
});
