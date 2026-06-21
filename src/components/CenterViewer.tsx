import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useDocumentStore, type Document } from "../stores/documentStore";
import PdfViewer from "./PdfViewer";

export default function CenterViewer() {
  const { currentDocument, setCurrentDocument, setDocuments } =
    useDocumentStore();

  const handleOpenPdf = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!selected) return;
      const doc = await invoke<Document>("import_pdf", {
        filePath: selected,
      });
      setCurrentDocument(doc);
      // Refresh document list
      const docs = await invoke<Document[]>("get_documents");
      setDocuments(docs);
    } catch (err) {
      console.error("Failed to open PDF:", err);
    }
  };

  if (currentDocument) {
    return (
      <PdfViewer
        filePath={currentDocument.file_path}
        documentId={currentDocument.id}
      />
    );
  }

  return (
    <div className="center-viewer">
      <div className="empty-state">
        <h2>AI-Native PDF Reader</h2>
        <p>Open a PDF to start reading with AI.</p>
        <button
          onClick={handleOpenPdf}
          style={{
            marginTop: 16,
            padding: "10px 24px",
            background: "var(--accent-color)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          Open PDF
        </button>
      </div>
    </div>
  );
}
