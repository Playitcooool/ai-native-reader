import { useEffect, useMemo, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { resolvePdfDestinationPage } from "../toc/tocTree";

const PDF_LINK_ANNOTATION = 2;

type LinkAnnotation = {
  annotationType: number;
  rect?: number[];
  url?: string;
  dest?: unknown;
};

type LinkAnnotationWithBox = LinkAnnotation & { box: React.CSSProperties };

type LinkViewport = {
  convertToViewportRectangle(rect: number[]): number[];
};

interface PdfLinkLayerProps {
  pdf: PDFDocumentProxy;
  page: PDFPageProxy;
  scale: number;
  onGoToPage: (page: number) => void;
  onOpenExternalUrl: (url: string) => void;
}

export default function PdfLinkLayer({ pdf, page, scale, onGoToPage, onOpenExternalUrl }: PdfLinkLayerProps) {
  const [annotations, setAnnotations] = useState<LinkAnnotation[]>([]);
  const links = useMemo(
    () => buildLinkBoxes(annotations, page.getViewport({ scale })),
    [annotations, page, scale],
  );

  useEffect(() => {
    let dead = false;
    page.getAnnotations({ intent: "display" }).then((annotations) => {
      if (dead) return;
      setAnnotations(annotations as LinkAnnotation[]);
    }).catch(() => {
      if (!dead) setAnnotations([]);
    });
    return () => { dead = true; };
  }, [page]);

  if (links.length === 0) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {links.map((link, index) => (
        <button
          key={index}
          type="button"
          aria-label="Open document link"
          onClick={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (link.url) {
              onOpenExternalUrl(link.url);
              return;
            }
            const pageNumber = await resolvePdfDestinationPage(pdf, link.dest);
            if (pageNumber) onGoToPage(pageNumber);
          }}
          style={{
            position: "absolute",
            ...link.box,
            padding: 0,
            border: 0,
            background: "transparent",
            cursor: "pointer",
            pointerEvents: "auto",
          }}
        />
      ))}
    </div>
  );
}

export function buildLinkBoxes(annotations: LinkAnnotation[], viewport: LinkViewport): LinkAnnotationWithBox[] {
  return annotations
    .filter((annotation) => annotation.annotationType === PDF_LINK_ANNOTATION && annotation.rect)
    .map((annotation) => {
      const rect = viewport.convertToViewportRectangle(annotation.rect!);
      const left = Math.min(rect[0], rect[2]);
      const top = Math.min(rect[1], rect[3]);
      return {
        ...annotation,
        box: {
          left,
          top,
          width: Math.abs(rect[0] - rect[2]),
          height: Math.abs(rect[1] - rect[3]),
        },
      };
    });
}
