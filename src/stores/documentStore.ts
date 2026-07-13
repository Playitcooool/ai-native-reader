import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { TocNode } from "../features/toc/TocSidebar";
import { percentToChapter } from "../features/epub/epubProgress";
import { isTauriRuntime } from "../tauriRuntime";

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
  document_type: 'pdf' | 'epub';
  author: string | null;
}

export interface Collection {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentCollection {
  document_id: string;
  collection_id: string;
}

export function documentDisplayTitle(doc: Pick<Document, "title" | "original_filename" | "file_path">): string {
  return doc.title?.trim() || doc.original_filename?.trim() || doc.file_path.split("/").pop() || "Untitled";
}

export function documentDisplayAuthor(doc: Pick<Document, "author">): string {
  return doc.author?.trim() ?? "";
}

export function collectionIdsForDocument(memberships: DocumentCollection[], documentId: string): Set<string> {
  const ids = new Set<string>();
  for (const membership of memberships) {
    if (membership.document_id === documentId) ids.add(membership.collection_id);
  }
  return ids;
}

export const RECENT_COLLECTION_ID = "__recent__";

export function filterDocumentsByCollection<T extends { id: string; last_opened_at?: string | null }>(
  documents: T[],
  selectedCollectionId: string | null,
  memberships: DocumentCollection[],
): T[] {
  if (selectedCollectionId === null) return documents;
  if (selectedCollectionId === RECENT_COLLECTION_ID) return documents.filter((doc) => doc.last_opened_at);
  const documentIds = new Set<string>();
  for (const membership of memberships) {
    if (membership.collection_id === selectedCollectionId) documentIds.add(membership.document_id);
  }
  return documents.filter((doc) => documentIds.has(doc.id));
}

const METADATA_REFRESH_LIMIT = 12;

export function documentsNeedingMetadataRefresh<T extends Pick<Document, "document_type" | "author" | "title" | "original_filename">>(
  documents: T[],
  limit = METADATA_REFRESH_LIMIT,
): T[] {
  const result: T[] = [];
  for (const doc of documents) {
    if (doc.document_type === 'pdf' && (!doc.author || doc.title === doc.original_filename)) {
      result.push(doc);
      if (result.length >= limit) break;
    }
  }
  return result;
}

interface DocumentState {
  documents: Document[];
  collections: Collection[];
  documentCollections: DocumentCollection[];
  selectedCollectionId: string | null;
  currentDocument: Document | null;
  currentPage: number;
  totalPages: number;
  zoom: number;
  tocNodes: TocNode[];
  activeTocNodeId: string | null;
  isLoading: boolean;
  libraryFolder: string | null;
  dailyStats: { todaySeconds: number; weekSeconds: number } | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  _onVisibility: (() => void) | null;
  setDocuments: (docs: Document[]) => void;
  setCollections: (collections: Collection[]) => void;
  setDocumentCollections: (memberships: DocumentCollection[]) => void;
  setSelectedCollectionId: (id: string | null) => void;
  setCurrentDocument: (doc: Document | null) => void;
  setCurrentPage: (page: number) => void;
  setTotalPages: (count: number) => void;
  setZoom: (zoom: number) => void;
  setTocNodes: (nodes: TocNode[]) => void;
  setActiveTocNodeId: (id: string | null) => void;
  loadDocuments: () => Promise<void>;
  loadCollections: () => Promise<void>;
  createCollection: (name: string) => Promise<Collection>;
  addDocumentToCollection: (documentId: string, collectionId: string) => Promise<void>;
  removeDocumentFromCollection: (documentId: string, collectionId: string) => Promise<void>;
  loadToc: (documentId: string) => Promise<void>;
  handleOpenDocument: () => Promise<void>;
  handleOpenFolder: () => Promise<void>;
  setLibraryFolder: (folder: string | null) => void;
  loadLibraryFolder: () => Promise<void>;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
  loadReadingStats: () => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  collections: [],
  documentCollections: [],
  selectedCollectionId: null,
  currentDocument: null,
  currentPage: 1,
  totalPages: 0,
  zoom: 1.75,
  tocNodes: [],
  activeTocNodeId: null,
  isLoading: false,
  libraryFolder: null,
  dailyStats: null,
  heartbeatInterval: null,
  _onVisibility: null,
  setDocuments: (documents) => set({ documents }),
  setCollections: (collections) => set({ collections }),
  setDocumentCollections: (documentCollections) => set({ documentCollections }),
  setSelectedCollectionId: (selectedCollectionId) => set({ selectedCollectionId }),
  setCurrentDocument: (doc) => {
    const selected = doc ? { ...doc, last_opened_at: new Date().toISOString() } : null;
    if (doc) {
      get().startHeartbeat();
      invoke("mark_document_opened", { documentId: doc.id }).catch(() => {});
      // EPUBs from bulk import may not have content extracted yet
      if (doc.document_type === 'epub' && doc.parse_status !== 'ready') {
        invoke("extract_epub_content", { documentId: doc.id })
          .then(() => invoke<Document | null>("get_document", { documentId: doc.id }))
          .then((updated) => { if (updated) set((s) => ({
            currentDocument: updated,
            documents: s.documents.map((item) => item.id === updated.id ? updated : item),
          })); })
          .catch(() => {});
      }
      // Refresh metadata for PDFs that were imported without extraction
      if (doc.document_type === 'pdf' && (!doc.author || !doc.title || doc.title === doc.original_filename)) {
        invoke<Document>("refresh_document_metadata", { documentId: doc.id })
          .then((updated) => set({ currentDocument: updated })).catch(() => {});
      }
    } else {
      get().stopHeartbeat();
    }
    set((s) => ({
      documents: selected ? [selected, ...s.documents.filter((d) => d.id !== selected.id)] : s.documents,
      currentDocument: selected,
      currentPage: selected?.document_type === 'epub'
        ? percentToChapter(selected.last_page ?? 0, selected.page_count ?? 1)
        : selected?.last_page ?? 1,
      zoom: selected?.last_zoom ?? 1.0,
    }));
  },
  setCurrentPage: (page) => set({ currentPage: page }),
  setTotalPages: (count) => set({ totalPages: count }),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(4.0, zoom)) }),
  setTocNodes: (nodes) => set({ tocNodes: nodes }),
  setActiveTocNodeId: (id) => set({ activeTocNodeId: id }),
  setLibraryFolder: (folder) => set({ libraryFolder: folder }),

  startHeartbeat: () => {
    const { heartbeatInterval } = get();
    if (heartbeatInterval) return;

    const tick = () => invoke("record_reading_heartbeat", { seconds: 15 });
    const interval = setInterval(tick, 15_000);

    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(interval);
        set({ heartbeatInterval: null });
      } else {
        get().startHeartbeat();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    set({ heartbeatInterval: interval, _onVisibility: onVisibility });
  },

  stopHeartbeat: () => {
    const { heartbeatInterval, _onVisibility } = get();
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (_onVisibility) document.removeEventListener("visibilitychange", _onVisibility);
    set({ heartbeatInterval: null, _onVisibility: null });
  },

  loadReadingStats: async () => {
    if (!isTauriRuntime()) return;
    try {
      const stats = await invoke<{ today_seconds: number; week_seconds: number }>("get_reading_stats");
      set({ dailyStats: { todaySeconds: stats.today_seconds, weekSeconds: stats.week_seconds } });
    } catch { /* ignore */ }
  },
  deleteDocument: async (id) => {
    await invoke("delete_document", { documentId: id });
    const state = get();
    if (state.currentDocument?.id === id) {
      state.stopHeartbeat();
    }
    set((s) => ({
      documents: s.documents.filter((d) => d.id !== id),
      documentCollections: s.documentCollections.filter((m) => m.document_id !== id),
      currentDocument: s.currentDocument?.id === id ? null : s.currentDocument,
    }));
  },
  loadLibraryFolder: async () => {
    if (!isTauriRuntime()) return;
    try {
      const folder = await invoke<string | null>("get_library_folder");
      set({ libraryFolder: folder });
    } catch { /* ignore */ }
  },
  loadDocuments: async () => {
    if (!isTauriRuntime()) return;
    set({ isLoading: true });
    try {
      const [docs, collections, documentCollections] = await Promise.all([
        invoke<Document[]>("get_documents"),
        invoke<Collection[]>("get_collections"),
        invoke<DocumentCollection[]>("get_collection_memberships"),
      ]);
      set({ documents: docs, collections, documentCollections, isLoading: false });
      // Background-refresh metadata for documents that need it
      for (const doc of documentsNeedingMetadataRefresh(docs)) {
        invoke<Document>("refresh_document_metadata", { documentId: doc.id }).then((updated) => {
          set((s) => ({ documents: s.documents.map((d) => d.id === updated.id ? updated : d) }));
        }).catch(() => {});
      }
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },
  loadCollections: async () => {
    if (!isTauriRuntime()) return;
    const [collections, documentCollections] = await Promise.all([
      invoke<Collection[]>("get_collections"),
      invoke<DocumentCollection[]>("get_collection_memberships"),
    ]);
    set({ collections, documentCollections });
  },
  createCollection: async (name) => {
    const collection = await invoke<Collection>("create_collection", { name });
    set((s) => ({ collections: [...s.collections, collection].sort((a, b) => a.name.localeCompare(b.name)) }));
    return collection;
  },
  addDocumentToCollection: async (documentId, collectionId) => {
    await invoke("add_document_to_collection", { documentId, collectionId });
    set((s) => s.documentCollections.some((m) => m.document_id === documentId && m.collection_id === collectionId)
      ? {}
      : { documentCollections: [...s.documentCollections, { document_id: documentId, collection_id: collectionId }] });
  },
  removeDocumentFromCollection: async (documentId, collectionId) => {
    await invoke("remove_document_from_collection", { documentId, collectionId });
    set((s) => ({
      documentCollections: s.documentCollections.filter((m) => m.document_id !== documentId || m.collection_id !== collectionId),
    }));
  },
  loadToc: async (documentId) => {
    const nodes = await invoke<TocNode[]>("get_toc_tree", { documentId });
    set({ tocNodes: nodes });
  },
  handleOpenDocument: async () => {
    if (!isTauriRuntime()) return;
    const selected = await open({
      multiple: false,
      filters: [{ name: "Documents", extensions: ["pdf", "epub"] }],
    });
    if (!selected) return;
    const doc = await invoke<Document>("import_document", { filePath: selected });
    get().setCurrentDocument(doc);
    const docs = await invoke<Document[]>("get_documents");
    get().setDocuments(docs);
  },
  handleOpenFolder: async () => {
    if (!isTauriRuntime()) return;
    const selected = await open({ directory: true, multiple: false, recursive: true });
    if (!selected) return;
    await invoke("set_library_folder", { path: selected });
    get().setLibraryFolder(selected);
    const docs = await invoke<Document[]>("get_documents");
    get().setDocuments(docs);
  },
}));
