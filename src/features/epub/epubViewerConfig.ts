export const EPUB_BOOK_OPTIONS = { replacements: "blobUrl" } as const;

export const EPUB_THEME_RULES = {
  "::selection": { background: "rgba(37, 99, 235, 0.28)" },
} as const;

export const EPUB_REFLOW_RULES = {
  "body": { "overflow-wrap": "anywhere" },
  "table": { width: "100% !important", "max-width": "100% !important", "table-layout": "fixed" },
  "pre, code": { "white-space": "pre-wrap", "overflow-wrap": "anywhere" },
  "video, canvas": { "max-width": "100% !important", "max-height": "100% !important", "object-fit": "contain" },
} as const;

export function epubThemeRules(fixedLayout: boolean) {
  return fixedLayout ? EPUB_THEME_RULES : { ...EPUB_THEME_RULES, ...EPUB_REFLOW_RULES };
}
