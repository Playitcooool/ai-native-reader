import { invoke } from "@tauri-apps/api/core";

const ALLOWED_EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:", "ftp:"]);

export function isAllowedExternalUrl(url: string): boolean {
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return false;
  try {
    return ALLOWED_EXTERNAL_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isAllowedExternalUrl(url)) throw new Error("Unsupported link URL");
  await invoke("open_external_url", { url });
}
