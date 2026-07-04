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

function isInsideFolder(filePath: string, folderPath: string): boolean {
  return filePath === folderPath || filePath.startsWith(`${folderPath}/`);
}

function addDocument(root: LibraryTreeNode, doc: Document, path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return;

  let cur = root;
  for (const part of parts.slice(0, -1)) {
    let child = cur.children.find((node) => node.isDir && node.name === part);
    if (!child) {
      child = newDir(part);
      cur.children.push(child);
    }
    cur = child;
  }

  cur.children.push({
    name: parts[parts.length - 1],
    isDir: false,
    children: [],
    document: doc,
  });
}

function commonDirectory(paths: string[]): string {
  const dirs = paths.map((path) => path.split("/").filter(Boolean).slice(0, -1));
  const first = dirs[0] ?? [];
  let end = first.length;
  for (const dir of dirs.slice(1)) {
    end = Math.min(end, dir.length);
    for (let i = 0; i < end; i++) {
      if (dir[i] !== first[i]) {
        end = i;
        break;
      }
    }
  }
  return first.slice(0, end).join("/");
}

function sortNodes(nodes: LibraryTreeNode[]) {
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.isDir) sortNodes(node.children);
  }
}

export function buildLibraryTree(docs: Document[], libraryFolder: string | null): LibraryTreeNode[] {
  const root = newDir("root");
  const other = newDir("Other");
  const normalizedFolder = libraryFolder?.replace(/\/+$/, "") || null;
  const virtualRoot = normalizedFolder ? "" : commonDirectory(docs.map((doc) => doc.file_path));

  for (const doc of docs) {
    if (normalizedFolder) {
      if (isInsideFolder(doc.file_path, normalizedFolder)) {
        addDocument(root, doc, doc.file_path.slice(normalizedFolder.length).replace(/^\/+/, ""));
      } else {
        addDocument(other, doc, doc.file_path.split("/").pop() || doc.original_filename);
      }
    } else {
      addDocument(root, doc, doc.file_path.replace(/^\/+/, "").slice(virtualRoot.length).replace(/^\/+/, ""));
    }
  }

  if (other.children.length > 0) root.children.push(other);
  sortNodes(root.children);
  return root.children;
}
