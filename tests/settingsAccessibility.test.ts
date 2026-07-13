import { describe, expect, it } from "vitest";
import { wrappedFocusTarget } from "../src/components/SettingsDialog";

describe("settings dialog focus", () => {
  it("wraps at both ends without moving focus in the middle", () => {
    const controls = ["first", "middle", "last"];

    expect(wrappedFocusTarget(controls, "first", true)).toBe("last");
    expect(wrappedFocusTarget(controls, "last", false)).toBe("first");
    expect(wrappedFocusTarget(controls, "middle", false)).toBeNull();
  });
});
