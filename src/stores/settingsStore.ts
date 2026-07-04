import { create } from "zustand";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

export interface ProviderSettings {
  id: string;
  provider_type: string;
  base_url: string | null;
  api_key: string | null;
  model: string;
  is_default: boolean | null;
  is_translation: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderSettingsInput {
  id?: string;
  provider_type: string;
  base_url?: string;
  api_key?: string;
  model: string;
  is_default?: boolean;
  is_translation?: boolean;
}

interface SettingsState {
  settings: ProviderSettings[];
  showSettings: boolean;
  theme: Theme;
  themePreference: ThemePreference;
  setSettings: (settings: ProviderSettings[]) => void;
  addSetting: (setting: ProviderSettings) => void;
  updateSetting: (id: string, setting: ProviderSettings) => void;
  openSettings: () => void;
  closeSettings: () => void;
  setShowSettings: (show: boolean) => void;
  toggleSettings: () => void;
  setTheme: (theme: Theme) => void;
  setThemePreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

const themeStorageKey = "reader-theme";
const systemThemeQuery = "(prefers-color-scheme: dark)";

export function parseThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveThemePreference(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function toggledThemePreference(resolvedTheme: Theme): Theme {
  return resolvedTheme === "dark" ? "light" : "dark";
}

function getStoredThemePreference(): ThemePreference {
  return parseThemePreference(globalThis.localStorage?.getItem(themeStorageKey) ?? null);
}

function getSystemPrefersDark(): boolean {
  return globalThis.matchMedia?.(systemThemeQuery).matches ?? false;
}

function applyTheme(theme: Theme) {
  if (!globalThis.document) return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

let unsubscribeSystemTheme: (() => void) | null = null;

function watchSystemTheme(set: (state: Partial<SettingsState>) => void, preference: ThemePreference) {
  unsubscribeSystemTheme?.();
  unsubscribeSystemTheme = null;
  if (preference !== "system" || !globalThis.matchMedia) return;

  const query = matchMedia(systemThemeQuery);
  const handleChange = (event: MediaQueryListEvent) => {
    const theme = resolveThemePreference("system", event.matches);
    applyTheme(theme);
    set({ theme });
  };
  query.addEventListener("change", handleChange);
  unsubscribeSystemTheme = () => query.removeEventListener("change", handleChange);
}

const initialThemePreference = getStoredThemePreference();
const initialTheme = resolveThemePreference(initialThemePreference, getSystemPrefersDark());
applyTheme(initialTheme);

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: [],
  showSettings: false,
  theme: initialTheme,
  themePreference: initialThemePreference,
  setSettings: (settings) => set({ settings }),
  addSetting: (setting) =>
    set((state) => ({ settings: [...state.settings, setting] })),
  updateSetting: (id, updated) =>
    set((state) => ({
      settings: state.settings.map((s) => (s.id === id ? updated : s)),
    })),
  openSettings: () => set({ showSettings: true }),
  closeSettings: () => set({ showSettings: false }),
  setShowSettings: (show) => set({ showSettings: show }),
  toggleSettings: () =>
    set((state) => ({ showSettings: !state.showSettings })),
  setTheme: (theme) => {
    localStorage.setItem(themeStorageKey, theme);
    applyTheme(theme);
    watchSystemTheme(set, theme);
    set({ theme, themePreference: theme });
  },
  setThemePreference: (preference) => {
    const theme = resolveThemePreference(preference, getSystemPrefersDark());
    localStorage.setItem(themeStorageKey, preference);
    applyTheme(theme);
    watchSystemTheme(set, preference);
    set({ theme, themePreference: preference });
  },
  toggleTheme: () => {
    set((state) => {
      const preference = toggledThemePreference(state.theme);
      localStorage.setItem(themeStorageKey, preference);
      applyTheme(preference);
      watchSystemTheme(set, preference);
      return { theme: preference, themePreference: preference };
    });
  },
}));

watchSystemTheme(useSettingsStore.setState, initialThemePreference);
