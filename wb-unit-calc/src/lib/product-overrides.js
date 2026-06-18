export const OVERRIDE_FIELDS = ['packagingCost', 'processingCost', 'extraCosts', 'draftSalePrice'];

export function getProductOverride(overrides, vendorCode) {
  if (!vendorCode) return {};
  return overrides?.[String(vendorCode)] || {};
}

export function mergeRowOverrides(row, overrides = {}) {
  const vendor = String(row.vendorCode || '');
  const o = getProductOverride(overrides, vendor);

  return {
    ...row,
    packagingCost: o.packagingCost ?? row.packagingCost,
    processingCostOverride: o.processingCost ?? row.processingCostOverride,
    manualExtraCosts: o.extraCosts ?? row.manualExtraCosts,
  };
}

export function setProductOverride(overrides, vendorCode, field, value) {
  const key = String(vendorCode || '');
  if (!key || !OVERRIDE_FIELDS.includes(field)) return overrides;

  const next = { ...overrides };
  const row = { ...(next[key] || {}) };

  if (value === '' || value == null) {
    delete row[field];
  } else {
    row[field] = value;
  }

  if (Object.keys(row).length === 0) {
    delete next[key];
  } else {
    next[key] = row;
  }

  return next;
}

/** Сбрасывает черновую цену, если она совпадала с устаревшей продажей до патча WB. */
export function reconcileDraftOverridesAfterPricePatch(rows, priceUpdates, overrides = {}) {
  if (!rows?.length || !priceUpdates || !overrides) return overrides;

  const byNm = new Map();
  if (priceUpdates instanceof Map) {
    for (const [nmId, patch] of priceUpdates) byNm.set(Number(nmId), patch);
  } else {
    for (const [nmId, patch] of Object.entries(priceUpdates)) {
      if (patch) byNm.set(Number(nmId), patch);
    }
  }
  if (!byNm.size) return overrides;

  let next = overrides;
  for (const row of rows) {
    const patch = byNm.get(Number(row.nmId));
    if (!patch) continue;

    const vendor = String(row.vendorCode || '');
    const draftRaw = getProductOverride(next, vendor).draftSalePrice;
    if (draftRaw == null || draftRaw === '') continue;

    const draftNum = Number(draftRaw);
    if (!Number.isFinite(draftNum)) continue;

    const oldSale = Number(row.salePrice);
    const oldBase = Number(row.basePrice);
    const oldOur = Number(row.ourPrice);
    if (draftNum === oldSale || draftNum === oldBase || draftNum === oldOur) {
      next = setProductOverride(next, vendor, 'draftSalePrice', '');
    }
  }

  return next;
}
