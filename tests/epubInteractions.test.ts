import { describe, expect, it } from "vitest";
import type { Contents } from "epubjs";
import { annotationChanges, directionalGestureTurn, gestureTurn, selectionAnchorFromContents } from "../src/features/epub/epubInteractions";

describe("EPUB interactions", () => {
  it("anchors a selection to the section that emitted it", () => {
    const contents = { section: { href: "chapter-4.xhtml", index: 3 } } as unknown as Contents;
    expect(selectionAnchorFromContents("epubcfi(/6/8!/4/2)", "selected", contents)).toMatchObject({
      cfiRange: "epubcfi(/6/8!/4/2)", selectedText: "selected", href: "chapter-4.xhtml", spineIndex: 3,
    });
  });

  it("requires a deliberate wheel or swipe gesture", () => {
    expect(gestureTurn(20, 30)).toBeNull();
    expect(gestureTurn(0, 70)).toBe("next");
    expect(gestureTurn(-70, 5)).toBe("previous");
    expect(directionalGestureTurn(-70, 5, "rtl")).toBe("next");
  });

  it("reconciles annotations by id and rendering signature", () => {
    const unchanged = { id: "same", signature: "a" };
    const changed = { id: "changed", signature: "old" };
    const replacement = { id: "changed", signature: "new" };
    const added = { id: "added", signature: "x" };
    expect(annotationChanges([unchanged, changed], [unchanged, replacement, added])).toEqual({
      remove: [changed], add: [replacement, added],
    });
  });
});
