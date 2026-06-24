import { useEffect, useRef, useState, startTransition } from 'react';

/** Catalogs at or below this size recalc in one transition (fast enough). */
const SYNC_RECALC_LIMIT = 280;
/** Rows processed per idle slice for large catalogs. */
const CHUNK_SIZE = 96;

function scheduleIdle(fn) {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(fn, { timeout: 64 });
  }
  return setTimeout(fn, 0);
}

function cancelIdle(id) {
  if (typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(id);
  } else {
    clearTimeout(id);
  }
}

/**
 * Recalculate unit-economics rows without blocking the main thread on large catalogs.
 * Keeps the previous rows visible until the next full pass completes.
 */
export function useChunkedRecalcRows(recalcFn, baseRows, purchases, settings, productOverrides) {
  const [rows, setRows] = useState(() => {
    if (!baseRows.length) return [];
    if (baseRows.length > SYNC_RECALC_LIMIT) return [];
    return recalcFn(baseRows, purchases, settings, productOverrides);
  });
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const runRef = useRef(0);

  useEffect(() => {
    const runId = ++runRef.current;

    if (!baseRows.length) {
      setRows([]);
      return undefined;
    }

    if (baseRows.length <= SYNC_RECALC_LIMIT) {
      startTransition(() => {
        if (runId !== runRef.current) return;
        setRows(recalcFn(baseRows, purchases, settings, productOverrides));
      });
      return undefined;
    }

    let cancelled = false;
    let idleId = null;
    const out = new Array(baseRows.length);
    let index = 0;

    const step = () => {
      if (cancelled || runId !== runRef.current) return;

      const end = Math.min(index + CHUNK_SIZE, baseRows.length);
      recalcFn(baseRows, purchases, settings, productOverrides, {
        out,
        start: index,
        end,
        finalize: end >= baseRows.length,
      });
      index = end;

      if (index < baseRows.length) {
        idleId = scheduleIdle(step);
        return;
      }

      startTransition(() => {
        if (runId !== runRef.current) return;
        setRows(out);
      });
    };

    idleId = scheduleIdle(step);

    return () => {
      cancelled = true;
      if (idleId != null) cancelIdle(idleId);
    };
  }, [recalcFn, baseRows, purchases, settings, productOverrides]);

  const recalcPending = baseRows.length > 0 && rows.length !== baseRows.length;
  return { rows, recalcPending };
}
