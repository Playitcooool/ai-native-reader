export function shouldFollowScroll(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold = 72,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function draftFromSelection(text: string): string {
  return `About this selection:\n\n${text.trim()}`;
}

export function describeAiScope(pages: number[], documentType = "pdf"): string {
  const unit = documentType === "epub" ? "chapter" : "page";
  const clean = Array.from(new Set(pages.filter((page) => Number.isFinite(page) && page >= 1))).sort((a, b) => a - b);
  if (clean.length === 0) return `No ${unit} text selected`;
  if (clean.length === 1) return `Sends ${unit} ${clean[0]} text`;
  return `Sends ${clean.length} ${unit}s: ${clean[0]}-${clean[clean.length - 1]}`;
}
