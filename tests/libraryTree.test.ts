import { describe, expect, it } from "vitest";
import { buildLibraryTree } from "../src/features/library/libraryTree";
import type { Document } from "../src/stores/documentStore";

function doc(id: string, filePath: string, title: string | null = null): Document {
  return {
    id,
    title,
    original_filename: filePath.split("/").pop() ?? filePath,
    file_path: filePath,
    file_sha256: null,
    page_count: null,
    created_at: "",
    updated_at: "",
    last_opened_at: null,
    last_page: null,
    last_zoom: null,
    parse_status: null,
    has_native_toc: null,
    document_type: "pdf",
    author: null,
  };
}

describe("buildLibraryTree", () => {
  it("uses the collection name as the visible root", () => {
    const tree = buildLibraryTree([
      doc("a", "/books/fantasy/dune.pdf"),
      doc("b", "/books/history/rome.pdf"),
    ], "Favorites");

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("Favorites");
    expect(tree[0].isDir).toBe(true);
  });

  it("shows filenames instead of true file paths", () => {
    const tree = buildLibraryTree([
      doc("a", "/library/sci-fi/dune.pdf"),
    ], "All books");

    expect(tree[0].children[0].name).toBe("dune.pdf");
  });

  it("falls back to the path basename when original filename is missing", () => {
    const item = doc("a", "/downloads/essay.pdf");
    item.original_filename = "";

    const tree = buildLibraryTree([
      item,
    ], "Recent");

    expect(tree[0].children[0].name).toBe("essay.pdf");
  });

  it("sorts files alphabetically", () => {
    const tree = buildLibraryTree([
      doc("z", "/library/zeta.pdf"),
      doc("b", "/library/beta.pdf"),
      doc("a", "/library/alpha.pdf"),
    ], "All books");

    expect(tree[0].children.map((node) => node.name)).toEqual(["alpha.pdf", "beta.pdf", "zeta.pdf"]);
  });
});
