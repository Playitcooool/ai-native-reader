import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { linkCitationMarkdown } from "../features/citations/citationParser";
import { isAllowedExternalUrl, openExternalUrl } from "../features/links/externalLinks";

interface AiMarkdownProps {
  children: string;
  onPageLink?: (pageNumber: number) => void;
  maxPage?: number | null;
}

export default function AiMarkdown({ children, onPageLink, maxPage }: AiMarkdownProps) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("ai-page://")) {
              const page = Number(href.slice("ai-page://".length));
              return (
                <a
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    if (Number.isFinite(page)) onPageLink?.(page);
                  }}
                >
                  {children}
                </a>
              );
            }
            if (!href || !isAllowedExternalUrl(href)) return <span>{children}</span>;
            return (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  openExternalUrl(href).catch(() => {});
                }}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {linkCitationMarkdown(children, maxPage)}
      </ReactMarkdown>
    </div>
  );
}
