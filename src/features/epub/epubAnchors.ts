export interface EpubCfiAnchor {
  version: 1;
  space: "epub-cfi";
  cfiRange: string;
  selectedText: string;
  href?: string;
  spineIndex?: number;
}

export interface EpubLocationSnapshot {
  cfi: string;
  href?: string;
  spineIndex?: number;
  percent: number;
  atStart: boolean;
  atEnd: boolean;
}

export function epubCfiKey(documentId: string): string {
  return `rustybooks:epub-cfi:${documentId}`;
}

export function parseEpubCfiAnchor(value: string | null): EpubCfiAnchor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<EpubCfiAnchor>;
    if (
      parsed.version !== 1 ||
      parsed.space !== "epub-cfi" ||
      typeof parsed.cfiRange !== "string" ||
      parsed.cfiRange.trim() === "" ||
      typeof parsed.selectedText !== "string"
    ) {
      return null;
    }
    return {
      version: 1,
      space: "epub-cfi",
      cfiRange: parsed.cfiRange,
      selectedText: parsed.selectedText,
      href: typeof parsed.href === "string" ? parsed.href : undefined,
      spineIndex: typeof parsed.spineIndex === "number" ? parsed.spineIndex : undefined,
    };
  } catch {
    return null;
  }
}

export function locationToPercent(location: unknown): number {
  const percentage = (location as { start?: { percentage?: unknown } } | null)?.start?.percentage;
  if (typeof percentage === "number" && Number.isFinite(percentage)) {
    return Math.max(0, Math.min(100, Math.round(percentage * 100)));
  }
  return 0;
}

export function snapshotFromLocation(location: unknown): EpubLocationSnapshot | null {
  const loc = location as {
    start?: { cfi?: unknown; href?: unknown; index?: unknown };
    atStart?: unknown;
    atEnd?: unknown;
  } | null;
  const cfi = loc?.start?.cfi;
  if (typeof cfi !== "string" || !cfi) return null;
  return {
    cfi,
    href: typeof loc?.start?.href === "string" ? loc.start.href : undefined,
    spineIndex: typeof loc?.start?.index === "number" ? loc.start.index : undefined,
    percent: locationToPercent(location),
    atStart: loc?.atStart === true,
    atEnd: loc?.atEnd === true,
  };
}
