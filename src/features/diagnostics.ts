export type DiagnosticMetricName = "pdf_open_ms" | "search_ms" | "indexing_ms" | "ocr_ms" | "ai_first_token_ms";

export interface DiagnosticEventV1 {
  name: DiagnosticMetricName;
  duration_ms: number;
  values: Record<string, number>;
}

export interface DiagnosticReportV1 {
  schema_version: 1;
  app_version: string;
  platform: string;
  created_at: string;
  events: DiagnosticEventV1[];
}

const storageKey = "rustybooks.diagnostics.enabled";
const events: DiagnosticEventV1[] = [];

export function diagnosticsEnabled(): boolean {
  return globalThis.localStorage?.getItem(storageKey) === "true";
}

export function setDiagnosticsEnabled(enabled: boolean): void {
  globalThis.localStorage?.setItem(storageKey, String(enabled));
  if (!enabled) events.length = 0;
}

export function recordDiagnostic(name: DiagnosticMetricName, durationMs: number, values: Record<string, unknown> = {}): void {
  if (!diagnosticsEnabled() || !Number.isFinite(durationMs)) return;
  const numericValues = Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
  );
  events.push({ name, duration_ms: Math.max(0, Math.round(durationMs)), values: numericValues });
  if (events.length > 200) events.shift();
}

export function createDiagnosticReport(appVersion: string): DiagnosticReportV1 {
  return {
    schema_version: 1,
    app_version: appVersion,
    platform: navigator.platform,
    created_at: new Date().toISOString(),
    events: events.slice(),
  };
}
