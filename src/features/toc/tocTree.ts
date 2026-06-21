import { PDFDocumentProxy } from "pdfjs-dist";

export interface TocNodeInput {
  parent_id: string | null;
  title: string;
  level: number;
  order_index: number;
  start_page: number;
  end_page: number | null;
}

interface OutlineItem {
  title: string;
  dest?: unknown;
  items?: OutlineItem[];
}

// Resolve outline item to a page number
async function resolvePage(
  pdf: PDFDocumentProxy,
  item: OutlineItem,
): Promise<number | null> {
  if (!item.dest) return null;
  let dest = null;
  if (typeof item.dest === "string") {
    dest = await pdf.getDestination(item.dest);
  } else if (Array.isArray(item.dest)) {
    dest = item.dest;
  }
  if (!dest || !dest[0]) return null;
  try {
    const pageIndex = await pdf.getPageIndex(dest[0]);
    return pageIndex + 1;
  } catch {
    return null;
  }
}

// Flatten outline tree into ordered list with computed end pages
async function flattenOutline(
  pdf: PDFDocumentProxy,
  items: OutlineItem[],
  parentId: string | null = null,
  level: number = 0,
  orderCounter: { value: number } = { value: 0 },
): Promise<TocNodeInput[]> {
  const nodes: TocNodeInput[] = [];

  for (const item of items) {
    orderCounter.value++;
    const page = await resolvePage(pdf, item);
    if (page === null && (!item.items || item.items.length === 0)) continue;

    const nodeId = `toc_${orderCounter.value}`;
    nodes.push({
      parent_id: parentId,
      title: item.title,
      level,
      order_index: orderCounter.value,
      start_page: page ?? 1,
      end_page: null,
    });

    if (item.items && item.items.length > 0) {
      const children = await flattenOutline(
        pdf,
        item.items,
        nodeId,
        level + 1,
        orderCounter,
      );
      nodes.push(...children);
    }
  }

  return nodes;
}

// Compute end pages based on the next node of same or higher level
export function computeEndPages(
  nodes: TocNodeInput[],
  totalPages: number,
): TocNodeInput[] {
  // Build parent→children map
  const childrenOf = new Map<string | null, TocNodeInput[]>();
  for (const node of nodes) {
    const key = node.parent_id ?? "__root__";
    const list = childrenOf.get(key) ?? [];
    list.push(node);
    childrenOf.set(key, list);
  }

  const result = nodes.map((n) => ({ ...n }));

  for (let i = 0; i < result.length; i++) {
    const node = result[i];
    // Find next node at same or higher level
    let nextIdx = -1;
    for (let j = i + 1; j < result.length; j++) {
      if (result[j].level <= node.level) {
        nextIdx = j;
        break;
      }
    }
    node.end_page = nextIdx >= 0 ? result[nextIdx].start_page - 1 : totalPages;
  }

  return result;
}

// Extract, flatten, compute end pages, and return TOC nodes
export async function extractToc(
  pdf: PDFDocumentProxy,
  totalPages: number,
): Promise<TocNodeInput[]> {
  const outline = await pdf.getOutline();
  if (!outline || outline.length === 0) return [];

  const flat = await flattenOutline(pdf, outline as OutlineItem[]);
  if (flat.length === 0) return [];

  return computeEndPages(flat, totalPages);
}
