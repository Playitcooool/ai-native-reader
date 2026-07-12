export type EpubFontMode = "auto" | "manual";

export interface EpubReadingPreference {
  fontMode: EpubFontMode;
  fontFamily: "book" | "serif" | "sans-serif";
  lineHeight: number;
  contentWidth: number;
}

export const defaultEpubReadingPreference: EpubReadingPreference = { fontMode: "auto", fontFamily: "book", lineHeight: 1.6, contentWidth: 760 };

export function epubReadingPreferenceKey(documentId: string): string {
  return `rustybooks:epub-reading:${documentId}`;
}

export function loadEpubReadingPreference(documentId: string, storage: Pick<Storage, "getItem"> = localStorage): EpubReadingPreference {
  try {
    const value = JSON.parse(storage.getItem(epubReadingPreferenceKey(documentId)) ?? "null");
    return {
      fontMode: value?.fontMode === "manual" ? "manual" : "auto",
      fontFamily: value?.fontFamily === "serif" || value?.fontFamily === "sans-serif" ? value.fontFamily : "book",
      lineHeight: typeof value?.lineHeight === "number" && value.lineHeight >= 1.2 && value.lineHeight <= 2.2 ? value.lineHeight : 1.6,
      contentWidth: typeof value?.contentWidth === "number" && value.contentWidth >= 480 && value.contentWidth <= 1200 ? value.contentWidth : 760,
    };
  } catch {
    return defaultEpubReadingPreference;
  }
}

export function autoFontPercentage(computedPixels: number): number {
  if (!Number.isFinite(computedPixels) || computedPixels <= 0) return 100;
  return Math.max(80, Math.min(150, Math.round(180 / computedPixels) * 10));
}
