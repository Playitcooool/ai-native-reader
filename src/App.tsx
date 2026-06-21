import "./App.css";
import LeftSidebar from "./components/LeftSidebar";
import CenterViewer from "./components/CenterViewer";
import AiSidebar from "./components/AiSidebar";
import { ToastProvider } from "./components/Toast";
import { useSettingsStore } from "./stores/settingsStore";
import { useDocumentStore } from "./stores/documentStore";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProviderSettings } from "./stores/settingsStore";
import type { Document } from "./stores/documentStore";

function App() {
  const setSettings = useSettingsStore((s) => s.setSettings);
  const handleOpenPdf = useDocumentStore((s) => s.handleOpenPdf);
  const setCurrentDocument = useDocumentStore((s) => s.setCurrentDocument);
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    invoke<ProviderSettings[]>("get_provider_settings")
      .then((settings) => {
        if (settings && settings.length > 0) {
          setSettings(settings);
        }
      })
      .catch(console.error);
  }, [setSettings]);

  // Auto-restore last opened document on startup
  useEffect(() => {
    invoke<Document[]>("get_documents")
      .then((docs) => {
        if (docs && docs.length > 0) {
          const sorted = [...docs].sort(
            (a, b) =>
              new Date(b.last_opened_at ?? b.created_at).getTime() -
              new Date(a.last_opened_at ?? a.created_at).getTime(),
          );
          if (sorted[0]) {
            setCurrentDocument(sorted[0]);
          }
        }
      })
      .catch(console.error);
  }, [setCurrentDocument]);

  // Listen for native menu File > Open PDF (Cmd+O)
  useEffect(() => {
    const unlisten = listen("menu-open-pdf", () => {
      handleOpenPdf();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleOpenPdf]);

  return (
    <ToastProvider>
      <div className="app-layout">
        <LeftSidebar />
        <CenterViewer />
        <AiSidebar />
      </div>
    </ToastProvider>
  );
}

export default App;
