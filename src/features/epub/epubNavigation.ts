export type EpubTurn = "previous" | "next";

export function epubTurnForKey(key: string, readingDirection: "ltr" | "rtl"): EpubTurn | null {
  if (key === "ArrowLeft") return readingDirection === "rtl" ? "next" : "previous";
  if (key === "ArrowRight") return readingDirection === "rtl" ? "previous" : "next";
  if (key === "PageUp") return "previous";
  if (key === "PageDown" || key === " ") return "next";
  return null;
}
