import type { Document } from "../../stores/documentStore";

export interface LibraryTreeNode {
  name: string;
  isDir: boolean;
  children: LibraryTreeNode[];
  document?: Document;
}

function newDir(name: string): LibraryTreeNode {
  return { name, isDir: true, children: [] };
}

function fileName(doc: Document): string {
  return doc.original_filename?.trim() || doc.file_path.split("/").pop() || "Untitled";
}

export function buildLibraryTree(docs: Document[], collectionName: string): LibraryTreeNode[] {
  const root = newDir(collectionName);
  root.children = docs
    .map((doc) => ({
      name: fileName(doc),
      isDir: false,
      children: [],
      document: doc,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return [root];
}
