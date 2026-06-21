import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import SettingsPanel from "./SettingsPanel";
import { useDocumentStore } from "../stores/documentStore";
import TocSidebar from "../features/toc/TocSidebar";

type Tab = "toc" | "notes" | "recent" | "settings";

export default function LeftSidebar() {
  const [activeTab, setActiveTab] = useState<Tab>("recent");
  const {
    documents,
    currentDocument,
    tocNodes,
    activeTocNodeId,
    loadDocuments,
    setCurrentDocument,
    setCurrentPage,
  } = useDocumentStore();

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleOpenDocument = (doc: typeof documents[0]) => {
    setCurrentDocument(doc);
  };

  const handleTocNavigate = (page: number) => {
    const doc = currentDocument;
    if (doc) {
      setCurrentPage(page);
      invoke("update_last_page", {
        documentId: doc.id,
        pageNumber: page,
      }).catch(() => {});
    }
  };

  return (
    <div className="sidebar-left">
      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === "recent" ? "active" : ""}`}
          onClick={() => setActiveTab("recent")}
        >
          Recent
        </button>
        <button
          className={`tab-btn ${activeTab === "toc" ? "active" : ""}`}
          onClick={() => setActiveTab("toc")}
        >
          TOC
        </button>
        <button
          className={`tab-btn ${activeTab === "notes" ? "active" : ""}`}
          onClick={() => setActiveTab("notes")}
        >
          Notes
        </button>
        <button
          className={`tab-btn ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => setActiveTab("settings")}
        >
          Settings
        </button>
      </div>
      <div className="tab-content">
        {activeTab === "recent" && (
          <div>
            {documents.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                No PDFs opened yet. Click "Open PDF" to get started.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {documents.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => handleOpenDocument(doc)}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "8px 10px",
                      textAlign: "left",
                      background:
                        currentDocument?.id === doc.id
                          ? "var(--accent-color)"
                          : "var(--bg-secondary)",
                      color:
                        currentDocument?.id === doc.id
                          ? "#fff"
                          : "var(--text-primary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: 4,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{doc.title ?? doc.original_filename}</div>
                    {doc.last_page && (
                      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                        Page {doc.last_page}{doc.page_count ? ` / ${doc.page_count}` : ""}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {activeTab === "toc" && (
          currentDocument ? (
            <TocSidebar
              nodes={tocNodes}
              activeNodeId={activeTocNodeId}
              onNavigate={handleTocNavigate}
            />
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
              Open a PDF to see its table of contents.
            </p>
          )
        )}
        {activeTab === "notes" && (
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            {currentDocument
              ? "No notes yet. Save AI answers to see them here."
              : "Open a PDF to view notes."}
          </p>
        )}
        {activeTab === "settings" && <SettingsPanel />}
      </div>
    </div>
  );
}
