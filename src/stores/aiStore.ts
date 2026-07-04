import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { pagesNeededForWorkflow } from "../features/ai/workflowPages";
import { ensurePagesTextReady } from "../features/pdf/pdfTextExtraction";

export interface AiMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  page_number: number | null;
  context_snapshot_json: string | null;
  citations_json: string | null;
  created_at: string;
}

export interface AiSessionListItem {
  id: string;
  document_id: string;
  title: string | null;
  scope_type: string;
  scope_json: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_preview: string | null;
}

interface AiState {
  messages: AiMessage[];
  sessions: AiSessionListItem[];
  sessionId: string | null;
  isLoadingSessions: boolean;
  isGenerating: boolean;
  aiPhase: string;
  streamingContent: string;
  pendingUserContent: string | null;
  lastWorkflowInput: Record<string, any> | null;
  setSessionId: (id: string | null) => void;
  addMessage: (msg: AiMessage) => void;
  setMessages: (msgs: AiMessage[]) => void;
  setGenerating: (g: boolean) => void;
  setStreamingContent: (content: string) => void;
  loadDocumentSessions: (documentId: string) => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  startNewSession: () => void;
  runWorkflow: (input: {
    documentId: string;
    documentTitle?: string;
    mode: string;
    pageNumber: number;
    selectedText?: string;
    startPage?: number;
    endPage?: number;
    pageNumbers?: number[];
    pageCount?: number | null;
    question?: string;
    tocNodeId?: string;
  }) => Promise<string | null>;
  cancelWorkflow: () => void;
  retryLastWorkflow: () => Promise<string | null>;
  loadSessionMessages: (sessionId: string) => Promise<void>;
}

/** Pdfjs document proxy — set by PdfViewer on load, used for page rendering before OCR. */
let ocrPdfRef: any = null;

/** Set the pdfjs document for on-demand page rendering (called from PdfViewer). */
export function setOcrPdfRef(pdf: any) {
  ocrPdfRef = pdf;
}

let cancelFlag = false;
let isWorkflowRunning = false;
let runningDocumentId: string | null = null;
let activeDocumentId: string | null = null;
let sessionsLoadToken = 0;
let messagesLoadToken = 0;
let streamBuffer = "";
let streamTimer: ReturnType<typeof setTimeout> | null = null;

function flushStreamBuffer(set: any) {
  if (streamBuffer) {
    set((s: AiState) => ({ streamingContent: s.streamingContent + streamBuffer }));
    streamBuffer = "";
  }
  streamTimer = null;
}

function workflowUserContent(input: Parameters<AiState["runWorkflow"]>[0]): string {
  return input.selectedText ?? input.question ??
    (input.mode === "page_summary" ? `Summarize page ${input.pageNumber}` :
     input.mode === "range_summary" && input.startPage && input.endPage ? `Summarize pages ${input.startPage}–${input.endPage}` :
     input.mode === "range_qa" && input.question ? input.question :
     input.mode);
}

export const useAiStore = create<AiState>((set, get) => ({
  messages: [],
  sessions: [],
  sessionId: null,
  isLoadingSessions: false,
  isGenerating: false,
  aiPhase: "",
  streamingContent: "",
  pendingUserContent: null,
  lastWorkflowInput: null,
  setSessionId: (id) => set({ sessionId: id }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setMessages: (msgs) => set({ messages: msgs }),
  setGenerating: (g) => set({ isGenerating: g }),
  setStreamingContent: (content) => set({ streamingContent: content }),
  loadDocumentSessions: async (documentId) => {
    const token = ++sessionsLoadToken;
    const switchingDocument = activeDocumentId !== documentId;
    activeDocumentId = documentId;
    if (switchingDocument) {
      ++messagesLoadToken;
      set({ messages: [], sessions: [], sessionId: null, pendingUserContent: null });
    }
    set({ isLoadingSessions: true });

    try {
      const sessions = await invoke<AiSessionListItem[]>("list_ai_sessions", {
        documentId,
        limit: 25,
      });
      if (token !== sessionsLoadToken || activeDocumentId !== documentId) return;

      set({ sessions, isLoadingSessions: false });
      if (!get().sessionId && sessions[0]) {
        await get().selectSession(sessions[0].id);
      }
    } catch (err) {
      if (token === sessionsLoadToken) set({ isLoadingSessions: false });
      console.error("Failed to load AI sessions:", err);
    }
  },
  selectSession: async (sessionId) => {
    const token = ++messagesLoadToken;
    set({ sessionId, messages: [], streamingContent: "", pendingUserContent: null });
    try {
      const msgs = await invoke<AiMessage[]>("get_session_messages", {
        sessionId,
        limit: 50,
      });
      if (token !== messagesLoadToken || get().sessionId !== sessionId) return;
      set({ messages: msgs });
    } catch (err) {
      console.error("Failed to load session messages:", err);
    }
  },
  startNewSession: () => {
    ++messagesLoadToken;
    set({ sessionId: null, messages: [], streamingContent: "", pendingUserContent: null, aiPhase: "", lastWorkflowInput: null });
  },

  runWorkflow: async (input) => {
    if (isWorkflowRunning) throw new Error("An AI workflow is already running.");
    isWorkflowRunning = true;
    runningDocumentId = input.documentId;
    activeDocumentId = input.documentId;
    const userContent = workflowUserContent(input);
    set({ isGenerating: true, aiPhase: "building_context", streamingContent: "", pendingUserContent: userContent, lastWorkflowInput: input as Record<string, any> });

    let unlisten: UnlistenFn[] = [];
    cancelFlag = false;

    try {
      // Listen for phase changes
      const phaseUnlisten = await listen<{ phase: string }>("ai-phase-change", (event) => {
        set({ aiPhase: event.payload.phase });
      });
      unlisten.push(phaseUnlisten);
      // Listen for streaming tokens from backend (debounced)
      const tokenUnlisten = await listen<{ token: string }>("ai-stream-chunk", (event) => {
        streamBuffer += event.payload.token;
        if (!streamTimer) {
          streamTimer = setTimeout(() => flushStreamBuffer(set), 50);
        }
      });
      unlisten.push(tokenUnlisten);

      // Wait for target page text/OCR before calling AI.
      const pages = pagesNeededForWorkflow(input);
      const status = await ensurePagesTextReady(input.documentId, pages, {
        pdf: ocrPdfRef,
        isCancelled: () => cancelFlag,
        onPhase: (phase, pageNumber) => set({ aiPhase: `${phase}:${pageNumber}` }),
      });
      if (cancelFlag) return null;
      if (status.ready === 0) {
        const scope = pages.length === 1 ? `page ${pages[0]}` : "this range";
        throw new Error(`No readable text is available on ${scope}. Try a clearer scan or a smaller page range.`);
      }
      if (status.failed > 0 && pages.length === 1) {
        throw new Error(`No readable text is available on page${status.failedPages.length === 1 ? "" : "s"} ${status.failedPages.join(", ")}. Try a clearer scan or a smaller page range.`);
      }

      const result = await invoke<{
        message_id: string;
        session_id: string;
        answer_md: string;
        context_snapshot: any;
      }>("run_ai_workflow", {
        input: {
          document_id: input.documentId,
          document_title: input.documentTitle ?? null,
          mode: input.mode,
          page_number: input.pageNumber,
          selected_text: input.selectedText ?? null,
          start_page: input.startPage ?? null,
          end_page: input.endPage ?? null,
          page_numbers: input.pageNumbers ?? null,
          question: input.question ?? null,
          existing_session_id: get().sessionId,
          toc_node_id: input.tocNodeId ?? null,
        },
      });

      if (streamTimer) { clearTimeout(streamTimer); streamTimer = null; }
      flushStreamBuffer(set);
      if (cancelFlag) return null;

      set({ sessionId: result.session_id });

      // Add messages to local state
      const now = new Date().toISOString();
      const userMsg: AiMessage = {
        id: `user_${Date.now()}`,
        session_id: result.session_id,
        role: "user",
        content: userContent,
        page_number: input.pageNumber,
        context_snapshot_json: null,
        citations_json: null,
        created_at: now,
      };
      const asstMsg: AiMessage = {
        id: result.message_id,
        session_id: result.session_id,
        role: "assistant",
        content: result.answer_md,
        page_number: input.pageNumber,
        context_snapshot_json: JSON.stringify(result.context_snapshot),
        citations_json: null,
        created_at: now,
      };

      set((s) => ({
        messages: [...s.messages, userMsg, asstMsg],
        streamingContent: "",
        pendingUserContent: null,
      }));

      await get().loadDocumentSessions(input.documentId);
      return result.answer_md;
    } catch (err) {
      if (String(err).includes("cancelled")) return null;
      console.error("aiStore.runWorkflow failed:", err);
      throw err;
    } finally {
      unlisten.forEach((u) => u());
      if (streamTimer) { clearTimeout(streamTimer); streamTimer = null; }
      streamBuffer = "";
      cancelFlag = false;
      isWorkflowRunning = false;
      runningDocumentId = null;
      set({ isGenerating: false, aiPhase: "", streamingContent: "", pendingUserContent: null });
    }
  },

  cancelWorkflow: () => {
    cancelFlag = true;
    if (runningDocumentId) {
      invoke("cancel_ai_workflow", { documentId: runningDocumentId }).catch(() => {});
    }
    set({ isGenerating: false, aiPhase: "cancelled", streamingContent: "", pendingUserContent: null });
  },

  retryLastWorkflow: async () => {
    const last = get().lastWorkflowInput;
    if (!last) return null;
    return get().runWorkflow(last as any);
  },

  loadSessionMessages: async (sessionId) => {
    await get().selectSession(sessionId);
  },
}));
