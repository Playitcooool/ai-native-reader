import { useEffect, useMemo, useRef, useState } from "react";

export interface UseVisibleRangeOptions {
  pageCount: number;
  pageHeights: number[];
  bufferPages: number;
  scrollContainerRef: React.RefObject<HTMLElement | null>;
}

export interface UseVisibleRangeResult {
  visibleRange: [number, number];
  totalHeight: number;
  visibleTop: number;
  pageTops: number[];
}

export function useVisibleRange({
  pageCount,
  pageHeights,
  bufferPages,
  scrollContainerRef,
}: UseVisibleRangeOptions): UseVisibleRangeResult {
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const rafRef = useRef<number | null>(null);

  const pageTops = useMemo(
    () => buildCumulativeOffsets(pageHeights, pageCount),
    [pageHeights, pageCount],
  );

  const totalHeight = getTotalHeight(pageTops, pageHeights, pageCount);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        compute();
      });
    };

    const handleResize = () => {
      compute();
    };

    const compute = () => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const { scrollTop, clientHeight } = el;
      if (pageTops.length === 0) return;

      const next = computeVisibleRange(scrollTop, clientHeight, pageHeights, pageTops, pageCount, bufferPages);
      setRange((prev) => prev[0] === next[0] && prev[1] === next[1] ? prev : next);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    // Initial compute
    compute();

    return () => {
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [pageCount, pageHeights, pageTops, bufferPages, scrollContainerRef]);

  return {
    visibleRange: range,
    totalHeight,
    visibleTop: range[0] > 0 ? (pageTops[range[0]] ?? 0) : 0,
    pageTops,
  };
}

export function buildCumulativeOffsets(heights: number[], count: number): number[] {
  const offsets: number[] = new Array(count);
  let acc = 0;
  for (let i = 0; i < count; i++) {
    offsets[i] = acc;
    acc += heights[i] ?? 0;
  }
  return offsets;
}

export function getTotalHeight(offsets: number[], heights: number[], count: number): number {
  return count > 0 ? (offsets[count - 1] ?? 0) + (heights[count - 1] ?? 0) : 0;
}

export function findPageIndexAtOffset(offsets: number[], scrollTop: number): number {
  let lo = 0, hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= scrollTop) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function computeVisibleRange(
  scrollTop: number,
  clientHeight: number,
  pageHeights: number[],
  pageTops: number[],
  pageCount: number,
  bufferPages: number,
): [number, number] {
  if (pageCount === 0 || pageTops.length === 0) return [0, 0];
  const firstIdx = findPageIndexAtOffset(pageTops, scrollTop);
  const bottom = scrollTop + clientHeight;
  let lastIdx = firstIdx;
  while (lastIdx < pageHeights.length - 1 && (pageTops[lastIdx + 1] ?? 0) < bottom) {
    lastIdx++;
  }
  return [
    Math.max(0, firstIdx - bufferPages),
    Math.min(pageCount - 1, lastIdx + bufferPages),
  ];
}
