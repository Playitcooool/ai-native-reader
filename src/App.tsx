import "./App.css";
import LeftSidebar from "./components/LeftSidebar";
import type { SidebarTab } from "./components/LeftSidebar";
import { ToastProvider, useToast } from "./components/Toast";
import SettingsDialog from "./components/SettingsDialog";
import { useSettingsStore } from "./stores/settingsStore";
import { useDocumentStore } from "./stores/documentStore";
import { Suspense, lazy, startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useAiStore } from "./stores/aiStore";
import { useUndoStore } from "./stores/undoStore";

const CenterViewer = lazy(() => import("./components/CenterViewer"));
const AiSidebar = lazy(() => import("./components/AiSidebar"));
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProviderSettings } from "./stores/settingsStore";
import type { Collection, Document, DocumentCollection } from "./stores/documentStore";
import { isTauriRuntime } from "./tauriRuntime";

function App() {
  const { addToast } = useToast();
  const setSettings = useSettingsStore((s) => s.setSettings);
  const showSettings = useSettingsStore((s) => s.showSettings);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const handleOpenDocument = useDocumentStore((s) => s.handleOpenDocument);
  const handleOpenFolder = useDocumentStore((s) => s.handleOpenFolder);
  const undoLast = useUndoStore((s) => s.undoLast);
  const setCurrentDocument = useDocumentStore((s) => s.setCurrentDocument);
  const setDocuments = useDocumentStore((s) => s.setDocuments);
  const setCollections = useDocumentStore((s) => s.setCollections);
  const setDocumentCollections = useDocumentStore((s) => s.setDocumentCollections);
  const setLibraryFolder = useDocumentStore((s) => s.setLibraryFolder);
  const currentDocument = useDocumentStore((s) => s.currentDocument);
  const theme = useSettingsStore((s) => s.theme);
  const [leftOpen, setLeftOpen] = useState(false);
  const [readerDrawerTab, setReaderDrawerTab] = useState<SidebarTab>("library");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInputDraft, setAiInputDraft] = useState<string>();
  const appShellRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const rememberFocus = () => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };

  const restoreFocus = () => requestAnimationFrame(() => returnFocusRef.current?.focus());

  const closeLeftPanel = useCallback(() => {
    setLeftOpen(false);
    restoreFocus();
  }, []);

  const closeAiPanel = useCallback(() => {
    setAiOpen(false);
    restoreFocus();
  }, []);

  const openAiPanel = useCallback((draft?: string) => {
    rememberFocus();
    setLeftOpen(false);
    setAiOpen(true);
    if (draft) setAiInputDraft(draft);
  }, []);

  const goHome = useCallback(() => {
    setAiOpen(false);
    setLeftOpen(false);
    startTransition(() => setCurrentDocument(null));
  }, [setCurrentDocument]);

  const openLibraryPanel = useCallback(() => {
    rememberFocus();
    setReaderDrawerTab("library");
    setAiOpen(false);
    setLeftOpen(true);
  }, []);

  const openContentsPanel = useCallback(() => {
    rememberFocus();
    setReaderDrawerTab("contents");
    setAiOpen(false);
    setLeftOpen(true);
  }, []);

  useEffect(() => {
    if (!leftOpen && !aiOpen) return;
    const selector = leftOpen ? ".reader-drawer .sheet-close" : ".ai-sheet .sheet-close";
    requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (leftOpen) closeLeftPanel();
      else closeAiPanel();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [aiOpen, closeAiPanel, closeLeftPanel, leftOpen]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const shell = appShellRef.current;
    if (!shell) return;
    shell.toggleAttribute("inert", showSettings);
    return () => shell.removeAttribute("inert");
  }, [showSettings]);

  useEffect(() => {
    const handleUndo = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      undoLast()
        .then((label) => {
          if (label) window.dispatchEvent(new Event("annotations-changed"));
        })
        .catch(() => addToast({ type: "error", message: "Undo failed." }));
    };
    window.addEventListener("keydown", handleUndo);
    return () => window.removeEventListener("keydown", handleUndo);
  }, [undoLast, addToast]);

  useEffect(() => {
    useAiStore.getState().setSessionId(null);
    useAiStore.getState().setMessages([]);
  }, [currentDocument?.id]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    invoke<ProviderSettings[]>("get_provider_settings")
      .then((settings) => {
        if (settings && settings.length > 0) {
          setSettings(settings);
        }
      })
      .catch(() => addToast({ type: "error", message: "Failed to load provider settings." }));
  }, [setSettings, addToast]);

  // Load library on startup; documents open only after the user picks one.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    (async () => {
      try {
        const [docs, libraryFolder, collections, documentCollections] = await Promise.all([
          invoke<Document[]>("get_documents"),
          invoke<string | null>("get_library_folder"),
          invoke<Collection[]>("get_collections"),
          invoke<DocumentCollection[]>("get_collection_memberships"),
        ]);
        if (cancelled) return;
        setDocuments(docs);
        setLibraryFolder(libraryFolder);
        setCollections(collections);
        setDocumentCollections(documentCollections);
      } catch {
        if (!cancelled) addToast({ type: "error", message: "Failed to load library." });
      }
    })();
    return () => { cancelled = true; };
  }, [setCurrentDocument, setDocuments, setCollections, setDocumentCollections, setLibraryFolder, addToast]);

  // Listen for native menu File > Open PDF (Cmd+O)
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen("menu-open-pdf", () => {
      handleOpenDocument().catch(() => addToast({ type: "error", message: "Failed to open document." }));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleOpenDocument, addToast]);

  // Listen for native menu File > Open Folder (Cmd+Shift+O)
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen("menu-open-folder", () => {
      handleOpenFolder().catch(() => addToast({ type: "error", message: "Failed to open folder." }));
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [handleOpenFolder, addToast]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen("menu-open-settings", openSettings);
    return () => { unlisten.then((fn) => fn()); };
  }, [openSettings]);

  // Listen for library folder updates (new PDF auto-imported by watcher)
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen("library-folder-updated", () => {
      useDocumentStore.getState().loadDocuments();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  return (
    <ToastProvider>
      <div
        ref={appShellRef}
        className={currentDocument ? `reader-shell${aiOpen ? " ai-open" : ""}` : "app-layout library-shell"}
        aria-hidden={showSettings || undefined}
      >
        {!currentDocument && (
          <div className="sidebar-left">
            <LeftSidebar variant="library" />
          </div>
        )}
        <div className="center-viewer">
          <Suspense fallback={<div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>}>
            <CenterViewer onBackHome={goHome} onOpenLibrary={openLibraryPanel} onOpenContents={openContentsPanel} onOpenAi={openAiPanel} />
          </Suspense>
        </div>
        {leftOpen && (
          <div className="drawer-backdrop" onMouseDown={closeLeftPanel}>
            <aside className="reader-drawer" role="dialog" aria-modal="true" aria-label="Reader navigation" onMouseDown={(e) => e.stopPropagation()}>
              <button aria-label="Close drawer" className="sheet-close" onClick={closeLeftPanel}>×</button>
              <LeftSidebar variant="reader" initialTab={readerDrawerTab} />
            </aside>
          </div>
        )}
        {aiOpen && currentDocument && (
          <aside className="ai-sheet" role="complementary" aria-label="AI reading companion">
            <button aria-label="Close AI" className="sheet-close" onClick={closeAiPanel}>×</button>
            <Suspense fallback={<div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>}>
              <AiSidebar
                draftInput={aiInputDraft}
                onDraftConsumed={() => setAiInputDraft(undefined)}
              />
            </Suspense>
          </aside>
        )}
      </div>
      {showSettings && <SettingsDialog onClose={closeSettings} />}
    </ToastProvider>
  );
}

export default App;
