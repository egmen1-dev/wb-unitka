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
