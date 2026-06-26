import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "../pdfjs";
import { documentDisplayTitle, type Document, useDocumentStore } from "../stores/documentStore";
import PdfViewer from "./PdfViewer";
const EpubViewer = lazy(() => import("../features/epub/EpubViewer"));
import { useToast } from "./Toast";
import type { TocNode } from "../features/toc/TocSidebar";
import type { AiMessage } from "../stores/aiStore";
import type { InitialIndexAction } from "./AiSidebar";

interface AiSession {
  id: string;
  session_summary: string | null;
}

interface PageTextCoverage {
  page_number: number;
  text_status: string;
  char_count: number;
}

interface IndexContext {
  node: TocNode | null;
  session: AiSession | null;
  messages: AiMessage[];
  coverage: PageTextCoverage[];
}

function formatTime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

const coverCache = new Map<string, string>();
// Concurrency pool — max 4 parallel cover renders
const MAX_RENDERS = 4;
let activeRenders = 0;
const renderQueue: (() => void)[] = [];
function scheduleCoverRender(fn: () => Promise<void>) {
  const run = () => {
    activeRenders++;
    fn().finally(() => {
      activeRenders--;
      const next = renderQueue.shift();
      if (next) next();
    });
  };
  if (activeRenders < MAX_RENDERS) {
    run();
  } else {
    renderQueue.push(run);
  }
}

export default function CenterViewer({
  onBackHome,
  onOpenLibrary,
  onOpenAi,
  onOpenIndexGuide,
}: {
  onBackHome?: () => void;
  onOpenLibrary?: () => void;
  onOpenAi?: (draft?: string) => void;
  onOpenIndexGuide?: (action: InitialIndexAction) => void;
}) {
  const { documents, currentDocument, handleOpenDocument, handleOpenFolder, setCurrentDocument, setCurrentPage, dailyStats, loadReadingStats } = useDocumentStore();
  const { addToast } = useToast();
  const pdfs = useMemo(() => documents.filter((doc) => doc.document_type === "pdf"), [documents]);
  const latestPdf = useMemo(() => latestDocument(pdfs), [pdfs]);
  const [selectedIndexId, setSelectedIndexId] = useState<string | null>(null);
  const selectedIndexDoc = useMemo(
    () => pdfs.find((doc) => doc.id === (selectedIndexId ?? latestPdf?.id)) ?? latestPdf ?? null,
    [pdfs, selectedIndexId, latestPdf],
  );
  const [indexContext, setIndexContext] = useState<IndexContext | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);

  useEffect(() => {
    loadReadingStats();
  }, [loadReadingStats]);

  useEffect(() => {
    if (selectedIndexId || !latestPdf) return;
    setSelectedIndexId(latestPdf.id);
  }, [latestPdf, selectedIndexId]);

  useEffect(() => {
    if (!selectedIndexDoc) {
      setIndexContext(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setIndexLoading(true);
      try {
        const page = selectedIndexDoc.last_page ?? 1;
        const node = await invoke<TocNode | null>("get_toc_node_for_page", {
          documentId: selectedIndexDoc.id,
          pageNumber: page,
        }).catch(() => null);
        const start = node?.start_page ?? page;
        const end = node?.end_page ?? start;
        const [session, coverage] = await Promise.all([
          invoke<AiSession>("get_or_create_ai_session", {
            input: {
              document_id: selectedIndexDoc.id,
              scope_type: "toc_index_qa",
              scope_json: "{\"scopeType\":\"toc_index_qa\"}",
            },
          }).catch(() => null),
          invoke<PageTextCoverage[]>("get_pages_text_coverage", {
            documentId: selectedIndexDoc.id,
            startPage: start,
            endPage: end,
          }).catch(() => []),
        ]);
        const messages = session
          ? await invoke<AiMessage[]>("get_session_messages", { sessionId: session.id, limit: 6 }).catch(() => [])
          : [];
        if (!cancelled) setIndexContext({ node, session, messages, coverage });
      } finally {
        if (!cancelled) setIndexLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [selectedIndexDoc]);

  const openIndexDocument = (doc: Document, action?: Omit<InitialIndexAction, "pageNumber">) => {
    const pageNumber = doc.last_page ?? 1;
    setCurrentPage(pageNumber);
    setCurrentDocument(doc);
    if (action) onOpenIndexGuide?.({ ...action, pageNumber });
  };

  if (currentDocument) {
    return (
      <>
        <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
          {documentDisplayTitle(currentDocument)}
        </h1>
        {currentDocument.document_type === 'epub' ? (
          <Suspense fallback={<div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>Loading EPUB…</div>}>
            <EpubViewer
              key={currentDocument.id}
              documentId={currentDocument.id}
              onBackHome={onBackHome}
              onOpenLibrary={onOpenLibrary}
              onOpenAi={onOpenAi}
            />
          </Suspense>
        ) : (
          <PdfViewer
            key={currentDocument.id}
            documentId={currentDocument.id}
            onBackHome={onBackHome}
            onOpenLibrary={onOpenLibrary}
            onOpenAi={onOpenAi}
          />
        )}
      </>
    );
  }

  return (
    <div className="library-view">
      <div className="library-header">
        <div>
          <p className="library-eyebrow">RustyBooks</p>
          <h1>Library</h1>
          <p>{documents.length ? "Pick up where you left off." : "Add a document to begin."}</p>
        </div>
        <div className="library-actions">
          <button className="primary-action" onClick={() => handleOpenDocument().catch(() => addToast({ type: "error", message: "Failed to open document." }))}>
            Open Document
          </button>
          <button onClick={() => handleOpenFolder().catch(() => addToast({ type: "error", message: "Failed to open folder." }))}>
            Folder
          </button>
        </div>
      </div>

      {dailyStats && (dailyStats.todaySeconds > 0 || dailyStats.weekSeconds > 0) && (
        <div className="reading-stats">
          <span>📖 Today: {formatTime(dailyStats.todaySeconds)}</span>
          <span className="reading-stats-sep">•</span>
          <span>Week: {formatTime(dailyStats.weekSeconds)}</span>
        </div>
      )}

      <div className="index-reading">
        <div className="index-reading-main">
          <div className="index-reading-head">
            <div>
              <p className="library-eyebrow">Index Reading</p>
              <h2>Continue Reading</h2>
            </div>
            {pdfs.length > 1 && (
              <select
                value={selectedIndexDoc?.id ?? ""}
                onChange={(e) => setSelectedIndexId(e.target.value)}
                aria-label="Pick PDF for Index Reading"
              >
                {pdfs.map((doc) => (
                  <option key={doc.id} value={doc.id}>{documentDisplayTitle(doc)}</option>
                ))}
              </select>
            )}
          </div>
          {!selectedIndexDoc ? (
            <p className="index-muted">Add a PDF to use Index Reading.</p>
          ) : (
            <IndexReadingCard
              doc={selectedIndexDoc}
              context={indexContext}
              loading={indexLoading}
              onContinue={() => openIndexDocument(selectedIndexDoc)}
              onSummarize={() => openIndexDocument(selectedIndexDoc, {
                node: indexContext?.node ?? null,
                summarize: true,
                sessionId: indexContext?.session?.id,
              })}
              onAsk={() => openIndexDocument(selectedIndexDoc, {
                node: indexContext?.node ?? null,
                sessionId: indexContext?.session?.id,
              })}
            />
          )}
        </div>
        {latestPdf && selectedIndexDoc?.id !== latestPdf.id && (
          <button className="continue-card" onClick={() => setSelectedIndexId(latestPdf.id)}>
            <span>Most recent</span>
            <strong>{documentDisplayTitle(latestPdf)}</strong>
            <small>Page {latestPdf.last_page ?? 1}</small>
          </button>
        )}
      </div>

      <div className="book-grid">
        {documents.length === 0 ? (
          <div className="empty-state">
            <h2>No books yet</h2>
            <p>Use Open PDF or Import Folder to add your first document.</p>
          </div>
        ) : (
          documents.map((doc) => (
            <button key={doc.id} className="book-card" onClick={() => setCurrentDocument(doc)}>
              <BookCover doc={doc} />
              <span className="book-title">{documentDisplayTitle(doc)}</span>
              {doc.author && <span className="book-meta" style={{ color: "var(--text-muted)" }}>{doc.author}</span>}
              <span className="book-meta">
                {doc.document_type === 'epub'
                ? (doc.last_page ? `${doc.last_page}%` : doc.page_count ? `${doc.page_count} chapters` : "Ready")
                : (doc.last_page ? `Page ${doc.last_page}` : doc.page_count ? `${doc.page_count} pages` : "Ready")}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function BookCover({ doc }: { doc: Document }) {
  const [src, setSrc] = useState(() => coverCache.get(doc.id));

  useEffect(() => {
    let cancelled = false;
    const cached = coverCache.get(doc.id);
    if (cached) {
      setSrc(cached);
      return;
    }
    scheduleCoverRender(async () => {
      if (cancelled) return;
      const cover = await renderCover(doc.id, doc.document_type);
      if (cover && !cancelled) {
        coverCache.set(doc.id, cover);
        setSrc(cover);
      }
    });
    return () => { cancelled = true; };
  }, [doc.id]);

  return (
    <span className="book-cover" aria-hidden="true">
      {src ? <img src={src} alt="" /> : <span>{doc.document_type === 'epub' ? 'EPUB' : 'PDF'}</span>}
    </span>
  );
}

async function renderCover(documentId: string, docType: string): Promise<string | null> {
  // Check disk cache first
  try {
    const cached = await invoke<number[] | null>("get_cached_cover", { documentId });
    if (cached && cached.length > 0) {
      return URL.createObjectURL(new Blob([new Uint8Array(cached)]));
    }
  } catch { /* no cached cover */ }

  if (docType === 'epub') {
    try {
      const docs = useDocumentStore.getState().documents;
      const doc = docs.find(d => d.id === documentId);
      if (!doc) return null;
      const cover = await invoke<number[] | null>("get_document_cover", {
        documentId, filePath: doc.file_path, documentType: docType,
      });
      if (!cover) return null;
      return URL.createObjectURL(new Blob([new Uint8Array(cover)]));
    } catch { return null; }
  }

  if (docType === 'pdf') return null;
  return null;
}

function latestDocument(docs: Document[]) {
  return [...docs].sort(
    (a, b) =>
      new Date(b.last_opened_at ?? b.updated_at ?? b.created_at).getTime() -
      new Date(a.last_opened_at ?? a.updated_at ?? a.created_at).getTime(),
  )[0] ?? null;
}

function IndexReadingCard({
  doc,
  context,
  loading,
  onContinue,
  onSummarize,
  onAsk,
}: {
  doc: Document;
  context: IndexContext | null;
  loading: boolean;
  onContinue: () => void;
  onSummarize: () => void;
  onAsk: () => void;
}) {
  const ready = context?.coverage.filter((page) => page.text_status === "ready" && page.char_count > 0).length ?? 0;
  const total = context?.coverage.length ?? 0;
  const chars = context?.coverage.reduce((sum, page) => sum + page.char_count, 0) ?? 0;
  const lastAssistant = [...(context?.messages ?? [])].reverse().find((msg) => msg.role === "assistant");
  return (
    <div className="index-card">
      <div>
        <h3>{documentDisplayTitle(doc)}</h3>
        <p className="index-muted">
          Page {doc.last_page ?? 1}
          {context?.node ? ` · ${context.node.title}` : " · No TOC section"}
        </p>
      </div>
      <div className="index-facts">
        <span>{loading ? "Loading context" : total ? `${ready}/${total} pages ready` : "No saved text yet"}</span>
        <span>{chars ? `${chars.toLocaleString()} chars indexed` : "OCR will run as pages are opened"}</span>
        {context?.session?.session_summary && <span>{context.session.session_summary}</span>}
        {lastAssistant && <span>{lastAssistant.content}</span>}
      </div>
      <div className="index-actions">
        <button className="primary-action" onClick={onContinue}>Continue</button>
        <button onClick={onSummarize} disabled={!context?.node}>Summarize section</button>
        <button onClick={onAsk} disabled={!context?.node}>Ask about section</button>
      </div>
    </div>
  );
}
