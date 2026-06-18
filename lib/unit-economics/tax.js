import { mergeUnitSettings } from './settings.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * УСН «Доходы» + НДС (для УСН с 2025: 5% или 7%).
 * База — retail покупателя (retail_amount), обычно с НДС внутри → НДС = base × rate / (1 + rate).
 */
export function computeSalesTaxes(taxBaseInput, settingsInput = {}) {
  const settings = mergeUnitSettings(settingsInput);
  const taxBase = Math.max(0, num(taxBaseInput));

  const usnRub = taxBase * num(settings.taxRate);
  let vatRub = 0;

  const vatRate = num(settings.vatRate);
  if (vatRate > 0 && settings.includeVat !== false) {
    vatRub =
      settings.vatIncludedInPrice !== false
        ? (taxBase * vatRate) / (1 + vatRate)
        : taxBase * vatRate;
  }

  return {
    taxBase,
    usnRub,
    vatRub,
    taxRub: usnRub + vatRub,
  };
}

/**
 * Налог для юнит-калькулятора.
 * wb_portal — как в «Калькуляторе прибыли» WB: УСН с прибыли до налога (может быть отрицательным при убытке).
 * revenue — УСН + НДС с цены продажи (консервативнее для прибыльных SKU).
 */
export function computeUnitTaxes(profitBeforeTax, salePrice, settingsInput = {}) {
  const settings = mergeUnitSettings(settingsInput);
  const mode = settings.taxBaseMode || 'wb_portal';
  const sale = Math.max(0, num(salePrice));

  if (mode === 'revenue') {
    return computeSalesTaxes(sale, settings);
  }

  const taxableProfit = num(profitBeforeTax);
  const usnRub = taxableProfit * num(settings.taxRate);
  let vatRub = 0;

  const vatRate = num(settings.vatRate);
  if (vatRate > 0 && settings.includeVat !== false && mode === 'revenue_vat') {
    vatRub =
      settings.vatIncludedInPrice !== false
        ? (sale * vatRate) / (1 + vatRate)
        : sale * vatRate;
  }

  return {
    taxBase: taxableProfit,
    usnRub,
    vatRub,
    taxRub: usnRub + vatRub,
  };
}
