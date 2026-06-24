import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ePub from "epubjs";
import type { Book, Rendition } from "epubjs";
import { useDocumentStore } from "../../stores/documentStore";
import { useSettingsStore } from "../../stores/settingsStore";

interface EpubViewerProps {
  documentId: string;
  onBackHome?: () => void;
  onOpenLibrary?: () => void;
  onOpenAi?: (draft?: string) => void;
}

function Icon({ name }: { name: "home" | "books" | "ask" | "prev" | "next" | "search" | "moon" | "sun" | "minus" | "plus" | "close" }) {
  const common = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, JSX.Element> = {
    books: <><path d="M4 19.5V5a2 2 0 0 1 2-2h11" /><path d="M6 17h13" /><path d="M6 21h13V7H6a2 2 0 0 0 0 4" /></>,
    home: <><path d="m15 18-6-6 6-6" /><path d="M20 12H9" /><path d="M5 19V5" /></>,
    ask: <><path d="M12 3a7 7 0 0 1 7 7c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 7-7Z" /><path d="M12 8v4" /><path d="M12 16h.01" /></>,
    prev: <><path d="m15 18-6-6 6-6" /></>,
    next: <><path d="m9 18 6-6-6-6" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    moon: <><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.9 4.9 1.4 1.4" /><path d="m17.7 17.7 1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.3 17.7-1.4 1.4" /><path d="m19.1 4.9-1.4 1.4" /></>,
    minus: <><path d="M5 12h14" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  };
  return <svg aria-hidden="true" {...common}>{paths[name]}</svg>;
}

export default function EpubViewer({ documentId, onBackHome, onOpenLibrary, onOpenAi }: EpubViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(100);
  const { currentDocument, setCurrentPage, setTocNodes } = useDocumentStore();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  // Load EPUB
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    const load = async () => {
      try {
        const data = await invoke<number[] | Uint8Array>("read_document_bytes", { documentId });
        const buf = data instanceof Uint8Array ? (data as Uint8Array).buffer : new Uint8Array(data).buffer;
        const book = ePub(buf as ArrayBuffer);
        bookRef.current = book;

        const rendition = book.renderTo(containerRef.current!, {
          flow: "scrolled-doc",
          width: "100%",
          height: "100%",
          spread: "none",
        });
        renditionRef.current = rendition;

        // Restore position (last_page as 0-100 scroll percentage)
        const startPct = currentDocument?.last_page ?? 0;
        if (startPct > 0) {
          await book.locations.generate(100);
          const target = book.locations.cfiFromPercentage(startPct / 100);
          await rendition.display(target);
        } else {
          await rendition.display();
        }

        // Track scroll position
        rendition.on("relocated", (location: any) => {
          if (location?.start?.percentage) {
            const pct = Math.round(location.start.percentage * 100);
            setCurrentPage(pct);
            invoke("update_last_page", { documentId, pageNumber: pct }).catch(() => {});
          }
        });

        // Extract TOC from epubjs navigation
        const nav = book.navigation?.toc ?? [];
        if (nav.length > 0) {
          const flattenNav = (items: any[], level: number, order: { v: number }): any[] => {
            const result: any[] = [];
            for (const item of items) {
              result.push({
                id: `${documentId}-toc-${order.v}`,
                title: item.label,
                level,
                start_page: order.v + 1,
                end_page: null,
                order_index: order.v,
              });
              order.v++;
              if (item.subitems?.length) {
                result.push(...flattenNav(item.subitems, level + 1, order));
              }
            }
            return result;
          };
          const flat = flattenNav(nav, 0, { v: 0 });
          setTocNodes(flat);
        }
      } catch (err) {
        if (!destroyed) setError(`Failed to load EPUB: ${err}`);
      }
    };
    load();

    return () => {
      destroyed = true;
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Apply font size
  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.themes?.fontSize(`${fontSize}%`);
  }, [fontSize]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        setTheme(theme === "light" ? "dark" : "light");
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        const container = containerRef.current;
        if (container) container.scrollTop -= container.clientHeight * 0.8;
      }
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        const container = containerRef.current;
        if (container) container.scrollTop += container.clientHeight * 0.8;
      }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); setFontSize((s) => Math.min(200, s + 10)); }
      if (e.key === "-") { e.preventDefault(); setFontSize((s) => Math.max(50, s - 10)); }
      if (e.key === "0") { e.preventDefault(); setFontSize(100); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [theme, setTheme]);

  // Debounced zoom (font size) persistence
  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentDocument) {
        invoke("update_last_zoom", { documentId, zoom: fontSize / 100 }).catch(() => {});
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [fontSize, documentId, currentDocument]);

  return (
    <div className="pdf-viewer">
      <div className="reader-toolbar">
        <button className="toolbar-text-button" onClick={onBackHome} aria-label="Back to home">
          <Icon name="home" />
          Back to home
        </button>
        <span className="toolbar-divider" />
        <span className="page-control">
          {currentDocument && (
            <span>{currentDocument.page_count ? `${currentDocument.page_count} chapters` : "EPUB"}</span>
          )}
        </span>
        <button className="icon-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} title="Switch theme (Cmd+Shift+T)" aria-label="Toggle theme">
          <Icon name={theme === "light" ? "moon" : "sun"} />
        </button>
        <span className="toolbar-center">
          <button className="toolbar-text-button" onClick={onOpenLibrary} aria-label="Open library">
            <Icon name="books" />
            Library
          </button>
          <button className="toolbar-text-button" onClick={() => onOpenAi?.()} aria-label="Open AI assistant">
            <Icon name="ask" />
            Ask
          </button>
        </span>
        <span className="toolbar-spacer" />
        <button className="icon-button" onClick={() => setFontSize((s) => Math.max(50, s - 10))} disabled={fontSize <= 50} aria-label="Zoom out"><Icon name="minus" /></button>
        <button className="zoom-reset" onClick={() => setFontSize(100)}>{fontSize}%</button>
        <button className="icon-button" onClick={() => setFontSize((s) => Math.min(200, s + 10))} disabled={fontSize >= 200} aria-label="Zoom in"><Icon name="plus" /></button>
      </div>

      {error ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <p style={{ color: "var(--danger-color)" }}>{error}</p>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="epub-scroll"
          style={{ height: "100%", overflow: "auto" }}
        />
      )}
    </div>
  );
}
