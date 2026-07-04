import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseDefaultEpubFontSize,
  parseDefaultPdfZoom,
  parseRememberSidebarTab,
  parseThemePreference,
  parseUiFontPreference,
  resolveThemePreference,
  toggledThemePreference,
} from "../src/stores/settingsStore";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("theme preference helpers", () => {
  it("defaults missing storage to system and resolves dark OS", () => {
    const preference = parseThemePreference(null);
    expect(preference).toBe("system");
    expect(resolveThemePreference(preference, true)).toBe("dark");
  });

  it("resolves stored light and dark explicitly", () => {
    expect(resolveThemePreference(parseThemePreference("light"), true)).toBe("light");
    expect(resolveThemePreference(parseThemePreference("dark"), false)).toBe("dark");
  });

  it("falls back to system for invalid stored values", () => {
    const preference = parseThemePreference("sepia");
    expect(preference).toBe("system");
    expect(resolveThemePreference(preference, false)).toBe("light");
  });

  it("toolbar toggle stores the opposite explicit theme", () => {
    expect(toggledThemePreference("dark")).toBe("light");
    expect(toggledThemePreference("light")).toBe("dark");
  });

  it("parses UI preferences with safe defaults", () => {
    expect(parseUiFontPreference("mono")).toBe("mono");
    expect(parseUiFontPreference("comic")).toBe("system");
    expect(parseDefaultPdfZoom("150")).toBe("150");
    expect(parseDefaultPdfZoom("90")).toBe("auto");
    expect(parseDefaultEpubFontSize("130")).toBe(130);
    expect(parseDefaultEpubFontSize("133")).toBe(100);
    expect(parseRememberSidebarTab(null)).toBe(true);
    expect(parseRememberSidebarTab("false")).toBe(false);
  });

  it("resets only UI preference storage and reapplies defaults", async () => {
    vi.resetModules();
    const storage = new Map<string, string>([
      ["reader-theme", "dark"],
      ["reader-ui-font", "mono"],
      ["reader-default-pdf-zoom", "150"],
      ["reader-default-epub-font-size", "130"],
      ["reader-remember-sidebar-tab", "false"],
      ["provider-secret", "keep"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("document", {
      documentElement: {
        dataset: {},
        style: { colorScheme: "", setProperty: vi.fn() },
      },
    });

    const { useSettingsStore } = await import("../src/stores/settingsStore");
    useSettingsStore.getState().resetUiPreferences();

    expect(useSettingsStore.getState()).toMatchObject({
      themePreference: "system",
      uiFont: "system",
      defaultPdfZoom: "auto",
      defaultEpubFontSize: 100,
      rememberSidebarTab: true,
    });
    expect(storage.has("reader-theme")).toBe(false);
    expect(storage.has("reader-ui-font")).toBe(false);
    expect(storage.has("reader-default-pdf-zoom")).toBe(false);
    expect(storage.has("reader-default-epub-font-size")).toBe(false);
    expect(storage.has("reader-remember-sidebar-tab")).toBe(false);
    expect(storage.get("provider-secret")).toBe("keep");
  });
});
