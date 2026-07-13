import { describe, expect, it, vi } from "vitest";
import { createHighlight, HIGHLIGHT_COLORS, isHighlightShortcut, loadLastHighlightColor, saveLastHighlightColor } from "../src/features/annotations/highlights";

describe("shared highlights", () => {
  const event = (overrides = {}) => ({ key: "b", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, target: { closest: () => null }, ...overrides }) as KeyboardEvent;

  it("loads yellow by default, persists supported colors, and rejects invalid values", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(loadLastHighlightColor(storage)).toBe("#fde047");
    for (const color of HIGHLIGHT_COLORS) { saveLastHighlightColor(color, storage); expect(loadLastHighlightColor(storage)).toBe(color); }
    values.set("rustybooks:last-highlight-color", "red");
    expect(loadLastHighlightColor(storage)).toBe("#fde047");
  });

  it("filters modifiers, missing selections, and editable controls", () => {
    expect(isHighlightShortcut(event(), true)).toBe(true);
    expect(isHighlightShortcut(event({ metaKey: false, ctrlKey: true }), true)).toBe(true);
    expect(isHighlightShortcut(event({ shiftKey: true }), true)).toBe(false);
    expect(isHighlightShortcut(event(), false)).toBe(false);
    expect(isHighlightShortcut(event({ target: { closest: () => ({}) } }), true)).toBe(false);
  });

  it.each([
    ["PDF", { pageNumber: 4, startOffset: 2 }],
    ["EPUB", { cfiRange: "epubcfi(/6/2)", spineIndex: 3 }],
  ])("creates %s payloads, refreshes, and registers undo", async (_format, anchor) => {
    const create = vi.fn(async () => ({ id: "a1" }));
    const remove = vi.fn(async () => undefined);
    const pushUndo = vi.fn();
    const refresh = vi.fn();
    await createHighlight({ documentId: "d1", pageNumber: 4, selectedText: "text", anchor, create, remove, pushUndo, refresh });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ color: "#fde047", type: "highlight", anchor: JSON.stringify(anchor) }));
    expect(refresh).toHaveBeenCalledOnce();
    await pushUndo.mock.calls[0][0].undo();
    expect(remove).toHaveBeenCalledWith("a1");
  });

  it("leaves post-success work untouched when creation fails", async () => {
    const pushUndo = vi.fn();
    const refresh = vi.fn();
    await expect(createHighlight({ documentId: "d1", pageNumber: 1, selectedText: "x", anchor: {}, create: async () => { throw new Error("no"); }, remove: async () => {}, pushUndo, refresh })).rejects.toThrow("no");
    expect(pushUndo).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
