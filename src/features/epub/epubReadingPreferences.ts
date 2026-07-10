export type EpubFontMode = "auto" | "manual";

export interface EpubReadingPreference {
  fontMode: EpubFontMode;
}

export const defaultEpubReadingPreference: EpubReadingPreference = { fontMode: "auto" };

export function epubReadingPreferenceKey(documentId: string): string {
  return `rustybooks:epub-reading:${documentId}`;
}

export function loadEpubReadingPreference(documentId: string, storage: Pick<Storage, "getItem"> = localStorage): EpubReadingPreference {
  try {
    const value = JSON.parse(storage.getItem(epubReadingPreferenceKey(documentId)) ?? "null");
    return {
      fontMode: value?.fontMode === "manual" ? "manual" : "auto",
    };
  } catch {
    return defaultEpubReadingPreference;
  }
}

export function autoFontPercentage(computedPixels: number): number {
  if (!Number.isFinite(computedPixels) || computedPixels <= 0) return 100;
  return Math.max(80, Math.min(150, Math.round(180 / computedPixels) * 10));
}
