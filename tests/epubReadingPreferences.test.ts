import { describe, expect, it } from "vitest";
import { autoFontPercentage, epubReadingPreferenceKey, loadEpubReadingPreference } from "../src/features/epub/epubReadingPreferences";

describe("EPUB reading preferences", () => {
  it("defaults safely and restores valid values", () => {
    expect(loadEpubReadingPreference("a", { getItem: () => null })).toEqual({ fontMode: "auto", fontFamily: "book", lineHeight: 1.6, contentWidth: 760 });
    expect(loadEpubReadingPreference("a", { getItem: (key) => key === epubReadingPreferenceKey("a") ? '{"flow":"paginated","fontMode":"manual"}' : null }))
      .toEqual({ fontMode: "manual", fontFamily: "book", lineHeight: 1.6, contentWidth: 760 });
  });

  it("rounds Auto sizing to 10% and clamps it", () => {
    expect(autoFontPercentage(16)).toBe(110);
    expect(autoFontPercentage(30)).toBe(80);
    expect(autoFontPercentage(8)).toBe(150);
  });
});
