import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  collectionIdsForDocument,
  documentDisplayAuthor,
  documentDisplayTitle,
  documentsNeedingMetadataRefresh,
  filterDocumentsByCollection,
  RECENT_COLLECTION_ID,
  type Document,
  useDocumentStore,
} from "../src/stores/documentStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function testDocument(id: string, overrides: Partial<Document> = {}): Document {
  return {
    id,
    title: `${id}.pdf`,
    original_filename: `${id}.pdf`,
    file_path: `/tmp/${id}.pdf`,
    file_sha256: null,
    page_count: 10,
    created_at: "",
    updated_at: "",
    last_opened_at: null,
    last_page: 1,
    last_zoom: 1,
    parse_status: "ready",
    has_native_toc: false,
    document_type: "pdf",
    author: "Author",
    ...overrides,
  };
}

afterEach(() => {
  useDocumentStore.getState().stopHeartbeat();
  useDocumentStore.setState({ currentDocument: null, documents: [], tocNodes: [], heartbeatInterval: null, _onVisibility: null });
  vi.mocked(invoke).mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("documentDisplayTitle", () => {
  it("falls back when the stored title is blank", () => {
    expect(documentDisplayTitle({
      title: "   ",
      original_filename: "book.pdf",
      file_path: "/tmp/book.pdf",
    })).toBe("book.pdf");
  });

  it("trims authors for library subtitles", () => {
    expect(documentDisplayAuthor({ author: "  Ada Lovelace  " })).toBe("Ada Lovelace");
    expect(documentDisplayAuthor({ author: null })).toBe("");
  });
});

describe("collection helpers", () => {
  const docs = [
    { id: "d1", last_opened_at: "2026-01-01T00:00:00Z" },
    { id: "d2", last_opened_at: null },
    { id: "d3", last_opened_at: "2026-01-02T00:00:00Z" },
  ] as Document[];

  const memberships = [
    { document_id: "d1", collection_id: "c1" },
    { document_id: "d2", collection_id: "c1" },
    { document_id: "d2", collection_id: "c2" },
  ];

  it("maps document memberships to collection ids", () => {
    expect(collectionIdsForDocument(memberships, "d2")).toEqual(new Set(["c1", "c2"]));
  });

  it("keeps all documents when no collection is selected", () => {
    expect(filterDocumentsByCollection(docs, null, memberships).map((doc) => doc.id)).toEqual(["d1", "d2", "d3"]);
  });

  it("filters documents assigned to the selected collection", () => {
    expect(filterDocumentsByCollection(docs, "c1", memberships).map((doc) => doc.id)).toEqual(["d1", "d2"]);
    expect(filterDocumentsByCollection(docs, "c2", memberships).map((doc) => doc.id)).toEqual(["d2"]);
  });

  it("filters recent documents by last opened time", () => {
    expect(filterDocumentsByCollection(docs, RECENT_COLLECTION_ID, memberships).map((doc) => doc.id)).toEqual(["d1", "d3"]);
  });
});

describe("documentsNeedingMetadataRefresh", () => {
  it("returns only PDF metadata candidates up to the limit", () => {
    const docs = [
      { id: "pdf-title-filename", document_type: "pdf", author: "Ada", title: "a.pdf", original_filename: "a.pdf" },
      { id: "epub", document_type: "epub", author: null, title: null, original_filename: "b.epub" },
      { id: "pdf-no-author", document_type: "pdf", author: null, title: "Good title", original_filename: "c.pdf" },
      { id: "pdf-ready", document_type: "pdf", author: "Ada", title: "Good title", original_filename: "d.pdf" },
    ] as Document[];

    expect(documentsNeedingMetadataRefresh(docs, 1).map((doc) => doc.id)).toEqual(["pdf-title-filename"]);
    expect(documentsNeedingMetadataRefresh(docs, 12).map((doc) => doc.id)).toEqual(["pdf-title-filename", "pdf-no-author"]);
  });
});

describe("document lifecycle", () => {
  it("does not reopen a document when its metadata refresh finishes late", async () => {
    vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: true }));
    const first = testDocument("first", { author: null });
    const second = testDocument("second");
    let finishRefresh!: (document: Document) => void;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "refresh_document_metadata") {
        return new Promise((resolve) => { finishRefresh = resolve; });
      }
      return Promise.resolve();
    });
    useDocumentStore.setState({ documents: [first, second] });

    useDocumentStore.getState().setCurrentDocument(first);
    useDocumentStore.getState().setCurrentDocument(second);
    finishRefresh({ ...first, title: "Refreshed", author: "Updated" });

    await vi.waitFor(() => expect(useDocumentStore.getState().documents.find((doc) => doc.id === first.id)?.title).toBe("Refreshed"));
    expect(useDocumentStore.getState().currentDocument?.id).toBe(second.id);
  });

  it("keeps one visibility listener while pausing reading time in the background", () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const pageDocument = {
      hidden: true,
      addEventListener: vi.fn(target.addEventListener.bind(target)),
      removeEventListener: vi.fn(target.removeEventListener.bind(target)),
    };
    vi.stubGlobal("document", pageDocument);
    vi.mocked(invoke).mockResolvedValue(undefined);
    useDocumentStore.setState({ currentDocument: testDocument("reading") });

    useDocumentStore.getState().startHeartbeat();
    expect(useDocumentStore.getState().heartbeatInterval).toBeNull();
    pageDocument.hidden = false;
    target.dispatchEvent(new Event("visibilitychange"));
    expect(useDocumentStore.getState().heartbeatInterval).not.toBeNull();
    pageDocument.hidden = true;
    target.dispatchEvent(new Event("visibilitychange"));
    pageDocument.hidden = false;
    target.dispatchEvent(new Event("visibilitychange"));

    expect(pageDocument.addEventListener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(invoke).toHaveBeenCalledWith("record_reading_heartbeat", { seconds: 15 });
  });

  it("ignores table-of-contents results from the previous document", async () => {
    const first = testDocument("first");
    const second = testDocument("second");
    let finishFirst!: (nodes: any[]) => void;
    let finishSecond!: (nodes: any[]) => void;
    vi.mocked(invoke).mockImplementation((_command, args) => new Promise((resolve) => {
      if ((args as { documentId: string }).documentId === first.id) finishFirst = resolve;
      else finishSecond = resolve;
    }));

    useDocumentStore.setState({ currentDocument: first });
    const firstLoad = useDocumentStore.getState().loadToc(first.id);
    useDocumentStore.setState({ currentDocument: second });
    const secondLoad = useDocumentStore.getState().loadToc(second.id);
    finishSecond([{ id: "second-toc" }]);
    await secondLoad;
    finishFirst([{ id: "first-toc" }]);
    await firstLoad;

    expect(useDocumentStore.getState().tocNodes).toEqual([{ id: "second-toc" }]);
  });
});
