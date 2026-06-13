export const OVERRIDE_FIELDS = ['packagingCost', 'processingCost', 'extraCosts'];

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
