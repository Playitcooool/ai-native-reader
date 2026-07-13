import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { getVersion } from "@tauri-apps/api/app";
import { createDiagnosticReport, diagnosticsEnabled, setDiagnosticsEnabled } from "../features/diagnostics";
import {
  useSettingsStore,
  type DefaultEpubFontSize,
  type DefaultPdfZoom,
  type ProviderSettingsInput,
  type ThemePreference,
  type UiFontPreference,
} from "../stores/settingsStore";

const providerDefaults: Record<string, { baseUrl: string; model: string; apiKeyPlaceholder: string; modelPlaceholder: string }> = {
  openai_compatible: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyPlaceholder: "sk-...",
    modelPlaceholder: "gpt-4o-mini",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-haiku-4-5",
    apiKeyPlaceholder: "sk-ant-...",
    modelPlaceholder: "claude-haiku-4-5",
  },
  lm_studio: {
    baseUrl: "http://localhost:1234/v1",
    model: "local-model",
    apiKeyPlaceholder: "optional",
    modelPlaceholder: "local-model",
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    apiKeyPlaceholder: "optional",
    modelPlaceholder: "llama3.1",
  },
};

export default function SettingsPanel() {
  const {
    settings,
    addSetting,
    updateSetting,
    themePreference,
    uiFont,
    defaultPdfZoom,
    defaultEpubFontSize,
    rememberSidebarTab,
    setThemePreference,
    setUiFont,
    setDefaultPdfZoom,
    setDefaultEpubFontSize,
    setRememberSidebarTab,
    resetUiPreferences,
  } = useSettingsStore();
  const [section, setSection] = useState<"appearance" | "reading" | "shortcuts" | "provider" | "data" | "advanced">("appearance");
  const [baseUrl, setBaseUrl] = useState(providerDefaults.openai_compatible.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(providerDefaults.openai_compatible.model);
  const [providerType, setProviderType] = useState("openai_compatible");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [isTranslation, setIsTranslation] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [clearingTextCache, setClearingTextCache] = useState(false);
  const [clearingAiHistory, setClearingAiHistory] = useState(false);
  const [diagnostics, setDiagnostics] = useState(diagnosticsEnabled);
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);
  const initialLoadDone = useRef(false);

  // Populate form from saved settings — only from blank state, never after save
  useEffect(() => {
    if (settings.length > 0 && !initialLoadDone.current) {
      initialLoadDone.current = true;
      const s = settings[0];
      setBaseUrl(s.base_url ?? "");
      setApiKey("");
      setModel(s.model);
      setProviderType(s.provider_type);
      setEditingId(s.id);
      setIsDefault(s.is_default ?? true);
      setIsTranslation(s.is_translation ?? false);
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const input: ProviderSettingsInput = {
        id: editingId ?? undefined,
        provider_type: providerType,
        base_url: baseUrl || undefined,
        api_key: apiKey || undefined,
        model,
        is_default: isDefault,
        is_translation: isTranslation,
      };
      const result = await invoke<{
        id: string; provider_type: string; base_url: string | null;
        api_key: string | null; model: string; is_default: boolean | null; is_translation: boolean | null;
        created_at: string; updated_at: string;
      }>("save_provider_settings", { input });

      if (editingId) {
        updateSetting(editingId, result);
      } else {
        addSetting(result);
      }
      setEditingId(result.id);
      setApiKey("");
      setStatus({ ok: true, msg: "Settings saved." });
    } catch (err) {
      setStatus({ ok: false, msg: `Error: ${err}` });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (providerId: string) => {
    setTesting(true);
    setStatus(null);
    try {
      const result = await invoke<{
        ok: boolean; model: string | null; latency_ms: number | null;
        error_code: string | null; error_message: string | null;
      }>("test_provider", { providerId });
      if (result.ok) {
        setStatus({ ok: true, msg: `Connected! Model: ${result.model ?? "unknown"} (${result.latency_ms ?? 0}ms)` });
      } else {
        setStatus({ ok: false, msg: `Error [${result.error_code ?? "unknown"}]: ${result.error_message ?? "No details"}` });
      }
    } catch (err) {
      setStatus({ ok: false, msg: `Error: ${err}` });
    } finally {
      setTesting(false);
    }
  };

  const handleExportBackup = async () => {
    if (exportingBackup) return;
    setExportingBackup(true);
    setStatus(null);
    try {
      const destinationPath = await save({
        defaultPath: `rustybooks-backup-${new Date().toISOString().slice(0, 10)}.db`,
        filters: [{ name: "SQLite database", extensions: ["db"] }],
      });
      if (!destinationPath) return;
      await invoke("export_database_backup", { destinationPath });
      setStatus({ ok: true, msg: "Backup exported." });
    } catch (err) {
      setStatus({ ok: false, msg: `Backup failed: ${err}` });
    } finally {
      setExportingBackup(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (restoringBackup) return;
    if (!window.confirm("Restore this backup? This replaces your current local library, notes, AI history, reading state, and saved provider settings.")) return;
    setRestoringBackup(true);
    setStatus(null);
    try {
      const sourcePath = await open({
        multiple: false,
        filters: [{ name: "SQLite database", extensions: ["db"] }],
      });
      if (!sourcePath || Array.isArray(sourcePath)) return;
      await invoke("restore_database_backup", { sourcePath });
      setStatus({ ok: true, msg: "Backup restored. Restart RustyBooks to reload restored data." });
    } catch (err) {
      setStatus({ ok: false, msg: `Restore failed: ${err}` });
    } finally {
      setRestoringBackup(false);
    }
  };

  const handleClearTextCache = async () => {
    if (clearingTextCache) return;
    if (!window.confirm("Clear cached PDF text and OCR data? PDFs can rebuild it when opened.")) return;
    setClearingTextCache(true);
    setStatus(null);
    try {
      const result = await invoke<{ deletedRows: number }>("clear_pdf_page_text_cache");
      setStatus({ ok: true, msg: `Cleared ${result.deletedRows} cached PDF page rows.` });
    } catch (err) {
      setStatus({ ok: false, msg: `Cleanup failed: ${err}` });
    } finally {
      setClearingTextCache(false);
    }
  };

  const handleClearAiHistory = async () => {
    if (clearingAiHistory) return;
    if (!window.confirm("Clear all AI conversations, citations, and learning memories?")) return;
    setClearingAiHistory(true);
    setStatus(null);
    try {
      const result = await invoke<{ deletedSessions: number; deletedMessages: number; deletedMemories: number }>("clear_ai_history");
      setStatus({ ok: true, msg: `Cleared ${result.deletedSessions} AI sessions, ${result.deletedMessages} messages, and ${result.deletedMemories} memories.` });
    } catch (err) {
      setStatus({ ok: false, msg: `Cleanup failed: ${err}` });
    } finally {
      setClearingAiHistory(false);
    }
  };

  const handleExportDiagnostics = async () => {
    if (!diagnostics || exportingDiagnostics) return;
    setExportingDiagnostics(true);
    try {
      const destinationPath = await save({
        defaultPath: `rustybooks-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!destinationPath) return;
      await writeTextFile(destinationPath, JSON.stringify(createDiagnosticReport(await getVersion()), null, 2));
      setStatus({ ok: true, msg: "Anonymous diagnostics exported." });
    } catch (err) {
      setStatus({ ok: false, msg: `Diagnostics export failed: ${err}` });
    } finally {
      setExportingDiagnostics(false);
    }
  };

  const selectProvider = (id: string) => {
    const s = settings.find((p) => p.id === id);
    if (!s) return;
    setBaseUrl(s.base_url ?? "");
    setApiKey("");
    setModel(s.model);
    setProviderType(s.provider_type);
    setEditingId(s.id);
    setIsDefault(s.is_default ?? true);
    setIsTranslation(s.is_translation ?? false);
    setStatus(null);
  };

  const handleProviderTypeChange = (nextType: string) => {
    const previous = providerDefaults[providerType];
    const next = providerDefaults[nextType];
    setProviderType(nextType);
    if (!next) return;
    if (!baseUrl || baseUrl === previous?.baseUrl) setBaseUrl(next.baseUrl);
    if (!model || model === previous?.model) setModel(next.model);
  };

  const defaults = providerDefaults[providerType] ?? providerDefaults.openai_compatible;
  const themeOptions: Array<{ value: ThemePreference; label: string }> = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];
  const fontOptions: Array<{ value: UiFontPreference; label: string }> = [
    { value: "system", label: "System" },
    { value: "serif", label: "Serif" },
    { value: "mono", label: "Mono" },
  ];
  const pdfZoomOptions: Array<{ value: DefaultPdfZoom; label: string }> = [
    { value: "auto", label: "Auto fit width" },
    { value: "100", label: "100%" },
    { value: "125", label: "125%" },
    { value: "150", label: "150%" },
    { value: "175", label: "175%" },
  ];
  const epubSizeOptions: DefaultEpubFontSize[] = [80, 90, 100, 110, 120, 130, 140, 150, 160];
  const shortcuts = [
    ["Cmd/Ctrl+Shift+T", "Toggle theme"],
    ["Arrow Left / Page Up", "Previous page"],
    ["Arrow Right / Page Down", "Next page"],
    ["+ / -", "Zoom or text size"],
    ["0", "Reset zoom or text size"],
    ["?", "PDF shortcut help"],
    ["E", "Explain selected text"],
    ["Cmd/Ctrl+B", "Highlight selection"],
    ["Esc", "Clear selection"],
  ];
  const sections: Array<{ id: typeof section; label: string }> = [
    { id: "appearance", label: "Appearance" },
    { id: "reading", label: "Reading" },
    { id: "shortcuts", label: "Shortcuts" },
    { id: "provider", label: "AI Provider" },
    { id: "data", label: "Data" },
    { id: "advanced", label: "Advanced" },
  ];

  return (
    <div className="settings-panel">
      <nav className="settings-section-list" aria-label="Settings sections">
        {sections.map((item) => (
          <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="settings-detail-pane">
        <section className="settings-form-section" hidden={section !== "appearance"}>
          <h3>Appearance</h3>
          <label>Theme</label>
          <div className="settings-segmented-group" role="group" aria-label="Theme">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setThemePreference(option.value)}
                aria-pressed={themePreference === option.value}
                className={themePreference === option.value ? "active" : ""}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label>UI font</label>
          <div className="settings-segmented-group" role="group" aria-label="UI font">
            {fontOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setUiFont(option.value)}
                aria-pressed={uiFont === option.value}
                className={uiFont === option.value ? "active" : ""}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-form-section" hidden={section !== "reading"}>
          <h3>Reading</h3>
          <label htmlFor="default-pdf-zoom">Default PDF zoom</label>
          <select id="default-pdf-zoom" value={defaultPdfZoom} onChange={(e) => setDefaultPdfZoom(e.target.value as DefaultPdfZoom)}>
            {pdfZoomOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <label htmlFor="default-epub-font-size">Default EPUB text size</label>
          <select id="default-epub-font-size" value={defaultEpubFontSize} onChange={(e) => setDefaultEpubFontSize(Number(e.target.value) as DefaultEpubFontSize)}>
            {epubSizeOptions.map((size) => <option key={size} value={size}>{size}%</option>)}
          </select>
        </section>

        <section className="settings-form-section" hidden={section !== "shortcuts"}>
          <h3>Shortcuts</h3>
          <div className="settings-shortcut-list">
            {shortcuts.map(([keys, action]) => (
              <div key={keys}>
                <kbd>{keys}</kbd>
                <span>{action}</span>
              </div>
            ))}
          </div>
        </section>

        <form className="settings-provider-section" hidden={section !== "provider"} onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}>
          <h3>AI Provider</h3>
          <p className="settings-muted">Cloud providers receive the document context needed for each request. Use a local provider to keep that context on this device.</p>
          <label htmlFor="provider-type">Provider Type</label>
          <select id="provider-type"
            value={providerType}
            onChange={(e) => handleProviderTypeChange(e.target.value)}
          >
            <option value="openai_compatible">OpenAI Compatible</option>
            <option value="anthropic">Anthropic</option>
            <option value="lm_studio">LM Studio</option>
            <option value="ollama">Ollama</option>
          </select>

          <label htmlFor="base-url">Base URL</label>
          <input id="base-url" type="url" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={defaults.baseUrl} spellCheck={false} />

          <label htmlFor="api-key">API Key</label>
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={editingId ? "Saved; leave blank to keep" : defaults.apiKeyPlaceholder}
          />

          <label htmlFor="model">Model</label>
          <input id="model" required value={model} onChange={(e) => setModel(e.target.value)} placeholder={defaults.modelPlaceholder} spellCheck={false} />

          <label className="settings-checkbox">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Use as default provider (for Explain, Summarize, Q&A)
          </label>

          <label className="settings-checkbox">
            <input type="checkbox" checked={isTranslation} onChange={(e) => setIsTranslation(e.target.checked)} />
            Use as translation provider
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="settings-primary-button" disabled={saving} title="Save">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>

          {status && (
            <p role={status.ok ? "status" : "alert"} className={status.ok ? "settings-status-ok" : "settings-status-error"}>
              {status.msg}
            </p>
          )}

          {settings.length > 0 && (
            <div className="settings-saved-providers">
              <p>Saved Providers</p>
              {settings.map((s) => (
                <div
                  key={s.id}
                  className={editingId === s.id ? "active" : ""}
                >
                  <button type="button" className="settings-provider-choice" onClick={() => selectProvider(s.id)} aria-pressed={editingId === s.id}>
                    <span className="settings-provider-model">{s.model}</span>
                    <span className="settings-provider-url">{s.base_url ?? "N/A"}</span>
                    <span className="settings-provider-badges">
                      {s.is_default && <span>Default</span>}
                      {s.is_translation && <span>Translate</span>}
                    </span>
                  </button>
                  <button type="button" className="settings-provider-test" onClick={() => handleTest(s.id)} disabled={testing} aria-label={`Test ${s.model} connection`}>
                    {testing ? "Testing..." : "Test"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </form>

        <section className="settings-form-section" hidden={section !== "data"}>
          <h3>Data</h3>
          <p className="settings-muted">Export a local SQLite backup of your library, notes, AI history, reading state, and saved provider settings.</p>
          <button type="button" className="settings-primary-button" onClick={handleExportBackup} disabled={exportingBackup}>
            {exportingBackup ? "Exporting..." : "Export Backup"}
          </button>
          <button type="button" className="settings-danger-button" onClick={handleRestoreBackup} disabled={restoringBackup}>
            {restoringBackup ? "Restoring..." : "Restore Backup"}
          </button>
          <button type="button" className="settings-danger-button" onClick={handleClearTextCache} disabled={clearingTextCache}>
            {clearingTextCache ? "Clearing..." : "Clear PDF Text Cache"}
          </button>
          <button type="button" className="settings-danger-button" onClick={handleClearAiHistory} disabled={clearingAiHistory}>
            {clearingAiHistory ? "Clearing..." : "Clear AI History"}
          </button>
          {status && (
            <p role={status.ok ? "status" : "alert"} className={status.ok ? "settings-status-ok" : "settings-status-error"}>
              {status.msg}
            </p>
          )}
          <p className="settings-muted">Reset only theme, UI font, reading defaults, and sidebar preference.</p>
          <button type="button" className="settings-danger-button" onClick={resetUiPreferences}>
            Reset UI preferences
          </button>
        </section>

        <section className="settings-form-section" hidden={section !== "advanced"}>
          <h3>Advanced</h3>
          <label className="settings-checkbox">
            <input type="checkbox" checked={rememberSidebarTab} onChange={(e) => setRememberSidebarTab(e.target.checked)} />
            Remember sidebar tab
          </label>
          <label className="settings-checkbox">
            <input type="checkbox" checked={diagnostics} onChange={(e) => {
              setDiagnostics(e.target.checked);
              setDiagnosticsEnabled(e.target.checked);
            }} />
            Collect anonymous performance diagnostics locally
          </label>
          <p className="settings-muted">Off by default. Stores at most 200 timing events in memory and never sends them over the network.</p>
          <button type="button" className="settings-primary-button" onClick={handleExportDiagnostics} disabled={!diagnostics || exportingDiagnostics}>
            {exportingDiagnostics ? "Exporting..." : "Export Diagnostics"}
          </button>
          {status && (
            <p role={status.ok ? "status" : "alert"} className={status.ok ? "settings-status-ok" : "settings-status-error"}>{status.msg}</p>
          )}
        </section>
      </div>
    </div>
  );
}
