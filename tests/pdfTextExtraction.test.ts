import { describe, expect, it, vi } from "vitest";
import {
  ensureDocumentTextReady,
  ensurePagesTextReady,
  extractPageText,
  normalizeExtractedText,
  PageExtractionQueue,
} from "../src/features/pdf/pdfTextExtraction";

describe("normalizeExtractedText", () => {
  it("cleans common PDF line wrap artifacts", () => {
    expect(normalizeExtractedText("concentra-\ntion   inequality \nnext")).toBe("concentration inequality\nnext");
  });
});

function fakePdf(textByPage: Record<number, string>) {
  return {
    getPage: vi.fn(async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: textByPage[pageNumber]
          ? [{ str: textByPage[pageNumber], transform: [1, 0, 0, 1, 0, 0] }]
          : [],
      }),
      cleanup: vi.fn(),
    })),
  };
}

function mockInvoke(initialReady: Record<number, string> = {}) {
  const saved = new Map<number, string>(Object.entries(initialReady).map(([page, text]) => [Number(page), text]));
  const invoke = vi.fn(async (command: string, args: any) => {
    if (command === "get_page_text") {
      const text = saved.get(args.pageNumber);
      return text ? { text, text_status: "ready", char_count: text.length } : null;
    }
    if (command === "save_pages_text") {
      for (const page of args.pages) saved.set(page.pageNumber, page.text);
      return null;
    }
    if (command === "get_pages_text_coverage") {
      const rows = [];
      for (let page = args.startPage; page <= args.endPage; page++) {
        const text = saved.get(page) ?? "";
        rows.push({
          page_number: page,
          text_status: text ? "ready" : "missing",
          char_count: text.length,
        });
      }
      return rows;
    }
    throw new Error(`unexpected command ${command}`);
  });
  return { invoke, saved };
}

describe("ensurePagesTextReady", () => {
  it("uses native PDF text without OCR", async () => {
    const { invoke } = mockInvoke();
    const ocrPage = vi.fn();

    const result = await ensurePagesTextReady("doc", [2], {
      pdf: fakePdf({ 2: "native text" }),
      invoke: invoke as any,
      ocrPage,
    });

    expect(result).toEqual({ ready: 1, failed: 0, readyPages: [2], failedPages: [] });
    expect(ocrPage).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("save_pages_text", {
      documentId: "doc",
      pages: [{ pageNumber: 2, text: "native text" }],
    });
  });

  it("OCRs pages with blank native text", async () => {
    const { invoke, saved } = mockInvoke();
    const ocrPage = vi.fn(async (_documentId: string, pageNumber: number) => {
      saved.set(pageNumber, "ocr text");
      return "ready" as const;
    });

    const result = await ensurePagesTextReady("doc", [3], {
      pdf: fakePdf({ 3: "" }),
      invoke: invoke as any,
      ocrPage,
    });

    expect(result).toEqual({ ready: 1, failed: 0, readyPages: [3], failedPages: [] });
    expect(ocrPage).toHaveBeenCalledOnce();
  });

  it("current-page flow touches one page", async () => {
    const { invoke } = mockInvoke();
    const pdf = fakePdf({ 5: "page five" });

    await ensurePagesTextReady("doc", [5], { pdf, invoke: invoke as any });

    expect(pdf.getPage).toHaveBeenCalledWith(5);
    expect(pdf.getPage).toHaveBeenCalledTimes(1);
  });

  it("range flow touches only the requested range", async () => {
    const { invoke } = mockInvoke();
    const pdf = fakePdf({ 2: "two", 3: "three", 4: "four" });

    await ensurePagesTextReady("doc", [2, 3, 4], { pdf, invoke: invoke as any });

    expect(pdf.getPage.mock.calls.map(([page]: [number]) => page)).toEqual([2, 3, 4]);
  });

  it("uses batched coverage and skips ready pages", async () => {
    const { invoke } = mockInvoke({ 2: "already indexed" });
    const pdf = fakePdf({ 3: "three" });

    await ensurePagesTextReady("doc", [2, 3], { pdf, invoke: invoke as any });

    expect(invoke).not.toHaveBeenCalledWith("get_page_text", expect.anything());
    expect(invoke).toHaveBeenCalledWith("get_pages_text_coverage", {
      documentId: "doc",
      startPage: 2,
      endPage: 3,
    });
    expect(pdf.getPage).toHaveBeenCalledTimes(1);
    expect(pdf.getPage).toHaveBeenCalledWith(3);
  });

  it("reports exact failed pages", async () => {
    const { invoke } = mockInvoke();
    const pdf = fakePdf({ 20: "twenty", 21: "" });

    const result = await ensurePagesTextReady("doc", [20, 21], {
      pdf,
      invoke: invoke as any,
      ocrPage: vi.fn(async () => "empty" as const),
    });

    expect(result).toEqual({ ready: 1, failed: 1, readyPages: [20], failedPages: [21] });
  });

  it("document search readiness requests all pages", async () => {
    const { invoke } = mockInvoke();
    const pdf = fakePdf({ 1: "one", 2: "two", 3: "three" });

    await ensureDocumentTextReady("doc", 3, { pdf, invoke: invoke as any });

    expect(pdf.getPage.mock.calls.map(([page]: [number]) => page)).toEqual([1, 2, 3]);
  });
});

describe("extractPageText", () => {
  it("cleans up the PDF.js page after extraction", async () => {
    const cleanup = vi.fn();
    const pdf = {
      getPage: vi.fn(async () => ({
        getTextContent: async () => ({ items: [{ str: "text", transform: [1, 0, 0, 1, 0, 0] }] }),
        cleanup,
      })),
    };

    await expect(extractPageText(pdf as any, 1)).resolves.toMatchObject({ text: "text", charCount: 4 });
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

describe("PageExtractionQueue", () => {
  it("extracts the current page before lower-priority neighbors", async () => {
    const pdf = fakePdf({ 1: "one", 2: "two", 3: "three", 4: "four", 5: "five" });
    const saved: Array<{ pageNumber: number; text: string }> = [];
    const queue = new PageExtractionQueue(
      pdf,
      "doc",
      async (_docId, pages) => { saved.push(...pages); },
      vi.fn(),
    );

    queue.setCurrentPage(3, 5);
    await vi.waitFor(() => expect(pdf.getPage).toHaveBeenCalledTimes(5));
    queue.flushPending();

    expect(saved.map((page) => page.pageNumber)).toEqual([3, 2, 4, 1, 5]);
    queue.destroy();
  });

  it("counts text, scanned, and failed pages as processed", async () => {
    const pdf = {
      getPage: vi.fn(async (pageNumber: number) => {
        if (pageNumber === 3) throw new Error("broken page");
        return {
          getTextContent: async () => ({
            items: pageNumber === 1 ? [{ str: "one", transform: [1, 0, 0, 1, 0, 0] }] : [],
          }),
          cleanup: vi.fn(),
        };
      }),
    };
    const progress = vi.fn();
    const queue = new PageExtractionQueue(pdf, "doc", vi.fn(async () => {}), vi.fn(async () => {}));
    queue.onProgress = progress;

    queue.enqueueAll(3);
    await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith({ processed: 3, indexed: 1, total: 3 }));
    queue.destroy();
  });
});
