import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ePub, { type Book, type Contents, type Rendition } from "epubjs";
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "../../stores/documentStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useNotesStore } from "../../stores/notesStore";
import { useToast } from "../../components/Toast";
import { Icon } from "../../components/Icons";
import SelectionMenu from "../pdf/SelectionMenu";
import InkCanvasOverlay from "../ink/InkCanvasOverlay";
import InkToolbarControls from "../ink/InkToolbarControls";
import { parseInkAnchor, projectEpubInk, simplifyLocalPoints, type EpubInkAnchor, type InkAnchor, type InkPoint, type InkToolState } from "../ink/inkGeometry";
import { draftFromSelection } from "../ai/aiPanelHelpers";
import { isAllowedExternalUrl, openExternalUrl } from "../links/externalLinks";
import { percentToChapter } from "./epubProgress";
import { epubCfiKey, parseEpubCfiAnchor, snapshotFromLocation, type EpubCfiAnchor, type EpubLocationSnapshot } from "./epubAnchors";
import { EPUB_BOOK_OPTIONS, epubThemeRules } from "./epubViewerConfig";
import { autoFontPercentage, epubReadingPreferenceKey, loadEpubReadingPreference, type EpubFontMode } from "./epubReadingPreferences";
import { displayEpubStart } from "./epubDisplay";
import { epubTurnForKey, type EpubTurn } from "./epubNavigation";
import { EPUB_NAVIGATE_EVENT, type EpubNavigationTarget } from "./epubNavigationTarget";
import ShortcutsModal from "../../components/ShortcutsModal";

interface EpubViewerProps {
  documentId: string;
  onBackHome?: () => void;
  onOpenLibrary?: () => void;
  onOpenContents?: () => void;
  onOpenAi?: (draft?: string) => void;
}

type RenderedAnnotation = { cfi: string; type: "highlight" | "underline" };

export default function EpubViewer({ documentId, onBackHome, onOpenLibrary, onOpenContents, onOpenAi }: EpubViewerProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const renderedAnnotationsRef = useRef<RenderedAnnotation[]>([]);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turningRef = useRef(false);
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const preferenceRef = useRef(loadEpubReadingPreference(documentId));
  const baseFontSizeRef = useRef<number | null>(null);
  const fixedLayoutRef = useRef(false);
  const linkDocumentsRef = useRef<Set<Document>>(new Set());
  const { currentDocument, currentPage, setCurrentPage, setTotalPages, loadToc, tocNodes, setActiveTocNodeId } = useDocumentStore();
  const annotations = useNotesStore((s) => s.annotations);
  const loadAnnotations = useNotesStore((s) => s.loadAnnotations);
  const theme = useSettingsStore((s) => s.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  const { addToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [turning, setTurning] = useState(false);
  const [readingDirection, setReadingDirection] = useState<"ltr" | "rtl">("ltr");
  const [fontMode, setFontMode] = useState<EpubFontMode>(() => preferenceRef.current.fontMode);
  const [fontFamily, setFontFamily] = useState(() => preferenceRef.current.fontFamily);
  const [lineHeight, setLineHeight] = useState(() => preferenceRef.current.lineHeight);
  const [contentWidth, setContentWidth] = useState(() => preferenceRef.current.contentWidth);
  const [fontSize, setFontSize] = useState(() => preferenceRef.current.fontMode === "manual" ? Math.round((currentDocument?.last_zoom ?? 1) * 100) : 100);
  const [spineCount, setSpineCount] = useState(currentDocument?.page_count || 1);
  const [location, setLocation] = useState<EpubLocationSnapshot | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [selectionText, setSelectionText] = useState("");
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<EpubCfiAnchor | null>(null);
  const [inkRefreshKey, setInkRefreshKey] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ pageNum: number; context: string }>>([]);
  const [searchResultIndex, setSearchResultIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [inkToolState, setInkToolState] = useState<InkToolState>({
    activeTool: "none",
    color: "#111827",
    penWidth: 4,
  });

  const pageNumber = Math.max(1, location?.percent || currentPage || 1);
  const progress = location?.percent ?? currentDocument?.last_page ?? 0;
  const atStart = location?.atStart ?? true;
  const atEnd = location?.atEnd ?? false;
  const currentSpineIndex = location?.spineIndex ?? 0;

  const inkAnnotations = useMemo(
    () => annotations.filter((annotation) => {
      if (annotation.type !== "ink") return false;
      const anchor = parseInkAnchor(annotation.anchor_json);
      if (!anchor || anchor.space !== "epub-rendition") return false;
      if (anchor.visibleCfi && location?.cfi) return anchor.visibleCfi === location.cfi;
      if (typeof anchor.spineIndex === "number" && typeof location?.spineIndex === "number") return anchor.spineIndex === location.spineIndex;
      return Boolean(anchor.href && anchor.href === location?.href);
    }),
    [annotations, inkRefreshKey, location?.cfi, location?.href, location?.spineIndex],
  );

  const clearSelection = useCallback(() => {
    setSelectionText("");
    setSelectionPos(null);
    setSelectionAnchor(null);
    window.getSelection()?.removeAllRanges();
    const contentsList = (renditionRef.current?.getContents?.() ?? []) as Contents | Contents[];
    for (const contents of Array.isArray(contentsList) ? contentsList : [contentsList]) {
      contents.window.getSelection()?.removeAllRanges();
    }
  }, []);

  const persistLocation = useCallback((next: EpubLocationSnapshot) => {
    localStorage.setItem(epubCfiKey(documentId), next.cfi);
    setLocation(next);
    setCurrentPage(Math.max(1, next.percent || 1));
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    locationDebounceRef.current = setTimeout(() => {
      invoke("update_last_page", { documentId, pageNumber: next.percent }).catch(() => {});
    }, 250);
  }, [documentId, setCurrentPage]);

  const applyTheme = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const themes = rendition.themes as typeof rendition.themes & { removeOverride(name: string): void };
    themes.register("rustybooks", epubThemeRules(fixedLayoutRef.current));
    themes.select("rustybooks");
    if (fontSize === 100) themes.removeOverride("font-size");
    else themes.fontSize(`${fontSize}%`);
    themes.override("font-family", fontFamily === "book" ? "initial" : fontFamily === "serif" ? "Georgia, serif" : "Arial, sans-serif");
    themes.override("line-height", String(lineHeight));
    if (!fixedLayoutRef.current) themes.override("max-width", `${contentWidth}px`, true);
  }, [contentWidth, fontFamily, fontSize, lineHeight]);

  const recalculateAutoFont = useCallback(() => {
    if (preferenceRef.current.fontMode !== "auto") return;
    const contentsList = (renditionRef.current?.getContents?.() ?? []) as Contents | Contents[];
    const contents = (Array.isArray(contentsList) ? contentsList : [contentsList])[0];
    const root = contents?.document.body ?? contents?.document.documentElement;
    if (!root) return;
    const computed = Number.parseFloat(contents.window.getComputedStyle(root).fontSize);
    const base = computed / (fontSize / 100);
    if (Number.isFinite(base) && base > 0) baseFontSizeRef.current = base;
    if (baseFontSizeRef.current) setFontSize(autoFontPercentage(baseFontSizeRef.current));
  }, [fontSize]);

  const renderStoredAnnotations = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    for (const item of renderedAnnotationsRef.current) {
      rendition.annotations.remove(item.cfi, item.type);
    }
    renderedAnnotationsRef.current = [];

    for (const annotation of annotations) {
      if (annotation.type !== "highlight" && annotation.type !== "note") continue;
      const anchor = parseEpubCfiAnchor(annotation.anchor_json);
      if (!anchor) continue;
      if (annotation.type === "note") {
        rendition.annotations.underline(anchor.cfiRange, { id: annotation.id }, undefined, "rustybooks-epub-note", {
          stroke: annotation.color || "#f97316",
          "stroke-width": "2px",
          "stroke-opacity": "0.85",
        });
        renderedAnnotationsRef.current.push({ cfi: anchor.cfiRange, type: "underline" });
      } else {
        rendition.annotations.highlight(anchor.cfiRange, { id: annotation.id }, undefined, "rustybooks-epub-highlight", {
          fill: annotation.color || "#fde047",
          "fill-opacity": "0.36",
          "mix-blend-mode": theme === "dark" ? "screen" : "multiply",
        });
        renderedAnnotationsRef.current.push({ cfi: anchor.cfiRange, type: "highlight" });
      }
    }

    const contentsList = (rendition.getContents?.() ?? []) as Contents | Contents[];
    for (const contents of Array.isArray(contentsList) ? contentsList : [contentsList]) {
      contents.document.getElementById("rustybooks-epub-ink")?.remove();
      const svg = contents.document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "rustybooks-epub-ink";
      svg.setAttribute("style", "position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:2147483646");
      const font = Number.parseFloat(contents.window.getComputedStyle(contents.document.body ?? contents.document.documentElement).fontSize) || 16;
      for (const annotation of annotations) {
        const anchor = parseInkAnchor(annotation.anchor_json);
        if (!anchor || anchor.version !== 2 || (anchor.href && anchor.href !== location?.href)) continue;
        let rect: DOMRect;
        try { rect = contents.range(anchor.cfi).getBoundingClientRect(); } catch { continue; }
        const points = projectEpubInk(anchor, { x: rect.left + contents.window.scrollX, y: rect.top + contents.window.scrollY }, font);
        const path = contents.document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        path.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", annotation.color || "#111827");
        path.setAttribute("stroke-width", String(anchor.width * font));
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        svg.append(path);
      }
      contents.document.body?.append(svg);
    }
  }, [annotations, location?.href, theme]);

  const makeEpubInkAnchor = useCallback((points: InkPoint[], width: number): InkAnchor | null => {
    const contentsList = (renditionRef.current?.getContents?.() ?? []) as Contents | Contents[];
    const contents = (Array.isArray(contentsList) ? contentsList : [contentsList])[0];
    if (!contents || !location?.cfi) return null;
    let rect: DOMRect;
    try { rect = contents.range(location.cfi).getBoundingClientRect(); } catch { return null; }
    const frameRect = (contents.window.frameElement as HTMLElement | null)?.getBoundingClientRect();
    const hostRect = frameRef.current?.getBoundingClientRect();
    if (!frameRect || !hostRect) return null;
    const font = Number.parseFloat(contents.window.getComputedStyle(contents.document.body ?? contents.document.documentElement).fontSize) || 16;
    const origin = { x: frameRect.left - hostRect.left + rect.left, y: frameRect.top - hostRect.top + rect.top };
    const local = simplifyLocalPoints(points).map((point) => ({ x: (point.x - origin.x) / font, y: (point.y - origin.y) / font }));
    if (local.length < 2) return null;
    return { version: 2, space: "epub-content", cfi: location.cfi, href: location.href, spineIndex: location.spineIndex, fontSize: font, points: local, width: width / font } satisfies EpubInkAnchor;
  }, [location]);

  const handleSelected = useCallback((cfiRange: string, contents: Contents) => {
    const selection = contents.window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!text || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const frameElement = contents.window.frameElement as HTMLElement | null;
    const frameRect = frameElement?.getBoundingClientRect();
    setSelectionText(text);
    setSelectionAnchor({
      version: 1,
      space: "epub-cfi",
      cfiRange,
      selectedText: text,
      href: location?.href,
      spineIndex: location?.spineIndex,
    });
    setSelectionPos(frameRect
      ? { x: frameRect.left + rect.left + rect.width / 2, y: frameRect.top + rect.top }
      : { x: rect.left + rect.width / 2, y: rect.top });
  }, [location?.href, location?.spineIndex]);

  const turnPage = useCallback((direction: EpubTurn) => {
    const rendition = renditionRef.current;
    if (!rendition || turningRef.current) return;
    clearSelection();
    turningRef.current = true;
    setTurning(true);
    Promise.resolve().then(() => direction === "previous" ? rendition.prev() : rendition.next())
      .catch(() => {})
      .finally(() => {
        turningRef.current = false;
        setTurning(false);
      });
  }, [clearSelection]);

  const goPrevious = useCallback(() => turnPage("previous"), [turnPage]);
  const goNext = useCallback(() => turnPage("next"), [turnPage]);
  const goLeft = readingDirection === "rtl" ? goNext : goPrevious;
  const goRight = readingDirection === "rtl" ? goPrevious : goNext;

  const handleLinkClick = useCallback((event: MouseEvent) => {
    const target = event.target as Element | null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor || !isAllowedExternalUrl(anchor.href)) return;
    event.preventDefault();
    event.stopPropagation();
    openExternalUrl(anchor.href).catch(() => addToast({ type: "error", message: "Could not open link." }));
  }, [addToast]);

  const handleWheel = useCallback((event: WheelEvent) => event.preventDefault(), []);

  const attachLinkListeners = useCallback(() => {
    const contentsList = (renditionRef.current?.getContents?.() ?? []) as Contents | Contents[];
    for (const contents of Array.isArray(contentsList) ? contentsList : [contentsList]) {
      const doc = contents.document;
      if (linkDocumentsRef.current.has(doc)) continue;
      (contents.window.frameElement as HTMLElement | null)?.setAttribute("title", "EPUB book content");
      doc.addEventListener("click", handleLinkClick, true);
      doc.addEventListener("wheel", handleWheel, { passive: false });
      linkDocumentsRef.current.add(doc);
    }
  }, [handleLinkClick, handleWheel]);

  const removeLinkListeners = useCallback(() => {
    for (const doc of linkDocumentsRef.current) {
      doc.removeEventListener("click", handleLinkClick, true);
      doc.removeEventListener("wheel", handleWheel);
    }
    linkDocumentsRef.current.clear();
  }, [handleLinkClick, handleWheel]);

  useEffect(() => {
    let dead = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        loadToc(documentId).catch(() => {});
        loadAnnotations(documentId).catch(() => {});
        const raw = await invoke<ArrayBuffer>("read_document_bytes", { documentId });
        if (dead) return;
        const bytes = new Uint8Array(raw);
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const book = ePub(arrayBuffer, EPUB_BOOK_OPTIONS);
        const rendition = book.renderTo(frameRef.current!, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          spread: "none",
          allowScriptedContent: false,
        });
        bookRef.current = book;
        renditionRef.current = rendition;

        rendition.on("selected", handleSelected);
        rendition.on("keydown", (event: KeyboardEvent) => keyHandlerRef.current(event));
        rendition.on("relocated", (loc: unknown) => {
          const snapshot = snapshotFromLocation(loc);
          if (snapshot) persistLocation(snapshot);
        });
        rendition.on("rendered", () => {
          applyTheme();
          requestAnimationFrame(recalculateAutoFont);
          renderStoredAnnotations();
          attachLinkListeners();
        });

        await book.ready;
        setReadingDirection((book.packaging.metadata as { direction?: string }).direction === "rtl" ? "rtl" : "ltr");
        fixedLayoutRef.current = book.packaging.metadata.layout === "pre-paginated"
          || (book as Book & { displayOptions?: { fixedLayout?: string } }).displayOptions?.fixedLayout === "true";
        let count = 0;
        book.spine.each(() => { count++; });
        if (!dead) {
          setSpineCount(Math.max(1, count));
          setTotalPages(Math.max(1, count));
          invoke("update_page_count", { documentId, pageCount: Math.max(1, count) }).catch(() => {});
        }
        applyTheme();
        const savedCfi = localStorage.getItem(epubCfiKey(documentId));
        const fallbackSection = percentToChapter(currentDocument?.last_page ?? 0, Math.max(1, count)) - 1;
        const restoredSavedCfi = await displayEpubStart(
          (target) => typeof target === "string" ? rendition.display(target) : rendition.display(target),
          savedCfi,
          Math.max(0, fallbackSection),
        );
        if (savedCfi && !restoredSavedCfi && localStorage.getItem(epubCfiKey(documentId)) === savedCfi) {
          localStorage.removeItem(epubCfiKey(documentId));
        }
        if (!dead) {
          setLoading(false);
          void book.locations.generate(1600).catch(() => null);
        }
      } catch (err) {
        if (!dead) {
          setError(`Failed to load EPUB: ${err}`);
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      dead = true;
      if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
      removeLinkListeners();
      renderedAnnotationsRef.current = [];
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      renditionRef.current = null;
      bookRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  useEffect(() => { applyTheme(); }, [applyTheme]);

  useEffect(() => {
    const frame = requestAnimationFrame(renderStoredAnnotations);
    return () => cancelAnimationFrame(frame);
  }, [fontSize, frameSize.height, frameSize.width, renderStoredAnnotations]);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      setFrameSize({ width: element.clientWidth, height: element.clientHeight });
      if (timer) clearTimeout(timer);
      timer = setTimeout(recalculateAutoFont, 150);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { observer.disconnect(); if (timer) clearTimeout(timer); };
  }, [recalculateAutoFont]);

  useEffect(() => {
    preferenceRef.current = { fontMode, fontFamily, lineHeight, contentWidth };
    localStorage.setItem(epubReadingPreferenceKey(documentId), JSON.stringify(preferenceRef.current));
  }, [contentWidth, documentId, fontFamily, fontMode, lineHeight]);

  useEffect(() => {
    const navigate = (event: Event) => {
      const target = (event as CustomEvent<EpubNavigationTarget>).detail;
      clearSelection();
      const display = target.kind === "cfi" ? renditionRef.current?.display(target.cfi) : renditionRef.current?.display(target.index);
      display?.catch(() =>
        addToast({ type: "error", message: "Could not open that EPUB location." }));
    };
    window.addEventListener(EPUB_NAVIGATE_EVENT, navigate);
    return () => window.removeEventListener(EPUB_NAVIGATE_EVENT, navigate);
  }, [addToast, clearSelection]);

  const markSearchText = useCallback((query: string) => {
    const contentsList = (renditionRef.current?.getContents?.() ?? []) as Contents | Contents[];
    for (const contents of Array.isArray(contentsList) ? contentsList : [contentsList]) {
      contents.document.querySelectorAll("mark[data-rustybooks-search]").forEach((mark) => mark.replaceWith(...mark.childNodes));
      if (!query) continue;
      const walker = contents.document.createTreeWalker(contents.document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const index = node.textContent?.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) ?? -1;
        if (index < 0 || !node.parentElement || node.parentElement.closest("script, style")) continue;
        const range = contents.document.createRange();
        range.setStart(node, index); range.setEnd(node, index + query.length);
        const mark = contents.document.createElement("mark");
        mark.dataset.rustybooksSearch = "true";
        range.surroundContents(mark);
        mark.scrollIntoView({ block: "center" });
        break;
      }
    }
  }, []);

  const goToSearchResult = useCallback(async (index: number) => {
    const result = searchResults[index];
    if (!result || !renditionRef.current) return;
    setSearchResultIndex(index);
    await renditionRef.current.display(Math.max(0, result.pageNum - 1));
    requestAnimationFrame(() => markSearchText(searchQuery));
  }, [markSearchText, searchQuery, searchResults]);

  const performSearch = useCallback(async () => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    setIsSearching(true);
    try {
      const results = await invoke<Array<{ pageNum: number; context: string }>>("search_pages_text", { documentId, query: searchQuery, limit: 200 });
      setSearchResults(results); setSearchResultIndex(0);
      if (results.length) {
        await renditionRef.current?.display(Math.max(0, results[0].pageNum - 1));
        requestAnimationFrame(() => markSearchText(searchQuery));
      }
    } catch { addToast({ type: "error", message: "EPUB search failed." }); }
    finally { setIsSearching(false); }
  }, [addToast, documentId, markSearchText, searchQuery]);

  const adjustFont = useCallback((delta: number) => {
    setFontMode("manual");
    preferenceRef.current = { ...preferenceRef.current, fontMode: "manual" };
    setFontSize((size) => Math.max(50, Math.min(200, size + delta)));
  }, []);

  const resetAutoFont = useCallback(() => {
    setFontMode("auto");
    preferenceRef.current = { ...preferenceRef.current, fontMode: "auto" };
    recalculateAutoFont();
  }, [recalculateAutoFont]);

  useEffect(() => {
    let best: typeof tocNodes[0] | null = null;
    for (const node of tocNodes) {
      if (node.start_page <= currentSpineIndex + 1 && (node.end_page === null || currentSpineIndex + 1 <= node.end_page)) best = node;
    }
    setActiveTocNodeId(best?.id ?? null);
  }, [currentSpineIndex, setActiveTocNodeId, tocNodes]);

  useEffect(() => {
    const refresh = () => {
      setInkRefreshKey((key) => key + 1);
      loadAnnotations(documentId).catch(() => {});
    };
    window.addEventListener("annotations-changed", refresh);
    return () => window.removeEventListener("annotations-changed", refresh);
  }, [documentId, loadAnnotations]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        toggleTheme();
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      const target = e.target as { closest?: (selector: string) => Element | null } | null;
      if (target?.closest?.("input, textarea, select, button, a, [contenteditable]")) return;
      if (e.key === "Escape") {
        if (showSearch) { setShowSearch(false); markSearchText(""); }
        setShowShortcuts(false);
        clearSelection();
        setInkToolState((state) => ({ ...state, activeTool: "none" }));
      }
      if (e.key === "?") { e.preventDefault(); setShowShortcuts((value) => !value); }
      const turn = epubTurnForKey(e.key, readingDirection);
      if (turn) { e.preventDefault(); turnPage(turn); }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); adjustFont(10); }
      if (e.key === "-") { e.preventDefault(); adjustFont(-10); }
      if (e.key === "0") { e.preventDefault(); resetAutoFont(); }
      if ((e.key === "e" || e.key === "E") && selectionText) {
        e.preventDefault();
        onOpenAi?.(draftFromSelection(selectionText));
        clearSelection();
      }
    };
    keyHandlerRef.current = handleKey;
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [adjustFont, clearSelection, markSearchText, onOpenAi, readingDirection, resetAutoFont, selectionText, showSearch, toggleTheme, turnPage]);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") { event.preventDefault(); setShowSearch(true); }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentDocument) invoke("update_last_zoom", { documentId, zoom: fontSize / 100 }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [fontSize, documentId, currentDocument]);

  const handleTranslate = useCallback(async (text: string) => {
    try {
      return await invoke<string>("translate_text", { input: { selected_text: text } });
    } catch {
      addToast({ type: "error", message: "Translation failed." });
      return null;
    }
  }, [addToast]);

  return (
    <div className="pdf-viewer">
      <div className="reader-toolbar">
        <button className="toolbar-text-button toolbar-home" onClick={onBackHome} aria-label="Back to library"><Icon name="home" />Library</button>
        <span className="toolbar-divider" />
        <button className="icon-button" onClick={goLeft} disabled={(readingDirection === "rtl" ? atEnd : atStart) || loading || turning} aria-label={readingDirection === "rtl" ? "Next page" : "Previous page"}><Icon name="prev" /></button>
        <span className="page-control" role="status" aria-live="polite"><span>{loading ? "Loading" : `${progress}% · Section ${currentSpineIndex + 1} of ${spineCount}`}</span></span>
        <button className="icon-button" onClick={goRight} disabled={(readingDirection === "rtl" ? atStart : atEnd) || loading || turning} aria-label={readingDirection === "rtl" ? "Previous page" : "Next page"}><Icon name="next" /></button>
        <button className="icon-button" onClick={toggleTheme} title="Switch theme (Cmd+Shift+T)" aria-label="Toggle theme">
          <Icon name={theme === "light" ? "moon" : "sun"} />
        </button>
        <button className={`icon-button ${showSearch ? "active" : ""}`} onClick={() => setShowSearch((value) => !value)} title="Search (Ctrl+F)" aria-label="Toggle search"><Icon name="search" /></button>
        <InkToolbarControls value={inkToolState} onChange={setInkToolState} />
        <span className="toolbar-center">
          <button className="toolbar-text-button" onClick={onOpenContents} aria-label="Open contents"><Icon name="contents" />Contents</button>
          <button className="toolbar-text-button" onClick={onOpenLibrary} aria-label="Open books"><Icon name="books" />Books</button>
          <button className="toolbar-text-button" onClick={() => onOpenAi?.()} aria-label="Open AI assistant"><Icon name="ask" />Ask</button>
        </span>
        <span className="toolbar-spacer" />
        <button className="icon-button" onClick={() => adjustFont(-10)} disabled={fontSize <= 50} aria-label="Decrease text size"><Icon name="minus" /></button>
        <button className="zoom-reset" onClick={resetAutoFont} aria-label="Use automatic text size">{fontMode === "auto" ? "Auto" : `${fontSize}%`}</button>
        <button className="icon-button" onClick={() => adjustFont(10)} disabled={fontSize >= 200} aria-label="Increase text size"><Icon name="plus" /></button>
        <button className="icon-button" onClick={() => setShowAppearance((value) => !value)} aria-label="Reading appearance"><Icon name="gear" /></button>
      </div>

      {showSearch && <div className="search-bar">
        <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void performSearch(); }} placeholder="Search in book…" autoFocus />
        <button className="primary-action" onClick={() => void performSearch()} disabled={isSearching || !searchQuery.trim()}>{isSearching ? "Searching" : "Search"}</button>
        <span className="search-count">{searchResults.length ? `${searchResultIndex + 1} / ${searchResults.length}` : searchQuery && !isSearching ? "No results" : ""}</span>
        <button className="icon-button" onClick={() => void goToSearchResult(searchResultIndex - 1)} disabled={searchResultIndex <= 0} aria-label="Previous result"><Icon name="prev" /></button>
        <button className="icon-button" onClick={() => void goToSearchResult(searchResultIndex + 1)} disabled={searchResultIndex >= searchResults.length - 1} aria-label="Next result"><Icon name="next" /></button>
        <button className="icon-button" onClick={() => { setShowSearch(false); markSearchText(""); }} aria-label="Close search"><Icon name="close" /></button>
      </div>}
      {showAppearance && <div className="epub-appearance" role="dialog" aria-label="Reading appearance">
        <label>Font<select value={fontFamily} onChange={(event) => setFontFamily(event.target.value as typeof fontFamily)}><option value="book">Book</option><option value="serif">Serif</option><option value="sans-serif">Sans serif</option></select></label>
        <label>Line spacing<input type="range" min="1.2" max="2.2" step="0.1" value={lineHeight} onChange={(event) => setLineHeight(Number(event.target.value))} /></label>
        <label>Text width<input type="range" min="480" max="1200" step="40" value={contentWidth} onChange={(event) => setContentWidth(Number(event.target.value))} /></label>
      </div>}

      {error ? (
        <div style={{ padding: 24, textAlign: "center" }}><p style={{ color: "var(--danger-color)" }}>{error}</p></div>
      ) : (
        <div className="epub-reader-frame" onWheel={(event) => event.preventDefault()}>
          <div ref={frameRef} className="epub-rendition-host" />
          {loading && <div className="epub-loading">Loading EPUB...</div>}
          <div className="epub-ink-layer">
            <div className="epub-ink-page" style={{ width: frameSize.width, height: frameSize.height }}>
              <InkCanvasOverlay
                documentId={documentId}
                pageNumber={pageNumber}
                width={frameSize.width}
                height={frameSize.height}
                annotations={inkAnnotations}
                toolState={inkToolState}
                space="epub-rendition"
                sectionIndex={currentSpineIndex}
                spineIndex={currentSpineIndex}
                href={location?.href}
                cfi={location?.cfi}
                visibleCfi={location?.cfi}
                makeAnchor={makeEpubInkAnchor}
                onChanged={() => setInkRefreshKey((key) => key + 1)}
              />
            </div>
          </div>
          <button className="epub-page-turn epub-page-turn-prev" onClick={goLeft} disabled={(readingDirection === "rtl" ? atEnd : atStart) || loading || turning} aria-label={readingDirection === "rtl" ? "Next page" : "Previous page"}><Icon name="prev" /></button>
          <button className="epub-page-turn epub-page-turn-next" onClick={goRight} disabled={(readingDirection === "rtl" ? atStart : atEnd) || loading || turning} aria-label={readingDirection === "rtl" ? "Previous page" : "Next page"}><Icon name="next" /></button>
        </div>
      )}

      {selectionText && (
        <SelectionMenu
          selectedText={selectionText}
          pageNumber={pageNumber}
          documentId={documentId}
          anchor={selectionAnchor ?? undefined}
          position={selectionPos}
          onClose={clearSelection}
          onAsk={(text) => onOpenAi?.(draftFromSelection(text))}
          onExplain={() => {
            onOpenAi?.(draftFromSelection(selectionText));
            clearSelection();
          }}
          onTranslate={handleTranslate}
        />
      )}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
