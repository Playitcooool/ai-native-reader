import { describe, expect, it } from "vitest";
import { describeAiScope, draftFromSelection, formatAiError, shouldFollowScroll } from "../src/features/ai/aiPanelHelpers";

describe("shouldFollowScroll", () => {
  it("follows when near the bottom", () => {
    expect(shouldFollowScroll(925, 100, 1000)).toBe(true);
  });

  it("does not follow when scrolled away", () => {
    expect(shouldFollowScroll(700, 100, 1000)).toBe(false);
  });
});

describe("draftFromSelection", () => {
  it("creates the selection draft", () => {
    expect(draftFromSelection("  quoted text  ")).toBe("About this selection:\n\nquoted text");
  });
});

describe("describeAiScope", () => {
  it("summarizes the page text sent to the provider", () => {
    expect(describeAiScope([3])).toBe("Sends page 3 text");
    expect(describeAiScope([5, 3, 4])).toBe("Sends 3 pages: 3-5");
    expect(describeAiScope([2], "epub")).toBe("Sends chapter 2 text");
  });
});

describe("formatAiError", () => {
  it("turns provider failures into useful messages", () => {
    expect(formatAiError("AI request failed: timeout")).toContain("timed out");
    expect(formatAiError("AI request failed: network_error")).toContain("Could not reach");
    expect(formatAiError("AI request failed: provider_error: HTTP 401 - nope")).toContain("HTTP 401");
    expect(formatAiError("Missing api_key")).toBe("This provider needs an API key in Settings.");
  });
});
