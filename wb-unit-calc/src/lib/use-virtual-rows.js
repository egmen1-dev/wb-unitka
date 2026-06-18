import { useEffect, useState } from 'react';

const ROW_HEIGHT = 38;
const OVERSCAN = 10;
const VIRTUALIZE_MIN = 48;

/** Рендер только видимых строк большой таблицы. */
export function useVirtualRows(containerRef, rowCount, resetKey = '') {
  const [range, setRange] = useState({ start: 0, end: 40 });

  useEffect(() => {
    if (rowCount < VIRTUALIZE_MIN) {
      setRange({ start: 0, end: rowCount });
      return undefined;
    }

    const el = containerRef.current;
    if (!el) return undefined;

    el.scrollTop = 0;

    const update = () => {
      const visible = Math.ceil(el.clientHeight / ROW_HEIGHT) + OVERSCAN * 2;
      const rawStart = Math.max(0, Math.floor(el.scrollTop / ROW_HEIGHT) - OVERSCAN);
      const maxStart = Math.max(0, rowCount - visible);
      const start = Math.min(rawStart, maxStart);
      const end = Math.min(rowCount, start + visible);
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(el);

    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [containerRef, rowCount, resetKey]);

  const virtualized = rowCount >= VIRTUALIZE_MIN;
  const safeStart = rowCount === 0 ? 0 : Math.min(range.start, Math.max(0, rowCount - 1));
  const safeEnd = Math.max(safeStart, Math.min(range.end, rowCount));
  const paddingTop = virtualized ? safeStart * ROW_HEIGHT : 0;
  const paddingBottom = virtualized ? Math.max(0, (rowCount - safeEnd) * ROW_HEIGHT) : 0;

  return {
    virtualized,
    start: safeStart,
    end: safeEnd,
    paddingTop,
    paddingBottom,
  };
}
