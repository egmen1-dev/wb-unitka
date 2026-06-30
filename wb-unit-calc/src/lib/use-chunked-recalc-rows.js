import { useEffect, useRef, useState, startTransition } from 'react';

/** Catalogs at or below this size recalc in one transition (fast enough). */
const SYNC_RECALC_LIMIT = 400;
/** Rows processed per idle slice for large catalogs. */
const CHUNK_SIZE = 256;
/** First slice runs synchronously so the table can paint immediately. */
const INITIAL_SYNC_CHUNK = 200;

function shellRows(baseRows) {
  return baseRows.map((row) => ({ ...row }));
}

function scheduleIdle(fn) {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(fn, { timeout: 48 });
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

function bootstrapLargeCatalog(recalcFn, baseRows, purchases, settings, productOverrides) {
  const out = shellRows(baseRows);
  const firstEnd = Math.min(INITIAL_SYNC_CHUNK, baseRows.length);
  recalcFn(baseRows, purchases, settings, productOverrides, {
    out,
    start: 0,
    end: firstEnd,
    finalize: false,
  });
  return { out, index: firstEnd };
}

/**
 * Recalculate unit-economics rows without blocking the main thread on large catalogs.
 * Publishes shell rows immediately, then patches calculated fields chunk by chunk.
 */
export function useChunkedRecalcRows(recalcFn, baseRows, purchases, settings, productOverrides) {
  const [state, setState] = useState(() => {
    if (!baseRows.length) {
      return { rows: [], computed: 0 };
    }
    if (baseRows.length <= SYNC_RECALC_LIMIT) {
      return {
        rows: recalcFn(baseRows, purchases, settings, productOverrides),
        computed: baseRows.length,
      };
    }
    const { out, index } = bootstrapLargeCatalog(
      recalcFn,
      baseRows,
      purchases,
      settings,
      productOverrides
    );
    return { rows: out, computed: index };
  });
  const runRef = useRef(0);

  useEffect(() => {
    const runId = ++runRef.current;

    if (!baseRows.length) {
      setState({ rows: [], computed: 0 });
      return undefined;
    }

    if (baseRows.length <= SYNC_RECALC_LIMIT) {
      startTransition(() => {
        if (runId !== runRef.current) return;
        setState({
          rows: recalcFn(baseRows, purchases, settings, productOverrides),
          computed: baseRows.length,
        });
      });
      return undefined;
    }

    let cancelled = false;
    let idleId = null;
    const { out, index: startIndex } = bootstrapLargeCatalog(
      recalcFn,
      baseRows,
      purchases,
      settings,
      productOverrides
    );
    let index = startIndex;

    setState({ rows: out, computed: index });

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

      startTransition(() => {
        if (runId !== runRef.current) return;
        setState({ rows: out, computed: index });
      });

      if (index < baseRows.length) {
        idleId = scheduleIdle(step);
      }
    };

    if (index < baseRows.length) {
      idleId = scheduleIdle(step);
    }

    return () => {
      cancelled = true;
      if (idleId != null) cancelIdle(idleId);
    };
  }, [recalcFn, baseRows, purchases, settings, productOverrides]);

  const recalcPending = baseRows.length > 0 && state.computed < baseRows.length;
  const recalcProgress =
    baseRows.length > 0 ? Math.min(100, Math.round((state.computed / baseRows.length) * 100)) : 100;

  return { rows: state.rows, recalcPending, recalcProgress };
}
