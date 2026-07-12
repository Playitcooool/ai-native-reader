export type EpubNavigationTarget = { kind: "cfi"; cfi: string } | { kind: "spine"; index: number };

export const EPUB_NAVIGATE_EVENT = "epub-navigate";

import { percentToChapter } from "./epubProgress";

export function annotationNavigationTarget(anchorJson: string | null, pageNumber: number, spineCount?: number): EpubNavigationTarget {
  try {
    const anchor = JSON.parse(anchorJson ?? "null") as { space?: unknown; cfiRange?: unknown; spineIndex?: unknown } | null;
    if (anchor?.space === "epub-cfi" && typeof anchor.cfiRange === "string" && anchor.cfiRange) {
      return { kind: "cfi", cfi: anchor.cfiRange };
    }
    if (typeof anchor?.spineIndex === "number") return { kind: "spine", index: Math.max(0, anchor.spineIndex) };
  } catch { /* legacy annotation */ }
  return { kind: "spine", index: Math.max(0, (spineCount ? percentToChapter(pageNumber, spineCount) : pageNumber) - 1) };
}

export function navigateEpub(target: EpubNavigationTarget): void {
  window.dispatchEvent(new CustomEvent<EpubNavigationTarget>(EPUB_NAVIGATE_EVENT, { detail: target }));
}
