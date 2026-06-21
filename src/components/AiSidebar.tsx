import { useCallback, useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../stores/documentStore";
import { useAiStore } from "../stores/aiStore";
import ReactMarkdown from "react-markdown";
import { useReaderStore } from "../stores/readerStore";

export default function AiSidebar() {
  const { currentDocument, currentPage } = useDocumentStore();
  const { messages, isGenerating, runWorkflow } = useAiStore();
  const { selectedText } = useReaderStore();
  const [input, setInput] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Load existing session messages when document changes
  useEffect(() => {
    // Simple approach: clear messages when document changes
    // Session loading will be done on demand
  }, [currentDocument?.id]);

  const handleExplain = useCallback(async () => {
    if (!currentDocument || !selectedText) return;
    await runWorkflow({
      documentId: currentDocument.id,
      documentTitle: currentDocument.title ?? undefined,
      mode: "selection_explain",
      pageNumber: currentPage,
      selectedText,
    });
  }, [currentDocument, selectedText, currentPage, runWorkflow]);

  const handleSummarizePage = useCallback(async () => {
    if (!currentDocument) return;
    await runWorkflow({
      documentId: currentDocument.id,
      documentTitle: currentDocument.title ?? undefined,
      mode: "page_summary",
      pageNumber: currentPage,
    });
  }, [currentDocument, currentPage, runWorkflow]);

  const handleSummarizeRange = useCallback(async () => {
    if (!currentDocument || !rangeStart || !rangeEnd) return;
    await runWorkflow({
      documentId: currentDocument.id,
      documentTitle: currentDocument.title ?? undefined,
      mode: "range_summary",
      pageNumber: currentPage,
      startPage: parseInt(rangeStart),
      endPage: parseInt(rangeEnd),
    });
  }, [currentDocument, currentPage, rangeStart, rangeEnd, runWorkflow]);

  const handleAskQuestion = useCallback(async () => {
    if (!currentDocument || !input.trim()) return;
    const question = input.trim();
    setInput("");
    await runWorkflow({
      documentId: currentDocument.id,
      documentTitle: currentDocument.title ?? undefined,
      mode: "chapter_qa",
      pageNumber: currentPage,
      question,
    });
  }, [currentDocument, currentPage, input, runWorkflow]);

  if (!currentDocument) {
    return (
      <div className="sidebar-right">
        <div className="ai-header">AI Assistant</div>
        <div className="ai-content">
          <p>
            Open a PDF to start reading with AI assistance.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar-right">
      <div className="ai-header">AI Assistant</div>

      {/* Quick actions */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border-color)",
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
        }}
      >
        <button
          onClick={handleSummarizePage}
          disabled={isGenerating}
          style={{
            padding: "4px 10px",
            background: isGenerating ? "var(--bg-tertiary)" : "var(--accent-color)",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 500,
            cursor: isGenerating ? "default" : "pointer",
          }}
        >
          Summarize Page
        </button>
        {selectedText && (
          <button
            onClick={handleExplain}
            disabled={isGenerating}
            style={{
              padding: "4px 10px",
              background: "var(--success-color)",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Explain Selection
          </button>
        )}
      </div>

      {/* Page range input */}
      <div
        style={{
          padding: "6px 12px",
          borderBottom: "1px solid var(--border-color)",
          display: "flex",
          gap: 4,
          alignItems: "center",
          fontSize: 12,
        }}
      >
        <span>Range:</span>
        <input
          type="number"
          value={rangeStart}
          onChange={(e) => setRangeStart(e.target.value)}
          placeholder="From"
          style={{ width: 50, padding: "2px 4px", border: "1px solid var(--border-color)", borderRadius: 3, fontSize: 12 }}
        />
        <span>–</span>
        <input
          type="number"
          value={rangeEnd}
          onChange={(e) => setRangeEnd(e.target.value)}
          placeholder="To"
          style={{ width: 50, padding: "2px 4px", border: "1px solid var(--border-color)", borderRadius: 3, fontSize: 12 }}
        />
        <button
          onClick={handleSummarizeRange}
          disabled={isGenerating || !rangeStart || !rangeEnd}
          style={{
            padding: "3px 8px",
            background: "var(--accent-color)",
            color: "#fff",
            border: "none",
            borderRadius: 3,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Go
        </button>
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: 13,
              marginTop: 24,
            }}
          >
            <p>AI answers will appear here.</p>
            <p style={{ marginTop: 4, fontSize: 12 }}>
              Select text and press <strong>E</strong> to explain, or click
              Summarize Page.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              background:
                msg.role === "user"
                  ? "var(--bg-secondary)"
                  : "var(--bg-primary)",
              border: "1px solid var(--border-color)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-muted)",
                marginBottom: 4,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {msg.role === "user" ? "You" : "AI"}
            </div>
            {msg.role === "assistant" ? (
              <div className="markdown-content">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            ) : (
              <div>{msg.content}</div>
            )}
            {msg.context_snapshot_json && (
              <details style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
                <summary style={{ cursor: "pointer" }}>Context snapshot</summary>
                <pre style={{ marginTop: 4, padding: 4, background: "var(--bg-tertiary)", borderRadius: 3, maxHeight: 200, overflow: "auto", fontSize: 10 }}>
                  {JSON.stringify(JSON.parse(msg.context_snapshot_json), null, 2)}
                </pre>
              </details>
            )}
          </div>
        ))}
        {isGenerating && (
          <div
            style={{
              padding: "12px",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: 13,
            }}
          >
            Thinking...
          </div>
        )}
      </div>

      {/* Composer */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid var(--border-color)",
          display: "flex",
          gap: 6,
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleAskQuestion();
            }
          }}
          placeholder="Ask about this page..."
          disabled={isGenerating}
          style={{
            flex: 1,
            padding: "6px 8px",
            border: "1px solid var(--border-color)",
            borderRadius: 4,
            fontSize: 13,
          }}
        />
        <button
          onClick={handleAskQuestion}
          disabled={isGenerating || !input.trim()}
          style={{
            padding: "6px 12px",
            background: "var(--accent-color)",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Ask
        </button>
      </div>
    </div>
  );
}
