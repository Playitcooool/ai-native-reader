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
import { parseInkAnchor, type InkToolState } from "../ink/inkGeometry";
import { draftFromSelection } from "../ai/aiPanelHelpers";
import { percentToChapter } from "./epubProgress";
import { epubCfiKey, parseEpubCfiAnchor, snapshotFromLocation, type EpubCfiAnchor, type EpubLocationSnapshot } from "./epubAnchors";

interface EpubViewerProps {
  documentId: string;
  onBackHome?: () => void;
  onOpenLibrary?: () => void;
  onOpenAi?: (draft?: string) => void;
}

type RenderedAnnotation = { cfi: string; type: "highlight" | "underline" };

export default function EpubViewer({ documentId, onBackHome, onOpenLibrary, onOpenAi }: EpubViewerProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const renderedAnnotationsRef = useRef<RenderedAnnotation[]>([]);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { currentDocument, currentPage, setCurrentPage, setTotalPages, loadToc, tocNodes, setActiveTocNodeId } = useDocumentStore();
  const annotations = useNotesStore((s) => s.annotations);
  const loadAnnotations = useNotesStore((s) => s.loadAnnotations);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const { addToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fontSize, setFontSize] = useState(() => Math.round((currentDocument?.last_zoom ?? 1) * 100));
  const [spineCount, setSpineCount] = useState(currentDocument?.page_count || 1);
  const [location, setLocation] = useState<EpubLocationSnapshot | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [selectionText, setSelectionText] = useState("");
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<EpubCfiAnchor | null>(null);
  const [inkRefreshKey, setInkRefreshKey] = useState(0);
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
    const root = getComputedStyle(document.documentElement);
    const rules = {
      body: {
        color: root.getPropertyValue("--text-primary").trim() || (theme === "dark" ? "#f8fafc" : "#111827"),
        background: root.getPropertyValue("--reader-bg").trim() || (theme === "dark" ? "#111827" : "#ffffff"),
      },
      "a, a:visited": {
        color: root.getPropertyValue("--accent-color").trim() || "#2563eb",
      },
      "::selection": {
        background: "rgba(37, 99, 235, 0.28)",
      },
    };
    rendition.themes.register("rustybooks", rules);
    rendition.themes.select("rustybooks");
    rendition.themes.fontSize(`${fontSize}%`);
  }, [fontSize, theme]);

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
  }, [annotations, theme]);

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

  const goPrevious = useCallback(() => {
    clearSelection();
    renditionRef.current?.prev().catch(() => {});
  }, [clearSelection]);

  const goNext = useCallback(() => {
    clearSelection();
    renditionRef.current?.next().catch(() => {});
  }, [clearSelection]);

  useEffect(() => {
    let dead = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        loadToc(documentId).catch(() => {});
        loadAnnotations(documentId).catch(() => {});
        if (currentDocument?.parse_status !== "ready") {
          invoke("extract_epub_content", { documentId, filePath: currentDocument?.file_path ?? "" }).catch(() => {});
        }

        const raw = await invoke<number[] | Uint8Array>("read_document_bytes", { documentId });
        if (dead) return;
        const bytes = new Uint8Array(raw);
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const book = ePub(arrayBuffer, { replacements: "blob" });
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
        rendition.on("relocated", (loc: unknown) => {
          const snapshot = snapshotFromLocation(loc);
          if (snapshot) persistLocation(snapshot);
        });
        rendition.on("rendered", () => {
          applyTheme();
          renderStoredAnnotations();
        });

        await book.ready;
        let count = 0;
        book.spine.each(() => { count++; });
        if (!dead) {
          setSpineCount(Math.max(1, count));
          setTotalPages(Math.max(1, count));
          invoke("update_page_count", { documentId, pageCount: Math.max(1, count) }).catch(() => {});
        }
        await book.locations.generate(1600).catch(() => null);
        applyTheme();
        const savedCfi = localStorage.getItem(epubCfiKey(documentId));
        const fallbackSection = percentToChapter(currentDocument?.last_page ?? 0, Math.max(1, count)) - 1;
        if (savedCfi) {
          await rendition.display(savedCfi);
        } else {
          await rendition.display(Math.max(0, fallbackSection));
        }
        if (!dead) setLoading(false);
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
    renderStoredAnnotations();
  }, [renderStoredAnnotations]);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const update = () => setFrameSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        setTheme(theme === "light" ? "dark" : "light");
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        clearSelection();
        setInkToolState((state) => ({ ...state, activeTool: "none" }));
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goPrevious(); }
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); goNext(); }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); setFontSize((s) => Math.min(200, s + 10)); }
      if (e.key === "-") { e.preventDefault(); setFontSize((s) => Math.max(50, s - 10)); }
      if (e.key === "0") { e.preventDefault(); setFontSize(100); }
      if ((e.key === "e" || e.key === "E") && selectionText) {
        e.preventDefault();
        onOpenAi?.(draftFromSelection(selectionText));
        clearSelection();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [clearSelection, goNext, goPrevious, onOpenAi, selectionText, setTheme, theme]);

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
        <button className="toolbar-text-button" onClick={onBackHome} aria-label="Back to home"><Icon name="home" />Back to home</button>
        <span className="toolbar-divider" />
        <button className="icon-button" onClick={goPrevious} disabled={atStart || loading} aria-label="Previous page"><Icon name="prev" /></button>
        <span className="page-control"><span>{loading ? "Loading" : `${progress}% - ${currentSpineIndex + 1}/${spineCount}`}</span></span>
        <button className="icon-button" onClick={goNext} disabled={atEnd || loading} aria-label="Next page"><Icon name="next" /></button>
        <button className="icon-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} title="Switch theme (Cmd+Shift+T)" aria-label="Toggle theme">
          <Icon name={theme === "light" ? "moon" : "sun"} />
        </button>
        <InkToolbarControls value={inkToolState} onChange={setInkToolState} />
        <span className="toolbar-center">
          <button className="toolbar-text-button" onClick={onOpenLibrary} aria-label="Open library"><Icon name="books" />Library</button>
          <button className="toolbar-text-button" onClick={() => onOpenAi?.()} aria-label="Open AI assistant"><Icon name="ask" />Ask</button>
        </span>
        <span className="toolbar-spacer" />
        <button className="icon-button" onClick={() => setFontSize((s) => Math.max(50, s - 10))} disabled={fontSize <= 50} aria-label="Zoom out"><Icon name="minus" /></button>
        <button className="zoom-reset" onClick={() => setFontSize(100)}>{fontSize}%</button>
        <button className="icon-button" onClick={() => setFontSize((s) => Math.min(200, s + 10))} disabled={fontSize >= 200} aria-label="Zoom in"><Icon name="plus" /></button>
      </div>

      {error ? (
        <div style={{ padding: 24, textAlign: "center" }}><p style={{ color: "var(--danger-color)" }}>{error}</p></div>
      ) : (
        <div className="epub-reader-frame">
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
                onChanged={() => setInkRefreshKey((key) => key + 1)}
              />
            </div>
          </div>
          <button className="epub-page-turn epub-page-turn-prev" onClick={goPrevious} disabled={atStart || loading} aria-label="Previous page"><Icon name="prev" /></button>
          <button className="epub-page-turn epub-page-turn-next" onClick={goNext} disabled={atEnd || loading} aria-label="Next page"><Icon name="next" /></button>
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
    </div>
  );
}
