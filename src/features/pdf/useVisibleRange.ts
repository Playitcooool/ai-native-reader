import { useEffect, useRef, useState } from "react";

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
}

export function useVisibleRange({
  pageCount,
  pageHeights,
  bufferPages,
  scrollContainerRef,
}: UseVisibleRangeOptions): UseVisibleRangeResult {
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const rafRef = useRef<number | null>(null);

  // Build cumulative offsets
  const cumulativeOffsets = useRef<number[]>([]);
  cumulativeOffsets.current = buildCumulativeOffsets(pageHeights, pageCount);

  const totalHeight = pageCount > 0
    ? (cumulativeOffsets.current[pageCount - 1] ?? 0) + (pageHeights[pageCount - 1] ?? 0)
    : 0;

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
      const offsets = cumulativeOffsets.current;
      if (offsets.length === 0) return;

      // Binary search: first page whose offset is > scrollTop
      let lo = 0, hi = offsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= scrollTop) lo = mid;
        else hi = mid - 1;
      }
      const firstIdx = lo;

      // Walk forward to find last visible page
      const bottom = scrollTop + clientHeight;
      let lastIdx = firstIdx;
      while (lastIdx < pageHeights.length - 1 && (cumulativeOffsets.current[lastIdx + 1] ?? 0) < bottom) {
        lastIdx++;
      }

      const start = Math.max(0, firstIdx - bufferPages);
      const end = Math.min(pageCount - 1, lastIdx + bufferPages);
      setRange([start, end]);
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
  }, [pageCount, pageHeights, bufferPages, scrollContainerRef]);

  return {
    visibleRange: range,
    totalHeight,
    visibleTop: range[0] > 0 ? (cumulativeOffsets.current[range[0]] ?? 0) : 0,
  };
}

function buildCumulativeOffsets(heights: number[], count: number): number[] {
  const offsets: number[] = new Array(count);
  let acc = 0;
  for (let i = 0; i < count; i++) {
    offsets[i] = acc;
    acc += heights[i] ?? 0;
  }
  return offsets;
}
