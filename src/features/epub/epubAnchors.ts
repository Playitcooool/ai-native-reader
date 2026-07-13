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

export interface SavedEpubLocation {
  version: 1;
  cfi?: string;
  spineIndex?: number;
  progress?: number;
}

export function epubCfiKey(documentId: string): string {
  return `rustybooks:epub-cfi:${documentId}`;
}

export function parseSavedEpubLocation(value: string | null): SavedEpubLocation | null {
  if (!value) return null;
  if (!value.trim().startsWith("{")) return { version: 1, cfi: value };
  try {
    const parsed = JSON.parse(value) as Partial<SavedEpubLocation>;
    if (parsed.version !== 1) return null;
    const cfi = typeof parsed.cfi === "string" && parsed.cfi ? parsed.cfi : undefined;
    const spineIndex = typeof parsed.spineIndex === "number" && Number.isInteger(parsed.spineIndex) && parsed.spineIndex >= 0 ? parsed.spineIndex : undefined;
    const progress = typeof parsed.progress === "number" && Number.isFinite(parsed.progress) ? Math.max(0, Math.min(100, parsed.progress)) : undefined;
    return cfi || spineIndex !== undefined || progress !== undefined ? { version: 1, cfi, spineIndex, progress } : null;
  } catch {
    return null;
  }
}

export function serializeSavedEpubLocation(location: EpubLocationSnapshot): string {
  return JSON.stringify({ version: 1, cfi: location.cfi, spineIndex: location.spineIndex, progress: location.percent } satisfies SavedEpubLocation);
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
