const KEYS = {
  profiles: 'wb-unit-calc:profiles',
  activeProfileId: 'wb-unit-calc:active-profile',
  purchases: 'wb-unit-calc:purchases',
  settings: 'wb-unit-calc:settings',
  supplierCatalogs: 'wb-unit-calc:supplier-catalogs',
  productOverrides: 'wb-unit-calc:product-overrides',
  wbProductCache: 'wb-unit-calc:wb-product-cache',
};

function workspaceCacheKey(teamCode) {
  return `wb-unit-calc:workspace:${String(teamCode || '').trim().toUpperCase()}`;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadProfiles() {
  return readJson(KEYS.profiles, []);
}

export function saveProfiles(profiles) {
  writeJson(KEYS.profiles, profiles);
}

export function loadActiveProfileId() {
  return localStorage.getItem(KEYS.activeProfileId) || '';
}

export function saveActiveProfileId(id) {
  if (id) localStorage.setItem(KEYS.activeProfileId, id);
  else localStorage.removeItem(KEYS.activeProfileId);
}

export function loadPurchases() {
  return readJson(KEYS.purchases, {});
}

export function savePurchases(purchases) {
  writeJson(KEYS.purchases, purchases);
}

export function loadSettings() {
  return readJson(KEYS.settings, null);
}

export function saveSettings(settings) {
  writeJson(KEYS.settings, settings);
}

export function loadSupplierCatalogs() {
  return readJson(KEYS.supplierCatalogs, { activeId: null, items: [] });
}

export function saveSupplierCatalogs(state) {
  writeJson(KEYS.supplierCatalogs, state);
}

export function loadProductOverrides() {
  return readJson(KEYS.productOverrides, {});
}

export function saveProductOverrides(overrides) {
  writeJson(KEYS.productOverrides, overrides);
}

export function loadWbProductCache() {
  return readJson(KEYS.wbProductCache, null);
}

export function saveWbProductCache(cache) {
  if (!cache?.products?.length) {
    localStorage.removeItem(KEYS.wbProductCache);
    return;
  }
  const run = () => {
    try {
      writeJson(KEYS.wbProductCache, cache);
    } catch {
      // quota exceeded — не блокируем UI
    }
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 8000 });
  } else {
    setTimeout(run, 0);
  }
}
export function createProfileId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Локальный boot-кэш без тяжёлого productCache (карточки восстанавливаются из rows). */
function slimPayloadForLocalCache(payload) {
  if (!payload) return payload;
  const cache = payload.cache;
  if (!cache) return payload;
  const wb = cache.wbProductCache;
  const liteWb =
    wb?.tariffCache || wb?.realizationSnapshot
      ? {
          tariffCache: wb.tariffCache || null,
          realizationSnapshot: wb.realizationSnapshot || null,
        }
      : null;
  return {
    ...payload,
    cache: {
      rows: cache.rows,
      meta: cache.meta,
      syncedAt: cache.syncedAt,
      wbProductCache: liteWb,
    },
  };
}

/** Локальный снимок облака команды — мгновенный старт после F5. */
export function loadWorkspaceCache(teamCode) {
  const code = String(teamCode || '').trim().toUpperCase();
  if (!code) return null;
  const raw = readJson(workspaceCacheKey(code), null);
  if (!raw?.payload) return raw;
  return {
    ...raw,
    payload: slimPayloadForLocalCache(raw.payload),
  };
}

export function saveWorkspaceCache(teamCode, snapshot) {
  const code = String(teamCode || '').trim().toUpperCase();
  if (!code || !snapshot?.payload) return;
  try {
    writeJson(workspaceCacheKey(code), {
      payload: slimPayloadForLocalCache(snapshot.payload),
      updatedAt: snapshot.updatedAt || '',
      teamName: snapshot.teamName || '',
      savedAt: new Date().toISOString(),
    });
  } catch {
    // quota exceeded — не блокируем работу
  }
}

export function clearWorkspaceCache(teamCode) {
  const code = String(teamCode || '').trim().toUpperCase();
  if (!code) return;
  try {
    localStorage.removeItem(workspaceCacheKey(code));
  } catch {
    // ignore
  }
}
