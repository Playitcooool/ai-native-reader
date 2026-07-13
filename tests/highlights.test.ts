import { describe, expect, it, vi } from "vitest";
import { createHighlight, handleSearchShortcut, HIGHLIGHT_COLORS, isHighlightShortcut, isSearchShortcut, loadLastHighlightColor, runOnce, saveLastHighlightColor } from "../src/features/annotations/highlights";

describe("shared highlights", () => {
  it("runs one selection action at a time and unlocks for retry", async () => {
    const lock = { current: false };
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = runOnce(lock, save);
    await expect(runOnce(lock, save)).resolves.toBe(false);
    expect(save).toHaveBeenCalledOnce();
    finish();
    await expect(first).resolves.toBe(true);
    await expect(runOnce(lock, async () => { throw new Error("save failed"); })).rejects.toThrow("save failed");
    await expect(runOnce(lock, async () => {})).resolves.toBe(true);
  });
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

  it("routes search from content and toolbar but not editable fields or dialogs", () => {
    expect(isSearchShortcut(event({ key: "f" }))).toBe(true);
    expect(isSearchShortcut(event({ key: "f", metaKey: false, ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(event({ key: "f", target: { closest: (selector: string) => selector.includes("input") ? {} : null } }))).toBe(false);
    expect(isSearchShortcut(event({ key: "f", target: { closest: (selector: string) => selector.includes("dialog") ? {} : null } }))).toBe(false);
    expect(isSearchShortcut(event({ key: "f", shiftKey: true }))).toBe(false);
  });

  it("prevents native find and handles a forwarded event once", () => {
    const open = vi.fn();
    const shortcut = { ...event({ key: "f" }), defaultPrevented: false, preventDefault: vi.fn(function (this: { defaultPrevented: boolean }) { this.defaultPrevented = true; }) } as unknown as KeyboardEvent;
    expect(handleSearchShortcut(shortcut, open)).toBe(true);
    expect(handleSearchShortcut(shortcut, open)).toBe(false);
    expect(shortcut.preventDefault).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
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
