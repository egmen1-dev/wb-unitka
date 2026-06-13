/** Как часто перечитывать карточки товаров целиком (новые SKU, габариты). */
export const FULL_CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
    skus: p.skus || [],
    stockFbo: p.stockFbo ?? 0,
    stockFbs: p.stockFbs ?? 0,
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
    };
  }
  return bootstrapped;
}
