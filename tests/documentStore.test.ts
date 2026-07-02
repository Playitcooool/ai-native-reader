import { describe, expect, it } from "vitest";
import {
  collectionIdsForDocument,
  documentDisplayTitle,
  filterDocumentsByCollection,
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
});

describe("collection helpers", () => {
  const docs = [
    { id: "d1" },
    { id: "d2" },
    { id: "d3" },
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
});
