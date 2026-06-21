import { useEffect, useState } from "react";
import SettingsPanel from "./SettingsPanel";
import { useDocumentStore, type Document } from "../stores/documentStore";
import { invoke } from "@tauri-apps/api/core";

type Tab = "toc" | "notes" | "recent" | "settings";

export default function LeftSidebar() {
  const [activeTab, setActiveTab] = useState<Tab>("recent");
  const { documents, currentDocument, loadDocuments, setCurrentDocument } =
    useDocumentStore();

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleOpenDocument = async (doc: Document) => {
    setCurrentDocument(doc);
    // Verify file still exists
    try {
      await invoke("get_document", { documentId: doc.id });
    } catch {
      console.warn("Document file may be missing:", doc.file_path);
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
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            {currentDocument
              ? "TOC will appear here after extraction (Phase 2)."
              : "Open a PDF to see its table of contents."}
          </p>
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
