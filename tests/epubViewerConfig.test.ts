import { describe, expect, it } from "vitest";
import { EPUB_BOOK_OPTIONS, EPUB_THEME_RULES } from "../src/features/epub/epubViewerConfig";
import tauriConfig from "../src-tauri/tauri.conf.json";

describe("EPUB viewer configuration", () => {
  it("resolves archived resources without overriding publisher styles", () => {
    expect(EPUB_BOOK_OPTIONS.replacements).toBe("blobUrl");
    expect(EPUB_THEME_RULES).toEqual({
      "::selection": { background: "rgba(37, 99, 235, 0.28)" },
    });
    expect(tauriConfig.app.security.csp).toContain("style-src 'self' 'unsafe-inline' blob:");
  });
});
