import { describe, expect, it } from "vitest";
import {
  collectionIdsForDocument,
  documentDisplayAuthor,
  documentDisplayTitle,
  documentsNeedingMetadataRefresh,
  filterDocumentsByCollection,
  RECENT_COLLECTION_ID,
  type Document,
} from "../src/stores/documentStore";

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
