/** Поля, которые калькулятор сам считает — не передаём из кэша строки. */
const COMPUTED_ROW_KEYS = new Set([
  'packagingCost',
  'manualExtraCosts',
  'processingCostOverride',
  'profitFbo',
  'profitFbs',
  'marginFbo',
  'marginFbs',
  'profitabilityFbo',
  'profitabilityFbs',
  'fboCommissionRub',
  'fbsCommissionRub',
  'fboTotalRate',
  'fbsTotalRate',
  'logisticsFbo',
  'logisticsFbs',
  'logisticsFboSource',
  'logisticsFbsSource',
  'storageRub',
  'storageSource',
  'storagePerDay',
  'extraCosts',
  'extraCostsFbo',
  'extraCostsFbs',
  'costBreakdown',
  'fbsDeliverySurcharge',
  'fbsCategorySource',
  'baseDelivery',
  'fbsBaseDelivery',
  'logisticsFirstLiter',
  'logisticsAdditionalLiter',
  'fbsFirstLiter',
  'fbsAdditionalLiter',
  'returnDelivery',
  'returnDeliveryFbo',
  'returnDeliveryFbs',
  'subLiterTariff',
  'actualLogisticsRubFbs',
  'actualLogisticsRubFbo',
  'actualLogisticsRubAll',
  'actualForwardLogisticsRub',
  'actualReturnLogisticsRub',
  'actualForwardLogisticsRubFbs',
  'actualReturnLogisticsRubFbs',
  'reportForwardLogistics',
  'reportReturnLogistics',
  'reportOtherLogistics',
  'reportForwardLogisticsFbs',
  'reportReturnLogisticsFbs',
  'reportSales',
  'reportSalesFbs',
  'reportSalesFbo',
  'reportReturns',
  'logisticsCompare',
  'taxRub',
  'acquiringRub',
  'acceptanceRub',
  'processingRub',
  'advertisingRub',
  'defectRub',
  'discountPct',
  'sppPct',
  'billedLiters',
  'acquiringBasePrice',
  'acquiringSource',
  'buyoutFromReport',
]);

/**
 * Готовит вход калькулятора из кэшированной строки.
 * Сырые комиссии WB (fboCommission/fbsCommission) сохраняем; итоговую fbsCategoryRate из кэша — нет.
 */
export function rowToCalculatorInput(row, purchasePrice) {
  const input = { purchasePrice };

  for (const [key, value] of Object.entries(row)) {
    if (COMPUTED_ROW_KEYS.has(key) || key === 'fbsCategoryRate') continue;
    input[key] = value;
  }

  if (row.fboCommission != null && row.fboCommission !== '') {
    input.fboCategoryRate = row.fboCommission;
  } else if (row.fboCategoryRate != null && row.fboCategoryRate !== '') {
    input.fboCategoryRate = row.fboCategoryRate;
  }

  if (row.fbsCommission != null && row.fbsCommission !== '') {
    input.fbsCategoryRate = row.fbsCommission;
  }

  return input;
}
