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
  it("builds nested folders from document paths", () => {
    const tree = buildLibraryTree([
      doc("a", "/books/fantasy/dune.pdf"),
      doc("b", "/books/history/rome.pdf"),
    ], null);

    expect(tree.map((node) => node.name)).toEqual(["fantasy", "history"]);
    expect(tree[0].children[0].name).toBe("dune.pdf");
    expect(tree[1].children[0].document?.id).toBe("b");
  });

  it("uses libraryFolder as the root", () => {
    const tree = buildLibraryTree([
      doc("a", "/library/sci-fi/dune.pdf"),
    ], "/library");

    expect(tree.map((node) => node.name)).toEqual(["sci-fi"]);
    expect(tree[0].children[0].name).toBe("dune.pdf");
  });

  it("groups out-of-folder documents under Other", () => {
    const tree = buildLibraryTree([
      doc("a", "/library/dune.pdf"),
      doc("b", "/downloads/essay.pdf"),
    ], "/library");

    expect(tree.map((node) => node.name)).toEqual(["Other", "dune.pdf"]);
    expect(tree[0].children[0].name).toBe("essay.pdf");
  });

  it("sorts folders before files alphabetically", () => {
    const tree = buildLibraryTree([
      doc("z", "/library/zeta.pdf"),
      doc("b", "/library/beta.pdf"),
      doc("a", "/library/alpha/a.pdf"),
    ], "/library");

    expect(tree.map((node) => node.name)).toEqual(["alpha", "beta.pdf", "zeta.pdf"]);
  });
});
