import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { convertFileSrc } from "@tauri-apps/api/core";
import "../pdfjs";
import { useDocumentStore } from "../stores/documentStore";
import { invoke } from "@tauri-apps/api/core";

interface PdfViewerProps {
  filePath: string;
  documentId: string;
}

export default function PdfViewer({ filePath, documentId }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { currentPage, zoom, setCurrentPage, setTotalPages, setZoom } =
    useDocumentStore();
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<any>(null);
  const pageHeightsRef = useRef<number[]>([]);

  // Render a single page on the canvas
  const renderPage = useCallback(
    async (pdf: PDFDocumentProxy, pageNum: number, scale: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      setError(null);

      // Cancel previous render
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }

      try {
        const page: PDFPageProxy = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const renderTask = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (err: any) {
        if (err?.name === "RenderingCancelledException") return;
        setError(`Failed to render page ${pageNum}`);
      }
    },
    [],
  );

  // Load PDF document
  useEffect(() => {
    const loadPdf = async () => {
      try {
        const url = convertFileSrc(filePath);
        const pdf = await pdfjsLib.getDocument(url).promise;
        setPdfDoc(pdf);
        pdfRef.current = pdf;
        setTotalPages(pdf.numPages);
        // Pre-compute page heights at default scale
        pageHeightsRef.current = [];
        for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          pageHeightsRef.current.push(vp.height);
        }
        invoke("update_page_count", { documentId, pageCount: pdf.numPages }).catch(() => {});
      } catch (err) {
        setError(`Failed to load PDF: ${err}`);
      }
    };
    loadPdf();
    return () => {
      renderTaskRef.current?.cancel();
      pdfRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Re-render when page or zoom changes
  useEffect(() => {
    if (pdfDoc && currentPage >= 1 && currentPage <= pdfDoc.numPages) {
      renderPage(pdfDoc, currentPage, zoom);
    }
  }, [pdfDoc, currentPage, zoom, renderPage]);

  // Debounced zoom persistence
  useEffect(() => {
    const timer = setTimeout(() => {
      invoke("update_last_zoom", { documentId, zoom }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [zoom, documentId]);

  // Navigation
  const goToPage = useCallback(
    (page: number) => {
      if (!pdfDoc) return;
      const p = Math.max(1, Math.min(pdfDoc.numPages, page));
      if (p !== currentPage) {
        setCurrentPage(p);
        invoke("update_last_page", { documentId, pageNumber: p }).catch(() => {});
      }
    },
    [pdfDoc, currentPage, documentId, setCurrentPage],
  );

  // Mouse wheel → page navigation
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.deltaY > 0) goToPage(currentPage + 1);
      else goToPage(currentPage - 1);
    },
    [currentPage, goToPage],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goToPage(currentPage - 1); }
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); goToPage(currentPage + 1); }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom(zoom + 0.25); }
      if (e.key === "-") { e.preventDefault(); setZoom(zoom - 0.25); }
      if (e.key === "0") { e.preventDefault(); setZoom(1.0); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentPage, zoom, goToPage, setZoom]);

  const scrollHeight = pdfDoc ? Math.max(canvasRef.current?.height ?? 800, 600) : 600;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          background: "var(--bg-primary)",
          borderBottom: "1px solid var(--border-color)",
          fontSize: 13,
          flexShrink: 0,
        }}
      >
        <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
          ◀ Prev
        </button>
        <span>
          Page{" "}
          <input
            type="number"
            value={currentPage}
            min={1}
            max={pdfDoc?.numPages ?? 1}
            onChange={(e) => goToPage(Number(e.target.value))}
            style={{ width: 50, textAlign: "center", padding: "2px 4px", border: "1px solid var(--border-color)", borderRadius: 3 }}
          />{" "}
          / {pdfDoc?.numPages ?? "?"}
        </span>
        <button onClick={() => goToPage(currentPage + 1)} disabled={!pdfDoc || currentPage >= pdfDoc.numPages}>
          Next ▶
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={() => setZoom(zoom - 0.25)} disabled={zoom <= 0.25}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(zoom + 0.25)} disabled={zoom >= 4.0}>+</button>
        <button onClick={() => setZoom(1.0)}>Reset</button>
      </div>

      {/* Scrollable canvas area */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          overflow: "auto",
          padding: 16,
          position: "relative",
        }}
      >
        {error ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <p style={{ color: "var(--danger-color)", marginBottom: 8 }}>{error}</p>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {error.includes("load") ? "The file may be corrupt or encrypted." : "Try zooming out or navigating to a different page."}
            </p>
          </div>
        ) : (
          <div style={{ minHeight: scrollHeight, display: "flex", alignItems: "flex-start" }}>
            <canvas
              ref={canvasRef}
              style={{
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                background: "#fff",
              }}
            />
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "8px 0", textAlign: "center" }}>
          Use mouse wheel, ← → arrows, or Page Up/Down to navigate pages
        </div>
      </div>
    </div>
  );
}
