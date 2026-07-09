export function shouldFollowScroll(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold = 72,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function draftFromSelection(text: string): string {
  return `About this selection:\n\n${text.trim()}`;
}

export function describeAiScope(pages: number[], documentType = "pdf"): string {
  const unit = documentType === "epub" ? "chapter" : "page";
  const clean = Array.from(new Set(pages.filter((page) => Number.isFinite(page) && page >= 1))).sort((a, b) => a - b);
  if (clean.length === 0) return `No ${unit} text selected`;
  if (clean.length === 1) return `Sends ${unit} ${clean[0]} text`;
  return `Sends ${clean.length} ${unit}s: ${clean[0]}-${clean[clean.length - 1]}`;
}

export function formatAiError(error: unknown): string {
  const text = String(error);
  if (text.includes("timeout")) return "The AI provider timed out. Try a smaller scope or a faster model.";
  if (text.includes("network_error")) return "Could not reach the AI provider. Check the base URL and whether the server is running.";
  const provider = text.match(/provider_error: HTTP (\d+)/);
  if (provider) return `The AI provider returned HTTP ${provider[1]}. Check the model, key, and provider logs.`;
  if (text.includes("Missing api_key") || text.includes("missing an API key")) return "This provider needs an API key in Settings.";
  return text.replace(/^Error:\s*/, "");
}
