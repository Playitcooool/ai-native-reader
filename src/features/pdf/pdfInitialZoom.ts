const PAGE_GUTTER_PX = 48;
const MIN_INITIAL_ZOOM = 0.5;
const MAX_INITIAL_ZOOM = 1.75;

export type PdfInitialZoomPreference = "auto" | "100" | "125" | "150" | "175";

export function computeInitialPdfZoom(containerWidth: number, pageWidth: number): number {
  if (containerWidth <= 0 || pageWidth <= 0) return 1;
  const fitWidth = (containerWidth - PAGE_GUTTER_PX) / pageWidth;
  return Math.max(MIN_INITIAL_ZOOM, Math.min(MAX_INITIAL_ZOOM, fitWidth));
}

export function computePreferredInitialPdfZoom(
  containerWidth: number,
  pageWidth: number,
  preference: PdfInitialZoomPreference,
): number {
  return preference === "auto" ? computeInitialPdfZoom(containerWidth, pageWidth) : Number(preference) / 100;
}
