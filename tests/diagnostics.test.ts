import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDiagnosticReport,
  recordDiagnostic,
  setDiagnosticsEnabled,
} from "../src/features/diagnostics";

describe("diagnostics", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("navigator", { platform: "test" });
    setDiagnosticsEnabled(false);
  });

  it("is opt-in and strips non-numeric context", () => {
    recordDiagnostic("search_ms", 12, { query: "private text", indexed_pages: 10 });
    expect(createDiagnosticReport("1").events).toEqual([]);

    setDiagnosticsEnabled(true);
    recordDiagnostic("search_ms", 12.4, { query: "private text", indexed_pages: 10 });

    expect(createDiagnosticReport("1")).toMatchObject({
      schema_version: 1,
      app_version: "1",
      platform: "test",
      events: [{ name: "search_ms", duration_ms: 12, values: { indexed_pages: 10 } }],
    });
  });
});
