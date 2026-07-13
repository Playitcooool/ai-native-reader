import type { Contents } from "epubjs";
import type { EpubCfiAnchor } from "./epubAnchors";
import type { EpubTurn } from "./epubNavigation";

export function annotationChanges<T extends { id: string; signature: string }>(current: T[], wanted: T[]): { remove: T[]; add: T[] } {
  const old = new Map(current.map((item) => [item.id, item]));
  const next = new Map(wanted.map((item) => [item.id, item]));
  return {
    remove: current.filter((item) => next.get(item.id)?.signature !== item.signature),
    add: wanted.filter((item) => old.get(item.id)?.signature !== item.signature),
  };
}

export function selectionAnchorFromContents(cfiRange: string, selectedText: string, contents: Contents): EpubCfiAnchor {
  const section = (contents as Contents & { section?: { href?: string; index?: number } }).section;
  return { version: 1, space: "epub-cfi", cfiRange, selectedText, href: section?.href, spineIndex: section?.index };
}

export function gestureTurn(dx: number, dy: number, threshold = 60): EpubTurn | null {
  const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
  if (Math.abs(delta) < threshold) return null;
  return delta > 0 ? "next" : "previous";
}

export function directionalGestureTurn(dx: number, dy: number, direction: "ltr" | "rtl", threshold = 60): EpubTurn | null {
  const turn = gestureTurn(dx, dy, threshold);
  if (!turn || direction === "ltr" || Math.abs(dy) >= Math.abs(dx)) return turn;
  return turn === "next" ? "previous" : "next";
}

export function clearSearchMarks(document: Document): void {
  document.querySelectorAll("mark[data-rustybooks-search]").forEach((mark) => mark.replaceWith(...mark.childNodes));
  document.body?.normalize();
}

export function markSearchMatches(document: Document, query: string): HTMLElement[] {
  clearSearchMarks(document);
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || !document.body) return [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE && !(node.parentElement?.closest("script, style, mark"))) nodes.push(node as Text);
  }
  const marks: HTMLElement[] = [];
  for (const textNode of nodes) {
    const lower = textNode.data.toLocaleLowerCase();
    const indices: number[] = [];
    for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, index + needle.length)) indices.push(index);
    for (const index of indices.reverse()) {
      const match = textNode.splitText(index);
      match.splitText(needle.length);
      const mark = document.createElement("mark");
      mark.dataset.rustybooksSearch = "true";
      match.replaceWith(mark);
      mark.append(match);
      marks.unshift(mark);
    }
  }
  return marks;
}
