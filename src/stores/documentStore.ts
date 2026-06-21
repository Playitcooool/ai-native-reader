import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface Document {
  id: string;
  title: string | null;
  original_filename: string;
  file_path: string;
  file_sha256: string | null;
  page_count: number | null;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  last_page: number | null;
  last_zoom: number | null;
  parse_status: string | null;
  has_native_toc: boolean | null;
}

interface DocumentState {
  documents: Document[];
  currentDocument: Document | null;
  currentPage: number;
  totalPages: number;
  zoom: number;
  setDocuments: (docs: Document[]) => void;
  setCurrentDocument: (doc: Document | null) => void;
  setCurrentPage: (page: number) => void;
  setTotalPages: (count: number) => void;
  setZoom: (zoom: number) => void;
  loadDocuments: () => Promise<void>;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  documents: [],
  currentDocument: null,
  currentPage: 1,
  totalPages: 0,
  zoom: 1.0,
  setDocuments: (documents) => set({ documents }),
  setCurrentDocument: (doc) =>
    set({
      currentDocument: doc,
      currentPage: doc?.last_page ?? 1,
      zoom: doc?.last_zoom ?? 1.0,
    }),
  setCurrentPage: (page) => set({ currentPage: page }),
  setTotalPages: (count) => set({ totalPages: count }),
  setZoom: (zoom) =>
    set({ zoom: Math.max(0.25, Math.min(4.0, zoom)) }),
  loadDocuments: async () => {
    try {
      const docs = await invoke<Document[]>("get_documents");
      set({ documents: docs });
    } catch (err) {
      console.error("Failed to load documents:", err);
    }
  },
}));
