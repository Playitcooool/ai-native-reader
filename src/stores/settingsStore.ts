import { create } from "zustand";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";
export type UiFontPreference = "system" | "serif" | "mono";
export type DefaultPdfZoom = "auto" | "100" | "125" | "150" | "175";
export type DefaultEpubFontSize = 80 | 90 | 100 | 110 | 120 | 130 | 140 | 150 | 160;

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
  uiFont: UiFontPreference;
  defaultPdfZoom: DefaultPdfZoom;
  defaultEpubFontSize: DefaultEpubFontSize;
  rememberSidebarTab: boolean;
  setSettings: (settings: ProviderSettings[]) => void;
  addSetting: (setting: ProviderSettings) => void;
  updateSetting: (id: string, setting: ProviderSettings) => void;
  openSettings: () => void;
  closeSettings: () => void;
  setShowSettings: (show: boolean) => void;
  toggleSettings: () => void;
  setTheme: (theme: Theme) => void;
  setThemePreference: (preference: ThemePreference) => void;
  setUiFont: (preference: UiFontPreference) => void;
  setDefaultPdfZoom: (preference: DefaultPdfZoom) => void;
  setDefaultEpubFontSize: (preference: DefaultEpubFontSize) => void;
  setRememberSidebarTab: (remember: boolean) => void;
  resetUiPreferences: () => void;
  toggleTheme: () => void;
}

const themeStorageKey = "reader-theme";
const uiFontStorageKey = "reader-ui-font";
const defaultPdfZoomStorageKey = "reader-default-pdf-zoom";
const defaultEpubFontSizeStorageKey = "reader-default-epub-font-size";
const rememberSidebarTabStorageKey = "reader-remember-sidebar-tab";
const systemThemeQuery = "(prefers-color-scheme: dark)";
const defaultUiPreferences = {
  uiFont: "system" as UiFontPreference,
  defaultPdfZoom: "auto" as DefaultPdfZoom,
  defaultEpubFontSize: 100 as DefaultEpubFontSize,
  rememberSidebarTab: true,
};
const fontStacks: Record<UiFontPreference, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  mono: 'var(--font-mono)',
};

export function parseThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function parseUiFontPreference(value: string | null): UiFontPreference {
  return value === "serif" || value === "mono" || value === "system" ? value : defaultUiPreferences.uiFont;
}

export function parseDefaultPdfZoom(value: string | null): DefaultPdfZoom {
  return value === "auto" || value === "100" || value === "125" || value === "150" || value === "175"
    ? value
    : defaultUiPreferences.defaultPdfZoom;
}

export function parseDefaultEpubFontSize(value: string | null): DefaultEpubFontSize {
  const size = Number(value);
  return [80, 90, 100, 110, 120, 130, 140, 150, 160].includes(size)
    ? size as DefaultEpubFontSize
    : defaultUiPreferences.defaultEpubFontSize;
}

export function parseRememberSidebarTab(value: string | null): boolean {
  return value === null ? defaultUiPreferences.rememberSidebarTab : value === "true";
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

function applyUiFont(preference: UiFontPreference) {
  if (!globalThis.document) return;
  document.documentElement.style.setProperty("--font-sans", fontStacks[preference]);
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
const initialUiFont = parseUiFontPreference(globalThis.localStorage?.getItem(uiFontStorageKey) ?? null);
const initialDefaultPdfZoom = parseDefaultPdfZoom(globalThis.localStorage?.getItem(defaultPdfZoomStorageKey) ?? null);
const initialDefaultEpubFontSize = parseDefaultEpubFontSize(globalThis.localStorage?.getItem(defaultEpubFontSizeStorageKey) ?? null);
const initialRememberSidebarTab = parseRememberSidebarTab(globalThis.localStorage?.getItem(rememberSidebarTabStorageKey) ?? null);
applyTheme(initialTheme);
applyUiFont(initialUiFont);

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: [],
  showSettings: false,
  theme: initialTheme,
  themePreference: initialThemePreference,
  uiFont: initialUiFont,
  defaultPdfZoom: initialDefaultPdfZoom,
  defaultEpubFontSize: initialDefaultEpubFontSize,
  rememberSidebarTab: initialRememberSidebarTab,
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
  setUiFont: (uiFont) => {
    localStorage.setItem(uiFontStorageKey, uiFont);
    applyUiFont(uiFont);
    set({ uiFont });
  },
  setDefaultPdfZoom: (defaultPdfZoom) => {
    localStorage.setItem(defaultPdfZoomStorageKey, defaultPdfZoom);
    set({ defaultPdfZoom });
  },
  setDefaultEpubFontSize: (defaultEpubFontSize) => {
    localStorage.setItem(defaultEpubFontSizeStorageKey, String(defaultEpubFontSize));
    set({ defaultEpubFontSize });
  },
  setRememberSidebarTab: (rememberSidebarTab) => {
    localStorage.setItem(rememberSidebarTabStorageKey, String(rememberSidebarTab));
    set({ rememberSidebarTab });
  },
  resetUiPreferences: () => {
    localStorage.removeItem(themeStorageKey);
    localStorage.removeItem(uiFontStorageKey);
    localStorage.removeItem(defaultPdfZoomStorageKey);
    localStorage.removeItem(defaultEpubFontSizeStorageKey);
    localStorage.removeItem(rememberSidebarTabStorageKey);
    const themePreference: ThemePreference = "system";
    const theme = resolveThemePreference(themePreference, getSystemPrefersDark());
    applyTheme(theme);
    applyUiFont(defaultUiPreferences.uiFont);
    watchSystemTheme(set, themePreference);
    set({ theme, themePreference, ...defaultUiPreferences });
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
