export type InkSpace = "pdf-page" | "epub-section";

export interface InkPoint {
  x: number;
  y: number;
}

export interface InkAnchor {
  version: 1;
  space: InkSpace;
  points: InkPoint[];
  width: number;
  sectionIndex?: number;
  href?: string;
}

export interface InkToolState {
  activeTool: "none" | "pen" | "eraser";
  color: string;
  penWidth: number;
  eraserWidth: number;
}

export interface InkSize {
  width: number;
  height: number;
}

export const INK_COLORS = ["#111827", "#dc2626", "#2563eb", "#16a34a", "#f97316", "#9333ea"];
export const PEN_WIDTHS = [2, 4, 8, 12];
export const ERASER_WIDTHS = [8, 16, 28];

export function parseInkAnchor(value: string | null): InkAnchor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<InkAnchor>;
    if (
      parsed.version !== 1 ||
      (parsed.space !== "pdf-page" && parsed.space !== "epub-section") ||
      !Array.isArray(parsed.points) ||
      typeof parsed.width !== "number"
    ) {
      return null;
    }
    const points = parsed.points
      .filter((p): p is InkPoint => typeof p?.x === "number" && typeof p?.y === "number")
      .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }));
    if (points.length < 2) return null;
    return {
      version: 1,
      space: parsed.space,
      points,
      width: Math.max(0.5, parsed.width),
      sectionIndex: typeof parsed.sectionIndex === "number" ? parsed.sectionIndex : undefined,
      href: typeof parsed.href === "string" ? parsed.href : undefined,
    };
  } catch {
    return null;
  }
}

export function normalizePoint(point: InkPoint, size: InkSize): InkPoint {
  return {
    x: size.width > 0 ? clamp01(point.x / size.width) : 0,
    y: size.height > 0 ? clamp01(point.y / size.height) : 0,
  };
}

export function denormalizePoint(point: InkPoint, size: InkSize): InkPoint {
  return {
    x: point.x * size.width,
    y: point.y * size.height,
  };
}

export function simplifyLocalPoints(points: InkPoint[], minDistance = 1.5): InkPoint[] {
  if (points.length <= 2) return points;
  const simplified = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (distance(simplified[simplified.length - 1], points[i]) >= minDistance) {
      simplified.push(points[i]);
    }
  }
  const last = points[points.length - 1];
  if (distance(simplified[simplified.length - 1], last) > 0) simplified.push(last);
  return simplified;
}

export function strokeHitByEraser(
  stroke: InkAnchor,
  eraserPoints: InkPoint[],
  size: InkSize,
  eraserWidth: number,
  strokeScale = 1,
): boolean {
  const local = stroke.points.map((p) => denormalizePoint(p, size));
  const radius = eraserWidth / 2 + (stroke.width * strokeScale) / 2;
  return polylineDistance(local, eraserPoints) <= radius;
}

export function splitStrokeByEraser(
  stroke: InkAnchor,
  eraserPoints: InkPoint[],
  size: InkSize,
  eraserWidth: number,
  strokeScale = 1,
): InkAnchor[] {
  const local = stroke.points.map((p) => denormalizePoint(p, size));
  const radius = eraserWidth / 2 + (stroke.width * strokeScale) / 2;
  const keep: boolean[] = local.map((point) => pointDistanceToPolyline(point, eraserPoints) > radius);

  const fragments: InkAnchor[] = [];
  let current: InkPoint[] = keep[0] ? [stroke.points[0]] : [];
  const flush = () => {
    if (current.length >= 2) {
      fragments.push({ ...stroke, points: current });
    }
    current = [];
  };

  for (let i = 1; i < stroke.points.length; i++) {
    const segmentErased = segmentDistanceToPolyline(local[i - 1], local[i], eraserPoints) <= radius;
    if (segmentErased) {
      flush();
      if (keep[i]) current = [stroke.points[i]];
      continue;
    }
    if (!keep[i]) {
      flush();
      continue;
    }
    if (current.length === 0 && keep[i - 1]) current.push(stroke.points[i - 1]);
    current.push(stroke.points[i]);
  }
  flush();
  return fragments;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function distance(a: InkPoint, b: InkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polylineDistance(a: InkPoint[], b: InkPoint[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < a.length - 1; i++) {
    best = Math.min(best, segmentDistanceToPolyline(a[i], a[i + 1], b));
  }
  return best;
}

function pointDistanceToPolyline(point: InkPoint, polyline: InkPoint[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polyline.length - 1; i++) {
    best = Math.min(best, pointToSegmentDistance(point, polyline[i], polyline[i + 1]));
  }
  return best;
}

function segmentDistanceToPolyline(a: InkPoint, b: InkPoint, polyline: InkPoint[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polyline.length - 1; i++) {
    best = Math.min(best, segmentToSegmentDistance(a, b, polyline[i], polyline[i + 1]));
  }
  return best;
}

function segmentToSegmentDistance(a: InkPoint, b: InkPoint, c: InkPoint, d: InkPoint): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b),
  );
}

function pointToSegmentDistance(point: InkPoint, a: InkPoint, b: InkPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

function segmentsIntersect(a: InkPoint, b: InkPoint, c: InkPoint, d: InkPoint): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function orientation(a: InkPoint, b: InkPoint, c: InkPoint): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}
