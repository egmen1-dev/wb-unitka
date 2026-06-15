/**
 * Индекс локализации (ИЛ) и индекс распределения продаж (ИРП) WB.
 * @see https://seller.wildberries.ru/instructions/ru/ru/material/localization-index
 * @see https://seller.wildberries.ru/instructions/ru/ru/material/sales-distribution-index
 */

/** КТР по доле локализации артикула, % (таблица WB, см. кабинет → Тарифы складов). */
export const KTR_BY_LOCALIZATION_PCT = [
  { minPct: 95, ktr: 0.5 },
  { minPct: 90, ktr: 0.55 },
  { minPct: 85, ktr: 0.6 },
  { minPct: 80, ktr: 0.65 },
  { minPct: 75, ktr: 0.7 },
  { minPct: 70, ktr: 0.75 },
  { minPct: 65, ktr: 0.8 },
  { minPct: 60, ktr: 0.85 },
  { minPct: 55, ktr: 0.9 },
  { minPct: 50, ktr: 0.95 },
  { minPct: 45, ktr: 1.0 },
  { minPct: 40, ktr: 1.05 },
  { minPct: 35, ktr: 1.1 },
  { minPct: 30, ktr: 1.15 },
  { minPct: 25, ktr: 1.2 },
  { minPct: 20, ktr: 1.25 },
  { minPct: 15, ktr: 1.3 },
  { minPct: 10, ktr: 1.4 },
  { minPct: 5, ktr: 1.5 },
  { minPct: 0, ktr: 1.6 },
];

/** КРП по доле локализации артикула, % → доля от цены (официальная таблица WB). */
export const KRP_BY_LOCALIZATION_PCT = [
  { minPct: 60, krp: 0 },
  { minPct: 55, krp: 0.02 },
  { minPct: 50, krp: 0.0205 },
  { minPct: 45, krp: 0.0205 },
  { minPct: 40, krp: 0.021 },
  { minPct: 35, krp: 0.021 },
  { minPct: 30, krp: 0.0215 },
  { minPct: 25, krp: 0.022 },
  { minPct: 20, krp: 0.0225 },
  { minPct: 15, krp: 0.023 },
  { minPct: 10, krp: 0.0235 },
  { minPct: 5, krp: 0.0245 },
  { minPct: 0, krp: 0.025 },
];

function lookupBracket(table, sharePct) {
  const pct = Math.max(0, Math.min(100, Number(sharePct) || 0));
  for (const row of table) {
    if (pct >= row.minPct) return row;
  }
  return table[table.length - 1];
}

export function ktrForLocalizationShare(sharePct) {
  return lookupBracket(KTR_BY_LOCALIZATION_PCT, sharePct).ktr;
}

export function krpForLocalizationShare(sharePct) {
  return lookupBracket(KRP_BY_LOCALIZATION_PCT, sharePct).krp;
}

/** Средневзвешенный ИЛ по артикулам: [{ orders, localizationSharePct?, isException? }]. */
export function computeLocalizationIndex(articles = []) {
  let weighted = 0;
  let totalOrders = 0;
  for (const item of articles) {
    const orders = Math.max(0, Number(item.orders) || 0);
    if (!orders) continue;
    const ktr = item.isException
      ? 1
      : Number.isFinite(Number(item.localizationSharePct))
        ? ktrForLocalizationShare(item.localizationSharePct)
        : 1;
    weighted += orders * ktr;
    totalOrders += orders;
  }
  if (!totalOrders) return null;
  return Math.round((weighted / totalOrders) * 1000) / 1000;
}

/** Средневзвешенный ИРП (доля от цены) по артикулам. */
export function computeSalesDistributionIndex(articles = []) {
  let weighted = 0;
  let totalOrders = 0;
  for (const item of articles) {
    const orders = Math.max(0, Number(item.orders) || 0);
    if (!orders) continue;
    const krp = item.isException
      ? 0
      : Number.isFinite(Number(item.localizationSharePct))
        ? krpForLocalizationShare(item.localizationSharePct)
        : 0;
    weighted += orders * krp;
    totalOrders += orders;
  }
  if (!totalOrders) return null;
  return Math.round((weighted / totalOrders) * 100000) / 100000;
}

export function normalizeLocalizationIndex(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n * 1000) / 1000;
}

/** ИРП как доля (0.0105 = 1,05%). */
export function normalizeSalesDistributionIndex(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 100000) / 100000;
}

/** Цена для ИРП — до скидки WB (SPP): basePrice, иначе salePrice. */
export function priceForSalesDistributionIndex({ basePrice, salePrice, ourPrice } = {}) {
  const base = Number(basePrice);
  if (base > 0) return base;
  const our = Number(ourPrice);
  if (our > 0) return our;
  return Math.max(0, Number(salePrice) || 0);
}

/**
 * Прямая логистика с ИЛ и ИРП (обратная — без них, как у WB с 23.03.2026).
 * forwardDelivery уже включает коэфф. склада.
 */
export function applyWbLogisticsIndices(
  forwardDelivery,
  priceRub,
  { localizationIndex = 1, salesDistributionIndex = 0 } = {}
) {
  const forward = Number(forwardDelivery);
  if (!Number.isFinite(forward) || forward <= 0) {
    return {
      forwardWithIndices: null,
      forwardWithIl: null,
      irpSurcharge: null,
      localizationIndex: normalizeLocalizationIndex(localizationIndex),
      salesDistributionIndex: normalizeSalesDistributionIndex(salesDistributionIndex),
    };
  }

  const il = normalizeLocalizationIndex(localizationIndex);
  const irp = normalizeSalesDistributionIndex(salesDistributionIndex);
  const price = Math.max(0, Number(priceRub) || 0);
  const forwardWithIl = forward * il;
  const irpSurcharge = price * irp;

  return {
    forwardWithIndices: forwardWithIl + irpSurcharge,
    forwardWithIl,
    irpSurcharge,
    localizationIndex: il,
    salesDistributionIndex: irp,
  };
}

export function resolveSellerLogisticsIndices(settings = {}, snapshot = {}) {
  const autoSync = settings.autoSyncLogisticsIndices !== false;
  const fromSnapshot =
    autoSync && snapshot.localizationIndex != null
      ? {
          localizationIndex: snapshot.localizationIndex,
          salesDistributionIndex: snapshot.salesDistributionIndex,
        }
      : null;

  const localizationIndex = normalizeLocalizationIndex(
    fromSnapshot?.localizationIndex ?? settings.localizationIndex,
    1
  );
  const salesDistributionIndex = normalizeSalesDistributionIndex(
    fromSnapshot?.salesDistributionIndex ?? settings.salesDistributionIndex,
    0
  );

  const snapshotSource = snapshot.localizationIndexSource || 'sync';

  return {
    includeLogisticsIndices: settings.includeLogisticsIndices !== false,
    localizationIndex,
    salesDistributionIndex,
    localizationIndexSource: fromSnapshot
      ? snapshotSource
      : settings.localizationIndex != null && !autoSync
        ? 'manual'
        : 'default',
    salesDistributionIndexSource: fromSnapshot
      ? snapshot.salesDistributionIndexSource || snapshotSource
      : settings.salesDistributionIndex != null && !autoSync
        ? 'manual'
        : 'default',
  };
}
