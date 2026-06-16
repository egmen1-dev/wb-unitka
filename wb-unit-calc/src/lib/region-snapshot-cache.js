const KEY = 'wb-unit-calc:region-snapshot-prev';

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota — ignore
  }
}

function serializeRegions(snapshot) {
  return (snapshot?.byRegion || []).map((r) => ({
    label: r.label || r.regionName,
    qty: r.qty || 0,
    sharePct: r.sharePct || 0,
  }));
}

function computeRegionDeltas(prevRegions = [], currentRegions = []) {
  const prevMap = new Map(prevRegions.map((r) => [r.label, r.qty || 0]));
  const deltas = [];

  for (const region of currentRegions) {
    const label = region.label;
    const currentQty = region.qty || 0;
    const prevQty = prevMap.get(label) ?? 0;
    if (prevQty === currentQty) continue;
    const deltaPct = prevQty > 0 ? ((currentQty - prevQty) / prevQty) * 100 : currentQty > 0 ? 100 : 0;
    deltas.push({
      label,
      prevQty,
      currentQty,
      deltaQty: currentQty - prevQty,
      deltaPct: Math.round(deltaPct * 10) / 10,
    });
  }

  return deltas.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct)).slice(0, 8);
}

/** Сравнить с предыдущим снимком в localStorage; обновить кэш при новом hash. */
export function updateRegionSnapshotCache(currentHash, snapshot, syncedAt = '') {
  if (!currentHash || !snapshot?.byRegion?.length) {
    return { previous: null, deltas: [], previousSyncedAt: null };
  }

  const prev = readJson(KEY, null);
  const currentByRegion = serializeRegions(snapshot);

  if (prev?.hash === currentHash) {
    return { previous: prev, deltas: [], previousSyncedAt: prev.syncedAt || null };
  }

  const deltas = prev?.byRegion?.length ? computeRegionDeltas(prev.byRegion, currentByRegion) : [];

  writeJson(KEY, {
    hash: currentHash,
    syncedAt: syncedAt || new Date().toISOString(),
    totalQty: snapshot.totalQty || 0,
    byRegion: currentByRegion,
  });

  return {
    previous: prev,
    deltas,
    previousSyncedAt: prev?.syncedAt || null,
  };
}
