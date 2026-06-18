import { mergeUnitSettings, FIXED_VAT_RATE } from './settings.js';

export { FIXED_VAT_RATE };

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function resolveVatRate(settings) {
  const raw = num(settings?.vatRate);
  return raw > 0 ? raw : FIXED_VAT_RATE;
}

function calcVatRub(taxBase, settings) {
  const base = Math.max(0, num(taxBase));
  const vatRate = resolveVatRate(settings);
  if (settings.vatIncludedInPrice !== false) {
    return (base * vatRate) / (1 + vatRate);
  }
  return base * vatRate;
}

/**
 * УСН «Доходы» + НДС 5% (для УСН с 2025).
 * База — retail покупателя (retail_amount), обычно с НДС внутри → НДС = base × 5/105.
 */
export function computeSalesTaxes(taxBaseInput, settingsInput = {}) {
  const settings = mergeUnitSettings(settingsInput);
  const taxBase = Math.max(0, num(taxBaseInput));

  const usnRub = taxBase * num(settings.taxRate);
  const vatRub = calcVatRub(taxBase, settings);

  return {
    taxBase,
    usnRub,
    vatRub,
    taxRub: usnRub + vatRub,
  };
}

/**
 * Налог для юнит-калькулятора.
 * revenue — УСН + НДС 5% с цены продажи.
 * wb_portal — УСН с прибыли + НДС 5% с цены продажи.
 */
export function computeUnitTaxes(profitBeforeTax, salePrice, settingsInput = {}) {
  const settings = mergeUnitSettings(settingsInput);
  const mode = settings.taxBaseMode || 'revenue';
  const sale = Math.max(0, num(salePrice));

  if (mode === 'revenue') {
    return computeSalesTaxes(sale, settings);
  }

  const taxableProfit = num(profitBeforeTax);
  const usnRub = taxableProfit * num(settings.taxRate);
  const vatRub = calcVatRub(sale, settings);

  return {
    taxBase: taxableProfit,
    usnRub,
    vatRub,
    taxRub: usnRub + vatRub,
  };
}
