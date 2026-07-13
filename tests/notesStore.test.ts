import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useNotesStore } from "../src/stores/notesStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("notesStore", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useNotesStore.setState({ annotations: [], isLoading: false });
  });

  it("coalesces duplicate annotation loads", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { id: "a1", document_id: "doc", page_number: 1, toc_node_id: null, type: "note", selected_text: null, note_text: "note", color: null, anchor_json: null, created_at: "", updated_at: "" },
    ]);

    await Promise.all([
      useNotesStore.getState().loadAnnotations("doc"),
      useNotesStore.getState().loadAnnotations("doc"),
    ]);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("get_annotations", {
      input: { document_id: "doc", page_number: null },
    });
    expect(useNotesStore.getState().annotations).toHaveLength(1);
  });

  it("ignores annotations from a document that finished loading late", async () => {
    let finishFirst!: (annotations: any[]) => void;
    let finishSecond!: (annotations: any[]) => void;
    vi.mocked(invoke)
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve; }));

    const firstLoad = useNotesStore.getState().loadAnnotations("first");
    const secondLoad = useNotesStore.getState().loadAnnotations("second");
    finishSecond([{ id: "second-note" }]);
    await secondLoad;
    finishFirst([{ id: "first-note" }]);
    await firstLoad;

    expect(useNotesStore.getState().annotations).toEqual([{ id: "second-note" }]);
  });
});
