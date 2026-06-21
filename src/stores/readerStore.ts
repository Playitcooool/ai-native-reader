import { create } from "zustand";

export interface SelectionAnchor {
  type: "text_quote" | "text_position" | "region";
  pageNumber: number;
  selectedText?: string;
  prefix?: string;
  suffix?: string;
  bbox?: [number, number, number, number];
}

interface ReaderState {
  selectedText: string | null;
  selectionAnchor: SelectionAnchor | null;
  setSelection: (text: string, anchor?: SelectionAnchor) => void;
  clearSelection: () => void;
}

export const useReaderStore = create<ReaderState>((set) => ({
  selectedText: null,
  selectionAnchor: null,
  setSelection: (text, anchor) =>
    set({ selectedText: text, selectionAnchor: anchor ?? null }),
  clearSelection: () =>
    set({ selectedText: null, selectionAnchor: null }),
}));
