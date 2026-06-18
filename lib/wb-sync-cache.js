import { extractPriceFromGoods, indexPricesByVendorCode } from './wb-official-api.js';
import { resolveReportNmId } from './wb-realization-stats.js';
import { vendorLookupKeys } from './unit-economics/vendor-key.js';

/** Как часто перечитывать карточки товаров целиком (новые SKU, габариты). */
export const FULL_CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Отчёт реализации WB обновляется редко — не чаще раза в 5 ч. */
export const REALIZATION_MAX_AGE_MS = 5 * 60 * 60 * 1000;

/** Цены продажи WB — перечитывать не реже раза в 6 ч. */
export const PRICE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function isCacheStale(isoDate, maxAgeMs) {
  if (!isoDate) return true;
  const age = Date.now() - new Date(isoDate).getTime();
  return !Number.isFinite(age) || age > maxAgeMs;
}

/** Полный обход каталога — только по кнопке «Полностью» или если кэша нет. */
export function shouldFetchFullCatalog(mode, wbCache) {
  if (mode === 'full') return true;
  return !wbCache?.products?.length;
}

export function isFullCatalogStale(wbCache) {
  return isCacheStale(wbCache?.fullCatalogAt, FULL_CATALOG_MAX_AGE_MS);
}

export function isRealizationStale(isoDate, maxAgeMs = REALIZATION_MAX_AGE_MS) {
  return isCacheStale(isoDate, maxAgeMs);
}

/** Для миграции: если snapshot есть, но realizationSyncedAt нет — опираемся на общий syncedAt. */
export function resolveRealizationSyncedAt(wbCache, fallbackSyncedAt) {
  if (wbCache?.realizationSyncedAt) return wbCache.realizationSyncedAt;
  if (wbCache?.realizationSnapshot && fallbackSyncedAt) return fallbackSyncedAt;
  return null;
}

/** Пропустить загрузку отчёта реализации (quick/lightweight), если кэш свежий (< 5 ч). */
export function shouldSkipRealizationFetch({ mode, wbCache, fallbackSyncedAt, forceRealization = false }) {
  if (forceRealization || mode === 'full') return false;
  if (mode === 'bootstrap') return true;
  if (!wbCache?.realizationSnapshot) return false;
  const at = resolveRealizationSyncedAt(wbCache, fallbackSyncedAt);
  return !isRealizationStale(at);
}

export function isPriceDataStale(pricesSyncedAt, maxAgeMs = PRICE_MAX_AGE_MS) {
  return isCacheStale(pricesSyncedAt, maxAgeMs);
}

export function isPriceSyncedAtNewer(localAt, cloudAt) {
  if (!localAt) return false;
  if (!cloudAt) return true;
  const localMs = new Date(localAt).getTime();
  const cloudMs = new Date(cloudAt).getTime();
  return Number.isFinite(localMs) && Number.isFinite(cloudMs) && localMs > cloudMs;
}

/**
 * При pull из облака сохраняем локальные цены, если Prices API обновлял их позже облачного снимка.
 */
export function mergeWorkspaceRowsPreservingLocalPrices(
  cloudRows,
  localRows,
  localPricesSyncedAt,
  cloudPricesSyncedAt
) {
  if (!cloudRows?.length) return localRows?.length ? localRows : cloudRows;
  if (!localRows?.length || !isPriceSyncedAtNewer(localPricesSyncedAt, cloudPricesSyncedAt)) {
    return cloudRows;
  }

  const localByNm = new Map(localRows.filter((r) => r.nmId).map((r) => [Number(r.nmId), r]));
  const localByVendor = new Map();
  for (const row of localRows) {
    const vendor = String(row.vendorCode || '').trim();
    if (vendor) localByVendor.set(vendor, row);
  }

  return cloudRows.map((cloudRow) => {
    const local =
      localByNm.get(Number(cloudRow.nmId)) ||
      localByVendor.get(String(cloudRow.vendorCode || '').trim());
    if (!local || Number(local.salePrice) === Number(cloudRow.salePrice)) return cloudRow;
    return {
      ...cloudRow,
      salePrice: local.salePrice,
      basePrice: local.basePrice ?? cloudRow.basePrice,
      ourPrice: local.ourPrice ?? cloudRow.ourPrice,
      retailPricePerUnit: local.retailPricePerUnit ?? local.salePrice ?? cloudRow.retailPricePerUnit,
    };
  });
}

/** Патч цен из goods Prices API. */
export function pricePatchFromGoods(goods) {
  const { price: ourPrice, oldPrice } = extractPriceFromGoods(goods);
  const basePrice = oldPrice || ourPrice;
  const salePrice = ourPrice || oldPrice;
  if (!(salePrice > 0)) return null;
  return {
    salePrice,
    basePrice,
    ourPrice: ourPrice || salePrice,
    retailPricePerUnit: salePrice,
  };
}

export function lookupGoodsInPriceMap(
  pricesByNmId,
  pricesByVendor,
  { nmId, vendorCode, catalogNmId } = {},
  realization = null
) {
  const catalogId = Number(catalogNmId ?? nmId) || 0;
  const resolvedNmId = resolveReportNmId(realization, catalogId, vendorCode);
  const ids = [...new Set([catalogId, resolvedNmId, Number(nmId)].filter(Boolean))];
  for (const id of ids) {
    const hit = pricesByNmId.get(id);
    if (hit) return hit;
  }
  if (pricesByVendor && vendorCode) {
    for (const key of vendorLookupKeys(vendorCode)) {
      const hit = pricesByVendor.get(key);
      if (hit) return hit;
    }
  }
  return undefined;
}

export function buildPriceUpdatesForItems(items, pricesByNmId, realization = null, pricesByVendor = null) {
  const byVendor = pricesByVendor || indexPricesByVendorCode(pricesByNmId);
  const priceUpdates = {};
  let pricesMatched = 0;
  for (const item of items || []) {
    const vendorCode = String(item.vendorCode || '').trim();
    const catalogNmId = Number(item.nmId) || 0;
    if (!catalogNmId && !vendorCode) continue;
    const goods = lookupGoodsInPriceMap(
      pricesByNmId,
      byVendor,
      { nmId: catalogNmId, vendorCode, catalogNmId },
      realization
    );
    const patch = pricePatchFromGoods(goods);
    if (!patch) continue;
    pricesMatched += 1;
    const resolvedNmId = resolveReportNmId(realization, catalogNmId, vendorCode);
    const rowNmId = catalogNmId || resolvedNmId;
    if (rowNmId) priceUpdates[rowNmId] = patch;
    if (resolvedNmId && resolvedNmId !== rowNmId) priceUpdates[resolvedNmId] = patch;
    if (vendorCode) priceUpdates[`v:${vendorCode}`] = patch;
  }
  return { priceUpdates, pricesMatched };
}

function normalizePriceUpdateMaps(priceUpdates) {
  const byNm = new Map();
  const byVendor = new Map();
  if (!priceUpdates) return { byNm, byVendor };
  const entries =
    priceUpdates instanceof Map ? [...priceUpdates.entries()] : Object.entries(priceUpdates);
  for (const [key, patch] of entries) {
    if (!patch) continue;
    const raw = String(key);
    if (raw.startsWith('v:')) {
      byVendor.set(raw.slice(2), patch);
      continue;
    }
    const nmId = Number(key);
    if (nmId) byNm.set(nmId, patch);
  }
  return { byNm, byVendor };
}

function resolvePricePatchForRow(row, byNm, byVendor) {
  const nmId = Number(row.nmId);
  if (nmId && byNm.has(nmId)) return byNm.get(nmId);
  const vendor = String(row.vendorCode || '').trim();
  if (!vendor) return null;
  if (byVendor.has(vendor)) return byVendor.get(vendor);
  for (const key of vendorLookupKeys(vendor)) {
    if (byVendor.has(key)) return byVendor.get(key);
  }
  return null;
}

export function pricePatchDiffersFromRow(row, patch) {
  if (!patch) return false;
  return (
    Number(row.salePrice) !== Number(patch.salePrice) ||
    Number(row.basePrice) !== Number(patch.basePrice) ||
    Number(row.ourPrice) !== Number(patch.ourPrice)
  );
}

/** Патч salePrice/basePrice/ourPrice — только строки, где цена реально изменилась. */
export function applyPriceUpdatesToRows(rows, priceUpdates, { deltaOnly = true } = {}) {
  const empty = { rows: rows || [], updated: 0, unchanged: 0, missing: rows?.length || 0 };
  if (!rows?.length || !priceUpdates) return empty;
  const { byNm, byVendor } = normalizePriceUpdateMaps(priceUpdates);
  if (!byNm.size && !byVendor.size) return { rows, updated: 0, unchanged: 0, missing: rows.length };
  let updated = 0;
  let unchanged = 0;
  let missing = 0;
  const nextRows = rows.map((row) => {
    const patch = resolvePricePatchForRow(row, byNm, byVendor);
    if (!patch) {
      missing += 1;
      return row;
    }
    if (deltaOnly && !pricePatchDiffersFromRow(row, patch)) {
      unchanged += 1;
      return row;
    }
    updated += 1;
    const salePrice = patch.salePrice;
    return {
      ...row,
      salePrice,
      basePrice: patch.basePrice,
      ourPrice: patch.ourPrice,
      retailPricePerUnit: patch.retailPricePerUnit ?? salePrice,
    };
  });
  return { rows: nextRows, updated, unchanged, missing };
}

export function filterDeltaPriceUpdates(rows, priceUpdates) {
  const { byNm, byVendor } = normalizePriceUpdateMaps(priceUpdates);
  const delta = {};
  let updated = 0;
  let unchanged = 0;
  let missing = 0;
  for (const row of rows || []) {
    const patch = resolvePricePatchForRow(row, byNm, byVendor);
    if (!patch) {
      missing += 1;
      continue;
    }
    if (!pricePatchDiffersFromRow(row, patch)) {
      unchanged += 1;
      continue;
    }
    updated += 1;
    const nmId = Number(row.nmId);
    if (nmId) delta[nmId] = patch;
    const vendor = String(row.vendorCode || '').trim();
    if (vendor) delta[`v:${vendor}`] = patch;
  }
  return { priceUpdates: delta, updated, unchanged, missing };
}

export function mergeSyncRowsPreservingLocalPrices(syncedRows, localRows, localPricesSyncedAt) {
  if (!syncedRows?.length) return localRows?.length ? localRows : syncedRows;
  if (!localRows?.length || !localPricesSyncedAt) return syncedRows;
  return mergeWorkspaceRowsPreservingLocalPrices(syncedRows, localRows, localPricesSyncedAt, null);
}

/** Черновая цена сильно расходится с «Продажа» — вероятно устаревшая цена WB в кэше. */
export function isSalePriceLikelyStale(row) {
  const sale = Number(row.salePrice);
  const draft = Number(row.draftSalePrice);
  if (!Number.isFinite(sale) || sale <= 0 || !Number.isFinite(draft) || draft <= 0) return false;
  return Math.abs(sale - draft) / Math.max(sale, draft) > 0.25;
}

export function minutesSince(isoDate) {
  if (!isoDate) return Infinity;
  return (Date.now() - new Date(isoDate).getTime()) / 60_000;
}

export function collectAllSkus(products) {
  return products.flatMap((p) => p.skus || []).filter(Boolean);
}

/** Статическая часть товара для кэша между синхронизациями. */
export function slimProductsForCache(products) {
  return products.map((p) => ({
    nmId: p.nmId,
    vendorCode: p.vendorCode,
    brand: p.brand,
    title: p.title,
    subjectId: p.subjectId,
    subjectName: p.subjectName,
    lengthCm: p.lengthCm,
    widthCm: p.widthCm,
    heightCm: p.heightCm,
    weightKg: p.weightKg,
    cargoType: p.cargoType,
    skus: p.skus || [],
    stockFbo: p.stockFbo ?? 0,
    stockFbs: p.stockFbs ?? 0,
    fboStockByWarehouse: p.fboStockByWarehouse ?? [],
  }));
}

export function staticInfoFromCard(card) {
  const skus = (card.sizes || []).flatMap((s) => s.skus || []).filter(Boolean);
  return {
    nmId: card.nmID,
    vendorCode: String(card.vendorCode || ''),
    brand: card.brand || '',
    title: card.title || '',
    subjectId: card.subjectID,
    subjectName: card.subjectName || '',
    skus,
  };
}

export function findMissingNmIds(pricesByNmId, cachedProducts) {
  const cached = new Set((cachedProducts || []).map((p) => Number(p.nmId)));
  return [...pricesByNmId.keys()].filter((nmId) => !cached.has(Number(nmId)));
}

/** Обновляет кэш карточек: новые nmId и изменённые габариты/SKU. */
export function mergeProductCache(cachedProducts, deltaCards, toCachedProduct) {
  const byNmId = new Map((cachedProducts || []).map((p) => [Number(p.nmId), { ...p }]));
  for (const card of deltaCards) {
    const entry = toCachedProduct(card);
    if (entry?.nmId) byNmId.set(Number(entry.nmId), entry);
  }
  return [...byNmId.values()];
}

export function cardToCachedProduct(card, extractDimensions) {
  return {
    ...staticInfoFromCard(card),
    ...extractDimensions(card),
  };
}

export function bootstrapProductCacheFromRows(rows, syncedAt) {
  if (!rows?.length) return null;

  const products = rows
    .filter((row) => row.nmId)
    .map((row) => ({
      nmId: row.nmId,
      vendorCode: String(row.vendorCode || ''),
      brand: row.brand || '',
      title: row.title || '',
      subjectId: row.subjectId,
      subjectName: row.subjectName || '',
      lengthCm: row.lengthCm ?? null,
      widthCm: row.widthCm ?? null,
      heightCm: row.heightCm ?? null,
      weightKg: row.weightKg ?? null,
      skus: row.skus || [],
      stockFbo: row.stockFbo ?? 0,
      stockFbs: row.stockFbs ?? 0,
      fboStockByWarehouse: row.fboStockByWarehouse ?? [],
    }));

  if (!products.length) return null;

  const at = syncedAt || new Date().toISOString();
  return {
    products,
    fullCatalogAt: at,
    cardsSyncedAt: at,
  };
}

/** Кэш карточек: из localStorage или восстановление из уже загруженных строк. */
export function buildEffectiveWbCache(wbProductCache, baseRows, syncedAt) {
  const bootstrapped = bootstrapProductCacheFromRows(baseRows, syncedAt);
  if (wbProductCache?.products?.length) {
    return {
      ...wbProductCache,
      tariffCache: wbProductCache.tariffCache || bootstrapped?.tariffCache || null,
      realizationSnapshot: wbProductCache.realizationSnapshot || null,
      realizationSyncedAt: wbProductCache.realizationSyncedAt || null,
    };
  }
  if (wbProductCache?.tariffCache || wbProductCache?.realizationSnapshot) {
    return {
      ...(bootstrapped || {}),
      tariffCache: wbProductCache.tariffCache || null,
      realizationSnapshot: wbProductCache.realizationSnapshot || null,
      realizationSyncedAt: wbProductCache.realizationSyncedAt || null,
    };
  }
  return bootstrapped;
}
