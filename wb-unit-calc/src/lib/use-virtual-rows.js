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

    const update = () => {
      const start = Math.max(0, Math.floor(el.scrollTop / ROW_HEIGHT) - OVERSCAN);
      const visible = Math.ceil(el.clientHeight / ROW_HEIGHT) + OVERSCAN * 2;
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
  const paddingTop = virtualized ? range.start * ROW_HEIGHT : 0;
  const paddingBottom = virtualized ? Math.max(0, (rowCount - range.end) * ROW_HEIGHT) : 0;

  return {
    virtualized,
    start: range.start,
    end: range.end,
    paddingTop,
    paddingBottom,
  };
}
