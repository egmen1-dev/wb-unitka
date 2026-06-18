import { rowToCalculatorInput } from '../../../lib/unit-economics/calc-input.js';
import { calculateUnitEconomicsRow } from '../../../lib/unit-economics/calculator.js';
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
  return `${o.packagingCost ?? ''}\x1f${o.processingCost ?? ''}\x1f${o.extraCosts ?? ''}\x1f${o.draftSalePrice ?? ''}`;
}

/** Вход «что если» по черновой цене: все ценовые поля и без факта из отчёта. */
export function buildDraftScenarioInput(calcInput, draftPrice) {
  return {
    ...calcInput,
    salePrice: draftPrice,
    basePrice: draftPrice,
    ourPrice: draftPrice,
    retailPricePerUnit: draftPrice,
    actualLogisticsRubFbs: null,
    actualLogisticsRubFbo: null,
    actualLogisticsRub: null,
    commissionActualPct: null,
    actualAcquiringRub: null,
    actualAcceptanceRub: null,
    actualProcessingRub: null,
    actualStorageRub: null,
  };
}

/** Черновая цена — сценарий, не факт; считаем тарифы WB, не средние из отчёта. */
export function draftScenarioSettings(settings) {
  return { ...settings, preferActualRates: false };
}

function applyDraftEconomics(calc, calcInput, settings, productOverrides, vendor) {
  const draftRaw = getProductOverride(productOverrides, vendor).draftSalePrice;
  if (draftRaw == null || draftRaw === '') {
    return {
      ...calc,
      draftSalePrice: null,
      draftProfitFbo: null,
      draftProfitFbs: null,
      draftMarginFbo: null,
      draftMarginFbs: null,
    };
  }

  const draftPrice = Number(draftRaw);
  if (!Number.isFinite(draftPrice) || draftPrice <= 0) {
    return {
      ...calc,
      draftSalePrice: null,
      draftProfitFbo: null,
      draftProfitFbs: null,
      draftMarginFbo: null,
      draftMarginFbs: null,
    };
  }

  const draftCalc = calculateUnitEconomicsRow(
    buildDraftScenarioInput(calcInput, draftPrice),
    draftScenarioSettings(settings)
  );
  return {
    ...calc,
    draftSalePrice: draftPrice,
    draftProfitFbo: draftCalc.profitFbo,
    draftProfitFbs: draftCalc.profitFbs,
    draftMarginFbo: draftCalc.marginFbo,
    draftMarginFbs: draftCalc.marginFbs,
  };
}

function purchasePriceFor(row, purchases) {
  const vendor = String(row.vendorCode || '');
  const override = purchases[vendor];
  if (override != null && override !== '') {
    const n = Number(override);
    if (Number.isFinite(n)) return n;
  }
  return row.purchasePrice;
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

      const calcInput = mergeRowOverrides(rowToCalculatorInput(row, purchasePrice), productOverrides);
      const calc = applyDraftEconomics(
        calculateUnitEconomicsRow(calcInput, settings),
        calcInput,
        settings,
        productOverrides,
        vendor
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
