import { describe, expect, it } from "vitest";
import { epubTurnForKey } from "../src/features/epub/epubNavigation";

describe("EPUB keyboard navigation", () => {
  it("maps arrows visually and paging keys semantically", () => {
    expect(epubTurnForKey("ArrowLeft", "ltr")).toBe("previous");
    expect(epubTurnForKey("ArrowLeft", "rtl")).toBe("next");
    expect(epubTurnForKey("ArrowRight", "rtl")).toBe("previous");
    expect(epubTurnForKey("PageUp", "rtl")).toBe("previous");
    expect(epubTurnForKey(" ", "rtl")).toBe("next");
  });
});
