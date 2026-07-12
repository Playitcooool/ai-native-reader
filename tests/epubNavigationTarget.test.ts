import { describe, expect, it } from "vitest";
import { annotationNavigationTarget } from "../src/features/epub/epubNavigationTarget";

describe("EPUB annotation navigation", () => {
  it("prefers a CFI and falls back to the stored section", () => {
    expect(annotationNavigationTarget('{"space":"epub-cfi","cfiRange":"epubcfi(/6/2)","spineIndex":4}', 9)).toEqual({ kind: "cfi", cfi: "epubcfi(/6/2)" });
    expect(annotationNavigationTarget("broken", 3)).toEqual({ kind: "spine", index: 2 });
  });
});
