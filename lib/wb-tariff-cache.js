/** Логистика (box) — кэш 6 ч между bootstrap и enrich. */
export const WB_TARIFF_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Комиссии категорий WB обновляются разом — не держим клиентский кэш дольше 30 мин.
 * На каждом sync комиссии всё равно перезапрашиваются с API (см. resolveTariffs).
 */
export const WB_COMMISSION_CACHE_TTL_MS = 30 * 60 * 1000;

export function isTariffCacheFresh(cache, maxAgeMs = WB_TARIFF_CACHE_TTL_MS) {
  if (!cache?.cachedAt) return false;
  const age = Date.now() - new Date(cache.cachedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs;
}

export function isCommissionCacheFresh(cache, maxAgeMs = WB_COMMISSION_CACHE_TTL_MS) {
  return isTariffCacheFresh(cache, maxAgeMs);
}

export function serializeTariffCache(commissionsBySubject, boxTariffs) {
  const defaultTariff = boxTariffs?.defaultTariff || null;
  return {
    cachedAt: new Date().toISOString(),
    commissionEntries: [...(commissionsBySubject || new Map()).entries()],
    boxByNameEntries: boxTariffs?.byName ? [...boxTariffs.byName.entries()] : [],
    boxDefaultTariff: defaultTariff,
    boxWarehouses: boxTariffs?.warehouses || [],
    boxDate: boxTariffs?.date || null,
    boxRawCount: boxTariffs?.rawCount ?? 0,
    boxCargoType: boxTariffs?.cargoType || 'mgt',
    boxTariffSource: boxTariffs?.tariffSource || 'tariffs/box',
    boxScalars: {
      warehouseName: boxTariffs?.warehouseName ?? defaultTariff?.warehouseName ?? '',
      warehouseCoeff: boxTariffs?.warehouseCoeff ?? defaultTariff?.warehouseCoeff,
      storageBasePerLiter: boxTariffs?.storageBasePerLiter ?? defaultTariff?.storageBasePerLiter,
      storageAdditionalPerLiter:
        boxTariffs?.storageAdditionalPerLiter ?? defaultTariff?.storageAdditionalPerLiter,
      storageCoeff: boxTariffs?.storageCoeff ?? defaultTariff?.storageCoeff,
      fbsCoeff: boxTariffs?.fbsCoeff ?? defaultTariff?.fbsCoeff,
      logisticsFirstLiter: boxTariffs?.logisticsFirstLiter ?? defaultTariff?.logisticsFirstLiter,
      logisticsAdditionalLiter:
        boxTariffs?.logisticsAdditionalLiter ?? defaultTariff?.logisticsAdditionalLiter,
    },
  };
}

export function hydrateTariffCache(cache, { allowStale = false } = {}) {
  if (!cache?.cachedAt) return null;
  if (!allowStale && !isTariffCacheFresh(cache)) return null;

  const commissionsBySubject = new Map(cache.commissionEntries || []);
  const byName = new Map(cache.boxByNameEntries || []);
  const defaultTariff = cache.boxDefaultTariff || null;
  const scalars = cache.boxScalars || {};

  const boxTariffs = {
    ...defaultTariff,
    ...scalars,
    byName,
    warehouses: cache.boxWarehouses || [],
    defaultTariff,
    date: cache.boxDate,
    rawCount: cache.boxRawCount ?? byName.size,
    cargoType: cache.boxCargoType || 'mgt',
    tariffSource: cache.boxTariffSource || 'tariffs/box',
  };

  return { commissionsBySubject, boxTariffs };
}
