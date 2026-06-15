import { rowToCalculatorInput } from '@lib/unit-economics/calc-input.js';
import { calculateUnitEconomicsRow } from '@lib/unit-economics/calculator.js';
import { getProductOverride, mergeRowOverrides } from './product-overrides.js';

const ROW_SIG_KEYS = [
  'nmId',
  'vendorCode',
  'brand',
  'title',
  'salePrice',
  'basePrice',
  'ourPrice',
  'purchasePrice',
  'stockFbs',
  'stockFbo',
  'orders7d',
  'fbsAvgDeliveryHours',
  'volumeLiters',
  'fbsCoeff',
  'fboCoeff',
  'adSpend',
  'advertisingDrr',
  'reportSales',
  'buyoutRate',
  'fboCommission',
  'fbsCommission',
];

function buildRowSig(row) {
  const parts = [];
  for (const key of ROW_SIG_KEYS) {
    parts.push(row[key] ?? '');
  }
  return parts.join('\x1f');
}

function overrideSig(overrides, vendor) {
  const o = getProductOverride(overrides, vendor);
  return `${o.packagingCost ?? ''}\x1f${o.processingCost ?? ''}\x1f${o.extraCosts ?? ''}`;
}

function purchasePriceFor(row, purchases) {
  const vendor = String(row.vendorCode || '');
  const override = purchases[vendor];
  return override != null && override !== '' ? Number(override) : row.purchasePrice;
}

/** Пересчёт с кэшем по nmId — при синхронизации пересчитываются только изменившиеся строки. */
export function createRecalcRows() {
  const byNm = new Map();
  let settingsSig = '';

  return function recalcRows(baseRows, purchases, settings, productOverrides = {}) {
    settingsSig = JSON.stringify(settings);
    const out = new Array(baseRows.length);
    const activeNm = new Set();

    for (let i = 0; i < baseRows.length; i += 1) {
      const row = baseRows[i];
      const nmId = row.nmId ?? `i:${i}`;
      activeNm.add(nmId);
      const vendor = String(row.vendorCode || '');
      const purchasePrice = purchasePriceFor(row, purchases);
      const key = `${buildRowSig(row)}\x1f${purchasePrice}\x1f${overrideSig(productOverrides, vendor)}\x1f${settingsSig}`;

      const cached = byNm.get(nmId);
      if (cached?.key === key) {
        out[i] = cached.calc;
        continue;
      }

      const calc = calculateUnitEconomicsRow(
        mergeRowOverrides(rowToCalculatorInput(row, purchasePrice), productOverrides),
        settings
      );
      byNm.set(nmId, { key, calc });
      out[i] = calc;
    }

    for (const nmId of byNm.keys()) {
      if (!activeNm.has(nmId)) byNm.delete(nmId);
    }

    return out;
  };
}
