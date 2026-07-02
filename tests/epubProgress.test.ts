import { describe, expect, it } from "vitest";
import { chapterToPercent, percentToChapter } from "../src/features/epub/epubProgress";
import { epubCfiKey, locationToPercent, parseEpubCfiAnchor, snapshotFromLocation } from "../src/features/epub/epubAnchors";

describe("epub progress conversion", () => {
  it("converts chapter positions to saved percent", () => {
    expect(chapterToPercent(1, 5)).toBe(0);
    expect(chapterToPercent(3, 5)).toBe(50);
    expect(chapterToPercent(5, 5)).toBe(100);
  });

  it("restores percent to the nearest chapter", () => {
    expect(percentToChapter(0, 5)).toBe(1);
    expect(percentToChapter(50, 5)).toBe(3);
    expect(percentToChapter(100, 5)).toBe(5);
  });

  it("clamps invalid inputs", () => {
    expect(chapterToPercent(99, 5)).toBe(100);
    expect(percentToChapter(-20, 5)).toBe(1);
    expect(percentToChapter(120, 5)).toBe(5);
    expect(percentToChapter(80, 0)).toBe(1);
  });
});

describe("epub CFI anchors", () => {
  it("validates stored text anchors", () => {
    const anchor = parseEpubCfiAnchor(JSON.stringify({
      version: 1,
      space: "epub-cfi",
      cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:4)",
      selectedText: "test",
      href: "chapter.xhtml",
      spineIndex: 2,
    }));
    expect(anchor?.cfiRange).toContain("epubcfi");
    expect(anchor?.href).toBe("chapter.xhtml");
    expect(parseEpubCfiAnchor(JSON.stringify({ version: 1, space: "pdf-page" }))).toBeNull();
    expect(parseEpubCfiAnchor("not json")).toBeNull();
  });

  it("builds stable CFI storage keys", () => {
    expect(epubCfiKey("doc-1")).toBe("rustybooks:epub-cfi:doc-1");
  });

  it("normalizes rendition locations to percent snapshots", () => {
    const location = {
      start: { cfi: "epubcfi(/6/4!/4/2/2)", href: "chapter.xhtml", index: 3, percentage: 0.427 },
      atStart: false,
      atEnd: false,
    };
    expect(locationToPercent(location)).toBe(43);
    expect(snapshotFromLocation(location)).toEqual({
      cfi: "epubcfi(/6/4!/4/2/2)",
      href: "chapter.xhtml",
      spineIndex: 3,
      percent: 43,
      atStart: false,
      atEnd: false,
    });
    expect(snapshotFromLocation({ start: { percentage: 0.5 } })).toBeNull();
  });
});
