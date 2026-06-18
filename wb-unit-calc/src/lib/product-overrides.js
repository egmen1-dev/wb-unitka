import { vendorLookupKeys } from '../../../lib/unit-economics/vendor-key.js';

export const OVERRIDE_FIELDS = ['packagingCost', 'processingCost', 'extraCosts', 'draftSalePrice'];

function resolvePatchForRow(row, priceUpdates) {
  const byNm = new Map();
  const byVendor = new Map();
  const entries =
    priceUpdates instanceof Map ? [...priceUpdates.entries()] : Object.entries(priceUpdates || {});
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

  let next = overrides;
  for (const row of rows) {
    const patch = resolvePatchForRow(row, priceUpdates);
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
