import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface Annotation {
  id: string;
  document_id: string;
  page_number: number;
  toc_node_id: string | null;
  type: string;
  selected_text: string | null;
  note_text: string | null;
  color: string | null;
  anchor_json: string | null;
  created_at: string;
  updated_at: string;
}

interface NotesState {
  annotations: Annotation[];
  isLoading: boolean;
  loadAnnotations: (documentId: string, pageNumber?: number) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
  addAnnotation: (annotation: Annotation) => void;
}

const annotationLoads = new Map<string, Promise<void>>();

function annotationLoadKey(documentId: string, pageNumber?: number): string {
  return `${documentId}:${pageNumber ?? "all"}`;
}

export const useNotesStore = create<NotesState>((set) => ({
  annotations: [],
  isLoading: false,
  loadAnnotations: async (documentId, pageNumber) => {
    const key = annotationLoadKey(documentId, pageNumber);
    const pending = annotationLoads.get(key);
    if (pending) return pending;

    set({ isLoading: true });
    const load = invoke<Annotation[]>("get_annotations", {
      input: { document_id: documentId, page_number: pageNumber ?? null },
    })
      .then((result) => {
        set({ annotations: result, isLoading: false });
      })
      .catch((e) => {
        set({ isLoading: false });
        throw e;
      })
      .finally(() => {
        annotationLoads.delete(key);
      });
    annotationLoads.set(key, load);
    return load;
  },
  deleteAnnotation: async (id) => {
    await invoke("delete_annotation", { annotationId: id });
    set((state) => ({
      annotations: state.annotations.filter((a) => a.id !== id),
    }));
  },
  addAnnotation: (annotation) => set((state) => ({
    annotations: state.annotations.some((item) => item.id === annotation.id) ? state.annotations : [annotation, ...state.annotations],
  })),
}));
