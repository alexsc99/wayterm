import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

interface VirtualRowsOptions {
  /** Vertical gap between rows (e.g. 4 for Tailwind `space-y-1`). */
  rowGap?: number;
  /** Initial row height guess; replaced by the measured height of a `[data-vrow]` element. */
  estimatedRowHeight?: number;
  /** Extra rows rendered above and below the viewport. */
  overscan?: number;
  /** Lists with at most this many rows render completely. */
  threshold?: number;
}

export interface VirtualRows {
  containerRef: RefObject<HTMLDivElement>;
  /** Undefined while the list renders completely (avoids re-renders on scroll). */
  onScroll: (() => void) | undefined;
  /** Render `items.slice(start, end)`. */
  start: number;
  end: number;
  /** Spacer heights; render a spacer only when > 0 (keeps `space-y-*` margins aligned). */
  padTop: number;
  padBottom: number;
}

/**
 * Fixed-row-height windowing for a scroll container whose rows are direct children
 * separated by `rowGap` (margin-based spacing such as `space-y-*`).
 */
export function useVirtualRows(count: number, options: VirtualRowsOptions = {}): VirtualRows {
  const { rowGap = 0, estimatedRowHeight = 28, overscan = 12, threshold = 200 } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(estimatedRowHeight);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [topIndex, setTopIndex] = useState(0);
  const enabled = count > threshold;
  const stride = rowHeight + rowGap;

  const syncScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setTopIndex(Math.floor(el.scrollTop / stride));
  }, [stride]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Browser clamps scrollTop when the list shrinks; re-read it on content changes.
  useLayoutEffect(() => {
    if (enabled) syncScroll();
  }, [count, enabled, syncScroll]);

  // Measure the real row height once rows are laid out (0 while the tab is hidden).
  useLayoutEffect(() => {
    if (!enabled) return;
    const row = containerRef.current?.querySelector<HTMLElement>('[data-vrow]');
    const measured = row?.offsetHeight ?? 0;
    if (measured > 0 && measured !== rowHeight) setRowHeight(measured);
  });

  if (!enabled) {
    return { containerRef, onScroll: undefined, start: 0, end: count, padTop: 0, padBottom: 0 };
  }

  const visibleRows = Math.ceil(viewportHeight / stride) + 1;
  const start = Math.max(0, Math.min(topIndex, count - 1) - overscan);
  const end = Math.min(count, topIndex + visibleRows + overscan);
  // Each rendered row after a spacer receives the gap as top margin; subtract it from spacers.
  const padTop = start > 0 ? start * stride - rowGap : 0;
  const padBottom = end < count ? (count - end) * stride - rowGap : 0;

  return { containerRef, onScroll: syncScroll, start, end, padTop, padBottom };
}
