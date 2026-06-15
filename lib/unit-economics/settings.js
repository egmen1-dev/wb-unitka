/** Глобальные настройки (лист «_Настройки» + доп. расходы WB). */
export const DEFAULT_UNIT_SETTINGS = {
  /** Основная схема: fbs — отчёты и сводка по FBS */
  primaryScheme: 'fbs',
  /** v2: фикс. тариф диапазона для товаров ≤1 л */
  logisticsSchemaVersion: 2,
  /** УСН «Доходы», доля от retail покупателя */
  taxRate: 0.06,
  /** НДС при УСН (5% или 7%); 0 — не платите НДС */
  vatRate: 0.05,
  /** retail_amount WB включает НДС → НДС = retail × rate / (1 + rate) */
  vatIncludedInPrice: true,
  includeVat: true,
  extraCommissionRate: 0,
  buyoutRate: 1,
  defectRate: 0.01,
  defaultPackagingCost: 0,
  logisticsFirstLiter: 46,
  logisticsAdditionalLiter: 14,
  returnLogisticsMarkup: 0.0454,
  defaultWarehouseCoeff: 2.2,
  fbsFirstLiter: 46,
  fbsAdditionalLiter: 14,
  fbsCoeff: 2.2,
  /** FBS: +3.5 п.п. к комиссии FBO */
  fbsCommissionMarkup: 0.035,
  /** Среднее время доставки покупателю, ч (для надбавки к комиссии FBS) */
  fbsAvgDeliveryHours: null,
  /** Эквайринг, доля от суммы покупателя retail (если нет факта из отчётов) */
  acquiringRate: 0.014,
  /** Хранение FBO: база ₽/л/сут и доп. литр */
  storageBasePerLiter: 0.07,
  storageAdditionalPerLiter: 0.07,
  storageCoeff: 1,
  storageDays: 30,
  /** Приёмка / обработка, ₽ за ед. */
  acceptanceCostPerUnit: 0,
  processingCostPerUnit: 0,
  /** Реклама (ДРР), доля от продажи */
  advertisingDrr: 0,
  /** Логистика с учётом % выкупа (как в отчёте: / выкуп) */
  useBuyoutWeightedLogistics: true,
  /** Учитывать в прибыли */
  includeAcquiring: true,
  includeStorage: false,
  includeAcceptance: true,
  includeProcessing: true,
  includeAdvertising: true,
  /** Предпочитать фактические средние из отчёта реализации */
  preferActualRates: true,
  /** Учитывать ИЛ и ИРП WB в расчётной логистике (не при факте из отчёта) */
  includeLogisticsIndices: true,
  /** Индекс локализации кабинета (1 = без изменений, 0.9 = −10% к литровой части) */
  localizationIndex: 1,
  /** Индекс распределения продаж, доля от цены (0.0105 = 1,05%) */
  salesDistributionIndex: 0,
};

/** Сброс устаревших дефолтов из старой версии (65 ₽ упаковка, 1,75% доп.комиссия). */
function normalizeLegacySettings(settings) {
  const s = { ...settings };
  if (s.defaultPackagingCost === 65) s.defaultPackagingCost = 0;
  if (s.extraCommissionRate === 0.0175) s.extraCommissionRate = 0;
  // Раньше в настройки попадал тариф 1-го литра со склада WB (~79₽), а не из листа «_Настройки» (46₽).
  if (Number(s.logisticsFirstLiter) > 50) s.logisticsFirstLiter = DEFAULT_UNIT_SETTINGS.logisticsFirstLiter;
  if (Number(s.fbsFirstLiter) > 50) s.fbsFirstLiter = DEFAULT_UNIT_SETTINGS.fbsFirstLiter;
  if (s.buyoutRate === 0.9) s.buyoutRate = 1;
  if (!s.logisticsSchemaVersion || s.logisticsSchemaVersion < 2) {
    s.logisticsSchemaVersion = 2;
    s.useBuyoutWeightedLogistics = true;
  }
  if (s.vatRate == null) s.vatRate = DEFAULT_UNIT_SETTINGS.vatRate;
  if (s.includeVat == null) s.includeVat = DEFAULT_UNIT_SETTINGS.includeVat;
  if (s.vatIncludedInPrice == null) s.vatIncludedInPrice = DEFAULT_UNIT_SETTINGS.vatIncludedInPrice;
  // Старый дефолт 11% → УСН 6% + НДС 5%
  if (s.taxRate === 0.11 && s.vatRate === 0.05) s.taxRate = 0.06;
  return s;
}

export function mergeUnitSettings(overrides = {}) {
  return normalizeLegacySettings({ ...DEFAULT_UNIT_SETTINGS, ...overrides });
}

export function settingsToForm(settings) {
  return {
    taxRate: settings.taxRate * 100,
    vatRate: (settings.vatRate ?? 0) * 100,
    extraCommissionRate: settings.extraCommissionRate * 100,
    buyoutRate: settings.buyoutRate * 100,
    defectRate: settings.defectRate * 100,
    defaultPackagingCost: settings.defaultPackagingCost,
    logisticsFirstLiter: settings.logisticsFirstLiter,
    logisticsAdditionalLiter: settings.logisticsAdditionalLiter,
    returnLogisticsMarkup: settings.returnLogisticsMarkup * 100,
    defaultWarehouseCoeff: settings.defaultWarehouseCoeff,
    fbsFirstLiter: settings.fbsFirstLiter ?? settings.logisticsFirstLiter,
    fbsAdditionalLiter: settings.fbsAdditionalLiter ?? settings.logisticsAdditionalLiter,
    fbsCoeff: settings.fbsCoeff ?? settings.defaultWarehouseCoeff,
    fbsCommissionMarkup: (settings.fbsCommissionMarkup ?? 0.035) * 100,
    fbsAvgDeliveryHours: settings.fbsAvgDeliveryHours ?? '',
    acquiringRate: settings.acquiringRate * 100,
    storageBasePerLiter: settings.storageBasePerLiter,
    storageAdditionalPerLiter: settings.storageAdditionalPerLiter,
    storageCoeff: settings.storageCoeff,
    storageDays: settings.storageDays,
    acceptanceCostPerUnit: settings.acceptanceCostPerUnit,
    processingCostPerUnit: settings.processingCostPerUnit,
    advertisingDrr: settings.advertisingDrr * 100,
    useBuyoutWeightedLogistics: settings.useBuyoutWeightedLogistics,
    includeAcquiring: settings.includeAcquiring,
    includeStorage: settings.includeStorage,
    includeAcceptance: settings.includeAcceptance,
    includeProcessing: settings.includeProcessing,
    includeAdvertising: settings.includeAdvertising,
    includeVat: settings.includeVat !== false,
    vatIncludedInPrice: settings.vatIncludedInPrice !== false,
    preferActualRates: settings.preferActualRates,
    includeLogisticsIndices: settings.includeLogisticsIndices !== false,
    localizationIndex: settings.localizationIndex ?? 1,
    salesDistributionIndex: (settings.salesDistributionIndex ?? 0) * 100,
  };
}

export function settingsFromForm(form) {
  return mergeUnitSettings({
    taxRate: Number(form.taxRate) / 100,
    vatRate: Number(form.vatRate) / 100,
    extraCommissionRate: Number(form.extraCommissionRate) / 100,
    buyoutRate: Number(form.buyoutRate) / 100,
    defectRate: Number(form.defectRate) / 100,
    defaultPackagingCost: Number(form.defaultPackagingCost),
    logisticsFirstLiter: Number(form.logisticsFirstLiter),
    logisticsAdditionalLiter: Number(form.logisticsAdditionalLiter),
    returnLogisticsMarkup: Number(form.returnLogisticsMarkup) / 100,
    defaultWarehouseCoeff: Number(form.defaultWarehouseCoeff),
    fbsFirstLiter: Number(form.fbsFirstLiter),
    fbsAdditionalLiter: Number(form.fbsAdditionalLiter),
    fbsCoeff: Number(form.fbsCoeff),
    fbsCommissionMarkup: Number(form.fbsCommissionMarkup) / 100,
    fbsAvgDeliveryHours: form.fbsAvgDeliveryHours === '' ? null : Number(form.fbsAvgDeliveryHours),
    acquiringRate: Number(form.acquiringRate) / 100,
    storageBasePerLiter: Number(form.storageBasePerLiter),
    storageAdditionalPerLiter: Number(form.storageAdditionalPerLiter),
    storageCoeff: Number(form.storageCoeff),
    storageDays: Number(form.storageDays),
    acceptanceCostPerUnit: Number(form.acceptanceCostPerUnit),
    processingCostPerUnit: Number(form.processingCostPerUnit),
    advertisingDrr: Number(form.advertisingDrr) / 100,
    useBuyoutWeightedLogistics: Boolean(form.useBuyoutWeightedLogistics),
    includeAcquiring: Boolean(form.includeAcquiring),
    includeStorage: Boolean(form.includeStorage),
    includeAcceptance: Boolean(form.includeAcceptance),
    includeProcessing: Boolean(form.includeProcessing),
    includeAdvertising: Boolean(form.includeAdvertising),
    includeVat: Boolean(form.includeVat),
    vatIncludedInPrice: Boolean(form.vatIncludedInPrice),
    preferActualRates: Boolean(form.preferActualRates),
    includeLogisticsIndices: Boolean(form.includeLogisticsIndices),
    localizationIndex: Number(form.localizationIndex) || 1,
    salesDistributionIndex: Number(form.salesDistributionIndex) / 100,
  });
}
