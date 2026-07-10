import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { documentDisplayAuthor, documentDisplayTitle, filterDocumentsByCollection, RECENT_COLLECTION_ID, useDocumentStore } from "../stores/documentStore";
import { useNotesStore } from "../stores/notesStore";
import type { Annotation } from "../stores/notesStore";
import type { Document } from "../stores/documentStore";
import TocSidebar from "../features/toc/TocSidebar";
import { chapterToPercent } from "../features/epub/epubProgress";
import { buildLibraryTree, type LibraryTreeNode } from "../features/library/libraryTree";
import { useToast } from "./Toast";
import { CollectionAssignmentMenu, CollectionFilterChips } from "./CollectionControls";
import { useSettingsStore } from "../stores/settingsStore";

export type SidebarTab = "contents" | "library" | "notes";
type SidebarVariant = "library" | "reader";
const NOTE_LIKE_ANNOTATION_TYPES = new Set(["note", "ai_note"]);

function FileTreeView({ nodes, currentId, onSelect, onContextMenu }: {
  nodes: LibraryTreeNode[];
  currentId: string | null;
  onSelect: (doc: Document) => void;
  onContextMenu?: (e: React.MouseEvent, doc: Document) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {nodes.map((node, i) => (
        <TreeNodeItem key={node.name + i} node={node} depth={0} currentId={currentId} onSelect={onSelect} onContextMenu={onContextMenu} />
      ))}
    </div>
  );
}

function TreeNodeItem({ node, depth, currentId, onSelect, onContextMenu }: {
  node: LibraryTreeNode;
  depth: number;
  currentId: string | null;
  onSelect: (doc: Document) => void;
  onContextMenu?: (e: React.MouseEvent, doc: Document) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (!node.isDir) {
    const isActive = node.document?.id === currentId;
    const docTitle = node.document ? documentDisplayTitle(node.document) : "";
    const author = node.document ? documentDisplayAuthor(node.document) : "";
    const tooltip = [docTitle, author].filter(Boolean).join(" · ");
    return (
      <button
        onClick={() => node.document && onSelect(node.document)}
        onContextMenu={(e) => node.document && onContextMenu?.(e, node.document)}
        className={`tree-leaf ${isActive ? "active" : ""}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        title={tooltip}
      >
        <span className="tree-file-name">{docTitle}</span>
        {author && <span className="tree-file-meta">{author}</span>}
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="tree-folder"
        style={{ paddingLeft: 10 + depth * 16 }}
        title={node.name}
      >
        <span className={`tree-folder-icon ${expanded ? "open" : ""}`}>▶</span>
        <span className="tree-folder-name">{node.name}</span>
      </button>
      {expanded && node.children.map((child, i) => (
        <TreeNodeItem key={child.name + i} node={child} depth={depth + 1} currentId={currentId} onSelect={onSelect} onContextMenu={onContextMenu} />
      ))}
    </div>
  );
}

// Format annotations as Markdown for export
function annotationsToMarkdown(annotations: Annotation[], docTitle: string | null): string {
  let md = `# Notes${docTitle ? ` — ${docTitle}` : ""}\n\n`;
  const byPage = new Map<number, typeof annotations>();
  for (const a of annotations.filter((ann) => NOTE_LIKE_ANNOTATION_TYPES.has(ann.type))) {
    const list = byPage.get(a.page_number) ?? [];
    list.push(a);
    byPage.set(a.page_number, list);
  }
  const sortedPages = Array.from(byPage.keys()).sort((a, b) => a - b);
  for (const page of sortedPages) {
    md += `## Page ${page}\n\n`;
    for (const a of byPage.get(page)!) {
      if (a.selected_text) {
        md += `> ${a.selected_text}\n\n`;
      }
      if (a.note_text) {
        md += `${a.note_text}\n\n`;
      }
    }
  }
  return md;
}

const TAB_STORAGE_KEY = "reader-left-sidebar-tab";

function normalizeTab(value: string | null | undefined, tabs: SidebarTab[], fallback: SidebarTab): SidebarTab {
  const tab = value === "recent" ? "library" : value === "toc" ? "contents" : value;
  return tabs.includes(tab as SidebarTab) ? tab as SidebarTab : fallback;
}

export default function LeftSidebar({
  variant = "library",
  initialTab,
}: {
  variant?: SidebarVariant;
  initialTab?: SidebarTab;
}) {
  const tabs: { id: SidebarTab; label: string }[] = variant === "reader"
    ? [
      { id: "contents", label: "Contents" },
      { id: "library", label: "Library" },
      { id: "notes", label: "Notes" },
    ]
    : [
      { id: "library", label: "Library" },
      { id: "notes", label: "Notes" },
    ];
  const fallbackTab = variant === "reader" ? "contents" : "library";
  const allowedTabs = tabs.map((tab) => tab.id);
  const rememberSidebarTab = useSettingsStore((s) => s.rememberSidebarTab);
  const [activeTab, setActiveTab] = useState<SidebarTab>(() =>
    normalizeTab(initialTab ?? (rememberSidebarTab ? localStorage.getItem(TAB_STORAGE_KEY) : null), allowedTabs, fallbackTab)
  );
  useEffect(() => {
    if (rememberSidebarTab) localStorage.setItem(TAB_STORAGE_KEY, activeTab);
  }, [activeTab, rememberSidebarTab]);
  useEffect(() => {
    setActiveTab(normalizeTab(initialTab ?? (rememberSidebarTab ? activeTab : null), allowedTabs, fallbackTab));
  }, [initialTab, rememberSidebarTab, variant]);
  const {
    documents,
    collections,
    documentCollections,
    selectedCollectionId,
    currentDocument,
    totalPages,
    tocNodes,
    activeTocNodeId,
    libraryFolder,
    isLoading: docsLoading,
    loadDocuments,
    setCurrentDocument,
    setLibraryFolder,
    setCurrentPage,
  } = useDocumentStore();
  const { annotations, isLoading: notesLoading, loadAnnotations, deleteAnnotation } = useNotesStore();
  const { addToast } = useToast();
  const notes = useMemo(() => annotations.filter((ann) => NOTE_LIKE_ANNOTATION_TYPES.has(ann.type)), [annotations]);
  const visibleDocuments = useMemo(
    () => filterDocumentsByCollection(documents, selectedCollectionId, documentCollections),
    [documents, selectedCollectionId, documentCollections],
  );
  const collectionName = useMemo(() => {
    if (selectedCollectionId === RECENT_COLLECTION_ID) return "Recent";
    if (selectedCollectionId === null) return "All books";
    return collections.find((collection) => collection.id === selectedCollectionId)?.name ?? "Collection";
  }, [collections, selectedCollectionId]);
  const fileTree = useMemo(
    () => buildLibraryTree(visibleDocuments, collectionName),
    [collectionName, visibleDocuments],
  );

  useEffect(() => {
    if (currentDocument) {
      loadAnnotations(currentDocument.id).catch(() =>
        addToast({ type: "error", message: "Failed to load annotations." })
      );
    }
  }, [currentDocument, loadAnnotations, addToast]);

  useEffect(() => {
    if (!currentDocument) return;
    const refresh = () => {
      loadAnnotations(currentDocument.id).catch(() =>
        addToast({ type: "error", message: "Failed to load annotations." })
      );
    };
    window.addEventListener("annotations-changed", refresh);
    return () => window.removeEventListener("annotations-changed", refresh);
  }, [currentDocument, loadAnnotations, addToast]);

  const handleOpenDocument = (doc: typeof documents[0]) => {
    setCurrentDocument(doc);
  };

  const handleTocNavigate = (page: number) => {
    const doc = currentDocument;
    if (doc) {
      setCurrentPage(page);
      const pageNumber = doc.document_type === "epub" ? chapterToPercent(page, doc.page_count ?? totalPages ?? 1) : page;
      invoke("update_last_page", { documentId: doc.id, pageNumber }).catch(() => {});
    }
  };

  const [isExporting, setIsExporting] = useState(false);

  // ── Context menu ──────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; doc: Document } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && ctxRef.current?.contains(e.target as Node)) return;
      setCtxMenu(null);
    };
    const onScroll = () => setCtxMenu(null);
    // Delay listener so the current click doesn't close immediately
    const id = setTimeout(() => document.addEventListener("click", close), 0);
    document.addEventListener("keydown", close);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [ctxMenu]);

  const handleContextMenu = (e: React.MouseEvent, doc: Document) => {
    e.preventDefault();
    const menuW = 220, menuH = 300;
    const x = Math.min(e.clientX, window.innerWidth - menuW);
    const y = Math.min(e.clientY, window.innerHeight - menuH);
    setCtxMenu({ x, y: Math.max(10, y), doc });
  };

  const handleDelete = async (doc: Document) => {
    if (!window.confirm(`Remove "${documentDisplayTitle(doc)}" from the library? Your notes and AI history stay in the local database.`)) { setCtxMenu(null); return; }
    setCtxMenu(null);
    try {
      await useDocumentStore.getState().deleteDocument(doc.id);
      addToast({ type: "info", message: `Removed "${documentDisplayTitle(doc)}" from the library.` });
    } catch {
      addToast({ type: "error", message: "Failed to remove document." });
    }
  };

  const handleExportNotes = async () => {
    if (notes.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const md = annotationsToMarkdown(notes, currentDocument ? documentDisplayTitle(currentDocument) : null);
      const filePath = await save({
        defaultPath: `${currentDocument ? documentDisplayTitle(currentDocument) : "notes"}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, md);
      }
    } catch (err) {
      addToast({ type: "error", message: "Failed to export notes." });
    } finally {
      setIsExporting(false);
    }
  };

  const handleTabKey = (e: React.KeyboardEvent, currentIdx: number) => {
    let nextIdx = currentIdx;
    if (e.key === "ArrowRight") nextIdx = (currentIdx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") nextIdx = (currentIdx + tabs.length - 1) % tabs.length;
    else return;
    e.preventDefault();
    setActiveTab(tabs[nextIdx].id);
  };

  return (
    <div className="sidebar-body">
      <div className="tabs" role="tablist" aria-label="Sidebar tabs">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={activeTab === t.id}
            aria-controls={`tabpanel-${t.id}`}
            onClick={() => setActiveTab(t.id)}
            onKeyDown={(e) => handleTabKey(e, i)}
            className={`tab-btn ${activeTab === t.id ? "active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {tabs.map((t) =>
          activeTab === t.id ? (
            <div key={t.id} role="tabpanel" id={`tabpanel-${t.id}`} aria-labelledby={`tab-${t.id}`}>
              {t.id === "library" && (
                <div>
                  {libraryFolder && (
                    <div className="recent-folder-bar">
                      <span className="folder-name">
                        {libraryFolder.split("/").pop() ?? libraryFolder}
                      </span>
                      <button onClick={async () => {
                        try {
                          await invoke("clear_library_folder");
                          setLibraryFolder(null);
                          await loadDocuments();
                        } catch {}
                      }} title="Disconnect folder" aria-label="Disconnect library folder">✕</button>
                    </div>
                  )}
                  <CollectionFilterChips documents={documents} />
                  {docsLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
                <SkeletonBlock lines={[70, 40]} />
                <SkeletonBlock lines={[60, 35]} />
                <SkeletonBlock lines={[80, 45]} />
              </div>
            ) : documents.length === 0 ? (
              <>
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  No documents opened yet.
                </p>
                <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4 }}>
                  Press <kbd style={{ padding: "1px 4px", background: "var(--bg-tertiary)", borderRadius: 2, fontFamily: "inherit", border: "1px solid var(--border-color)" }}>Cmd+O</kbd> to open a document.
                </p>
              </>
            ) : visibleDocuments.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                No books in this collection.
              </p>
            ) : (
              <FileTreeView
                nodes={fileTree}
                currentId={currentDocument?.id ?? null}
                onSelect={handleOpenDocument}
                onContextMenu={handleContextMenu}
              />
            )}
          </div>
            )}
            {t.id === "contents" && (
              currentDocument ? (
                <TocSidebar nodes={tocNodes} activeNodeId={activeTocNodeId} onNavigate={handleTocNavigate} />
              ) : (
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Open a document to see its table of contents.</p>
              )
            )}
            {t.id === "notes" && (
              currentDocument ? (
                notesLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
                    <SkeletonBlock lines={[50, 30, 80]} />
                    <SkeletonBlock lines={[45, 25, 70]} />
                  </div>
                ) : notes.length === 0 ? (
                  <>
                    <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                      No notes yet.
                    </p>
                    <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4 }}>
                      Select text and press <kbd style={{ padding: "1px 4px", background: "var(--bg-tertiary)", borderRadius: 2, fontFamily: "inherit", border: "1px solid var(--border-color)" }}>E</kbd> to explain, or use the menu to highlight/note
                    </p>
                  </>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button onClick={handleExportNotes} disabled={isExporting}
                      style={{
                        padding: "6px 12px", background: "var(--accent-color)", color: "#fff",
                        border: "none", borderRadius: 4, fontSize: 12, fontWeight: 500,
                        cursor: "pointer", alignSelf: "flex-start", marginBottom: 4,
                      }}>
                      {isExporting ? "Exporting..." : "Export Notes"}
                    </button>
                    {notes.map((ann) => (
                      <div key={ann.id} style={{
                        padding: "8px 10px", background: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)", borderRadius: 4, fontSize: 13,
                      }}>
                        <div style={{ fontWeight: 500, marginBottom: 2 }}>
                          {ann.type === "highlight" ? "Highlight" : ann.type === "note" ? "Note" : ann.type}
                          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>
                            p.{ann.page_number}
                          </span>
                        </div>
                        {ann.selected_text && (
                          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 2, fontStyle: "italic" }}>
                            "{ann.selected_text.slice(0, 80)}{ann.selected_text.length > 80 ? "..." : ""}"
                          </div>
                        )}
                        {ann.note_text && (
                          <div style={{ fontSize: 12 }}>{ann.note_text}</div>
                        )}
                        <button
                          onClick={async () => {
                            if (window.confirm("Delete this note?")) {
                              try { await deleteAnnotation(ann.id); }
                              catch { addToast({ type: "error", message: "Failed to delete annotation." }); }
                            }
                          }}
                          style={{
                            marginTop: 4, padding: "2px 6px", background: "transparent",
                            color: "var(--danger-color)", border: "1px solid var(--danger-color)",
                            borderRadius: 3, fontSize: 11, cursor: "pointer",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Open a PDF to view notes.</p>
              )
            )}
          </div>
        ) : null
      )}
      </div>
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          role="menu"
        >
          <CollectionAssignmentMenu doc={ctxMenu.doc} onDone={() => setCtxMenu(null)} />
          <button className="ctx-menu-item" role="menuitem" onClick={() => handleDelete(ctxMenu.doc)}>
            Remove from Library
          </button>
        </div>
      )}
    </div>
  );
}

function SkeletonBar({ width }: { width: number }) {
  return (
    <div
      style={{
        height: 12, width: `${width}%`, borderRadius: 4,
        background: "var(--bg-tertiary)",
        animation: "skeleton-pulse 1.5s ease-in-out infinite",
      }}
    />
  );
}

function SkeletonBlock({ lines }: { lines: number[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {lines.map((w, i) => <SkeletonBar key={i} width={w} />)}
    </div>
  );
}
