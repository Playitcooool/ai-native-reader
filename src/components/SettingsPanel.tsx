import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore, type ProviderSettingsInput, type ThemePreference } from "../stores/settingsStore";

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
  const { settings, addSetting, updateSetting, themePreference, setThemePreference } = useSettingsStore();
  const [section, setSection] = useState<"appearance" | "provider">("appearance");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [providerType, setProviderType] = useState("openai_compatible");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [isTranslation, setIsTranslation] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const initialLoadDone = useRef(false);

  // Populate form from saved settings — only from blank state, never after save
  useEffect(() => {
    if (settings.length > 0 && !initialLoadDone.current) {
      initialLoadDone.current = true;
      const s = settings[0];
      setBaseUrl(s.base_url ?? "");
      setApiKey(s.api_key ?? "");
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

  const selectProvider = (id: string) => {
    const s = settings.find((p) => p.id === id);
    if (!s) return;
    setBaseUrl(s.base_url ?? "");
    setApiKey(s.api_key ?? "");
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

  return (
    <div className="settings-panel">
      <nav className="settings-section-list" aria-label="Settings sections">
        <button className={section === "appearance" ? "active" : ""} onClick={() => setSection("appearance")}>
          Appearance
        </button>
        <button className={section === "provider" ? "active" : ""} onClick={() => setSection("provider")}>
          AI Provider
        </button>
      </nav>
      <div className="settings-detail-pane">
        <section hidden={section !== "appearance"}>
          <h3>Appearance</h3>
          <div className="settings-theme-group" role="group" aria-label="Theme">
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
        </section>

        <section className="settings-provider-section" hidden={section !== "provider"}>
          <h3>AI Provider</h3>
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
          <input id="base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={defaults.baseUrl} />

          <label htmlFor="api-key">API Key</label>
          <input id="api-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={defaults.apiKeyPlaceholder} />

          <label htmlFor="model">Model</label>
          <input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={defaults.modelPlaceholder} />

          <label className="settings-checkbox">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Use as default provider (for Explain, Summarize, Q&A)
          </label>

          <label className="settings-checkbox">
            <input type="checkbox" checked={isTranslation} onChange={(e) => setIsTranslation(e.target.checked)} />
            Use as translation provider
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="settings-primary-button" onClick={handleSave} disabled={saving} title="Save">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>

          {status && (
            <p className={status.ok ? "settings-status-ok" : "settings-status-error"}>
              {status.msg}
            </p>
          )}

          {settings.length > 0 && (
            <div className="settings-saved-providers">
              <p>Saved Providers</p>
              {settings.map((s) => (
                <div
                  key={s.id}
                  onClick={() => selectProvider(s.id)}
                  className={editingId === s.id ? "active" : ""}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectProvider(s.id);
                    }
                  }}
                >
                  <span className="settings-provider-model">{s.model}</span>
                  <span className="settings-provider-url">{s.base_url ?? "N/A"}</span>
                  <span className="settings-provider-badges">
                    {s.is_default && <span>Default</span>}
                    {s.is_translation && <span>Translate</span>}
                    <button onClick={(e) => { e.stopPropagation(); handleTest(s.id); }} disabled={testing} title="Test connection">
                      {testing ? "Testing..." : "Test"}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
