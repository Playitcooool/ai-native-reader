import { describe, expect, it } from "vitest";
import { parseThemePreference, resolveThemePreference, toggledThemePreference } from "../src/stores/settingsStore";

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
});
