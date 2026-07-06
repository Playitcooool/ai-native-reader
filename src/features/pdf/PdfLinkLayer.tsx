import { useEffect, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { resolvePdfDestinationPage } from "../toc/tocTree";

const PDF_LINK_ANNOTATION = 2;

type LinkAnnotation = {
  annotationType: number;
  rect?: number[];
  url?: string;
  dest?: unknown;
};

interface PdfLinkLayerProps {
  pdf: PDFDocumentProxy;
  page: PDFPageProxy;
  scale: number;
  onGoToPage: (page: number) => void;
  onOpenExternalUrl: (url: string) => void;
}

export default function PdfLinkLayer({ pdf, page, scale, onGoToPage, onOpenExternalUrl }: PdfLinkLayerProps) {
  const [links, setLinks] = useState<Array<LinkAnnotation & { box: React.CSSProperties }>>([]);

  useEffect(() => {
    let dead = false;
    page.getAnnotations({ intent: "display" }).then((annotations) => {
      if (dead) return;
      const viewport = page.getViewport({ scale });
      const next = (annotations as LinkAnnotation[])
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
      setLinks(next);
    }).catch(() => {
      if (!dead) setLinks([]);
    });
    return () => { dead = true; };
  }, [page, scale]);

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
