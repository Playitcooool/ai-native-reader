import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Rendition } from "epubjs";
import type { Annotation } from "../../stores/notesStore";
import InkCanvasOverlay from "./InkCanvasOverlay";
import type { InkToolState } from "./inkGeometry";

interface EpubInkOverlayProps {
  documentId: string;
  container: HTMLElement | null;
  rendition: Rendition | null;
  toolState: InkToolState;
  refreshKey: number;
  onChanged?: () => void;
}

interface EpubViewInfo {
  key: string;
  pageNumber: number;
  sectionIndex: number;
  href?: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export default function EpubInkOverlay({
  documentId,
  container,
  rendition,
  toolState,
  refreshKey,
  onChanged,
}: EpubInkOverlayProps) {
  const [views, setViews] = useState<EpubViewInfo[]>([]);
  const [annotationsByPage, setAnnotationsByPage] = useState<Record<number, Annotation[]>>({});

  const refreshViews = useCallback(() => {
    if (!container || !rendition) {
      setViews([]);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const rawViews = getRenditionViews(rendition);
    const next = rawViews
      .flatMap((view, fallbackIndex): EpubViewInfo[] => {
        const element = getViewElement(view);
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return [];
        if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) return [];
        const sectionIndex = getSectionIndex(view, fallbackIndex);
        const href = getSectionHref(view);
        return [{
          key: `${sectionIndex}:${getSectionHref(view) ?? fallbackIndex}`,
          pageNumber: sectionIndex + 1,
          sectionIndex,
          left: rect.left - containerRect.left,
          top: rect.top - containerRect.top,
          width: rect.width,
          height: rect.height,
          ...(href ? { href } : {}),
        }];
      });
    setViews(next);
  }, [container, rendition]);

  useEffect(() => {
    refreshViews();
    if (!container || !rendition) return;
    const onRefresh = () => requestAnimationFrame(refreshViews);
    container.addEventListener("scroll", onRefresh, { passive: true });
    window.addEventListener("resize", onRefresh);
    (rendition as any).on?.("rendered", onRefresh);
    (rendition as any).on?.("relocated", onRefresh);
    return () => {
      container.removeEventListener("scroll", onRefresh);
      window.removeEventListener("resize", onRefresh);
      (rendition as any).off?.("rendered", onRefresh);
      (rendition as any).off?.("relocated", onRefresh);
    };
  }, [container, rendition, refreshViews]);

  useEffect(() => {
    const timer = setTimeout(refreshViews, 80);
    return () => clearTimeout(timer);
  }, [refreshKey, refreshViews]);

  const pagesKey = useMemo(() => views.map((view) => view.pageNumber).sort((a, b) => a - b).join(","), [views]);

  useEffect(() => {
    let dead = false;
    const pages = Array.from(new Set(views.map((view) => view.pageNumber)));
    if (pages.length === 0) {
      setAnnotationsByPage({});
      return;
    }
    invoke<Annotation[]>("get_annotations_for_pages", { documentId, pageNumbers: pages }).then((rows) => {
      if (!dead) {
        const next: Record<number, Annotation[]> = {};
        for (const row of rows.filter((a) => a.type === "ink")) {
          (next[row.page_number] ??= []).push(row);
        }
        setAnnotationsByPage(next);
      }
    }).catch(() => {
      if (!dead) setAnnotationsByPage({});
    });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, pagesKey, refreshKey]);

  return (
    <div
      className="epub-ink-layer"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      {views.map((view) => (
        <div
          key={view.key}
          style={{
            position: "absolute",
            left: view.left,
            top: view.top,
            width: view.width,
            height: view.height,
            pointerEvents: "none",
          }}
        >
          <InkCanvasOverlay
            documentId={documentId}
            pageNumber={view.pageNumber}
            width={view.width}
            height={view.height}
            annotations={annotationsByPage[view.pageNumber] ?? []}
            toolState={toolState}
            space="epub-section"
            sectionIndex={view.sectionIndex}
            href={view.href}
            onChanged={onChanged}
          />
        </div>
      ))}
    </div>
  );
}

function getRenditionViews(rendition: Rendition): any[] {
  const source = (rendition as any).views?.();
  if (Array.isArray(source)) return source;
  if (Array.isArray(source?.displayed?.())) return source.displayed();
  if (Array.isArray(source?.all?.())) return source.all();
  if (Array.isArray((rendition as any).manager?.views?._views)) return (rendition as any).manager.views._views;
  return [];
}

function getViewElement(view: any): HTMLElement | null {
  return view?.iframe ?? view?.element?.querySelector?.("iframe") ?? view?.element ?? null;
}

function getSectionIndex(view: any, fallbackIndex: number): number {
  const index = view?.section?.index ?? view?.index;
  return typeof index === "number" && Number.isFinite(index) ? index : fallbackIndex;
}

function getSectionHref(view: any): string | undefined {
  const href = view?.section?.href ?? view?.href;
  return typeof href === "string" ? href : undefined;
}
