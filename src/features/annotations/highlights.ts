export const HIGHLIGHT_COLORS = ["#fde047", "#86efac", "#93c5fd", "#f0abfc"] as const;
export type HighlightColor = typeof HIGHLIGHT_COLORS[number];

const LAST_COLOR_KEY = "rustybooks:last-highlight-color";

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === "string" && HIGHLIGHT_COLORS.includes(value as HighlightColor);
}

export function loadLastHighlightColor(storage?: Pick<Storage, "getItem">): HighlightColor {
  try {
    const color = (storage ?? globalThis.localStorage).getItem(LAST_COLOR_KEY);
    return isHighlightColor(color) ? color : HIGHLIGHT_COLORS[0];
  } catch {
    return HIGHLIGHT_COLORS[0];
  }
}

export function saveLastHighlightColor(color: HighlightColor, storage?: Pick<Storage, "setItem">): void {
  try { (storage ?? globalThis.localStorage).setItem(LAST_COLOR_KEY, color); } catch { /* storage may be unavailable */ }
}

export function isHighlightShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "target">,
  actionable: boolean,
): boolean {
  if (!actionable || event.key.toLowerCase() !== "b" || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return false;
  const target = event.target as Element | null;
  return !target?.closest?.("input, textarea, select, button, [contenteditable], [role='dialog'], [aria-label='Text selection actions']");
}

export async function createHighlight(options: {
  documentId: string;
  pageNumber: number;
  selectedText: string;
  anchor: unknown;
  color?: HighlightColor;
  create: (input: unknown) => Promise<{ id: string }>;
  remove: (id: string) => Promise<unknown>;
  pushUndo: (item: { label: string; undo: () => Promise<void> }) => void;
  refresh: () => void;
}): Promise<void> {
  const color = options.color ?? loadLastHighlightColor();
  const annotation = await options.create({
    document_id: options.documentId,
    page_number: options.pageNumber,
    type: "highlight",
    selected_text: options.selectedText,
    note_text: null,
    color,
    anchor: options.anchor == null ? null : JSON.stringify(options.anchor),
  });
  options.pushUndo({ label: "highlight", undo: async () => { await options.remove(annotation.id); } });
  options.refresh();
}
