import { actualStatsFromRow, compareLogisticsToActual } from '../logistics-compare.js';
import { mergeUnitSettings } from './settings.js';
import { computeSalesTaxes } from './tax.js';
import { resolveFbsCategoryRate } from './fbs-commission.js';
import {
  billingLiters,
  calcWbForwardDelivery,
  calcWbLogisticsPerUnit,
  calcWbReturnDelivery,
  isOverOneLiter,
  subLiterTierFlatRub,
} from '../wb-logistics.js';



function num(value) {

  const n = Number(value);

  return Number.isFinite(n) ? n : 0;

}



function pickTariffNumber(input, key, settings, settingsKey) {
  if (input[key] != null && input[key] !== '') return num(input[key]);
  if (settings[settingsKey] != null && settings[settingsKey] !== '') return num(settings[settingsKey]);
  return null;
}

function hasOverride(value) {
  return value != null && value !== '';
}

/** Факт из отчёта; если аналитики нет — 100% (логистика без невыкупа). */
function resolveBuyoutRate(...candidates) {
  for (const v of candidates) {
    if (v != null && v !== '' && Number.isFinite(Number(v))) {
      return Math.min(1, Math.max(0.01, num(v)));
    }
  }
  return 1;
}

function positiveRate(value) {
  if (value == null || value === '') return null;
  const n = num(value);
  return n > 0 ? n : null;
}

function calcLogisticsCost({
  forwardDelivery,
  returnDelivery,
  baseDelivery,
  buyoutRate,
  returnMarkup,
  useBuyoutWeighted,
  actualLogisticsRub,
  preferActual,
}) {
  if (preferActual && actualLogisticsRub != null && actualLogisticsRub > 0) {
    return { rub: actualLogisticsRub, source: 'actual' };
  }

  const forward = forwardDelivery ?? baseDelivery;
  if (forward == null) return { rub: null, source: 'none' };

  return {
    rub: calcWbLogisticsPerUnit({
      forwardDelivery: forward,
      returnDelivery,
      buyoutRate,
      returnMarkup,
      useBuyoutWeighted,
    }),
    source: 'calculated',
  };
}



function calcStorageEstimate(volumeLiters, settings) {
  if (volumeLiters == null) return 0;

  const perDay =
    (settings.storageBasePerLiter + Math.max(0, volumeLiters - 1) * settings.storageAdditionalPerLiter) *
    settings.storageCoeff;

  return perDay * settings.storageDays;
}

function storageSettingsForInput(input, settings) {
  return {
    ...settings,
    storageBasePerLiter: hasOverride(input.storageBasePerLiter)
      ? num(input.storageBasePerLiter)
      : settings.storageBasePerLiter,
    storageAdditionalPerLiter: hasOverride(input.storageAdditionalPerLiter)
      ? num(input.storageAdditionalPerLiter)
      : settings.storageAdditionalPerLiter,
    storageCoeff: hasOverride(input.storageCoeff) ? num(input.storageCoeff) : settings.storageCoeff,
  };
}

function resolveStorageRub(input, settings, volumeLiters, preferActual) {
  if (!settings.includeStorage) {
    return { storageRub: 0, storageSource: 'off', storagePerDay: 0 };
  }

  const hasFboStock = num(input.stockFbo) > 0;
  const storageSettings = storageSettingsForInput(input, settings);

  if (preferActual && input.actualStorageRub != null && input.actualStorageRub > 0 && hasFboStock) {
    return {
      storageRub: input.actualStorageRub,
      storageSource: 'actual',
      storagePerDay: null,
    };
  }

  if (hasFboStock && volumeLiters != null && volumeLiters > 0) {
    const total = calcStorageEstimate(volumeLiters, storageSettings);
    const perDay = total / settings.storageDays;
    return {
      storageRub: total,
      storageSource: 'calculated',
      storagePerDay: perDay,
    };
  }

  return { storageRub: 0, storageSource: 'no_stock', storagePerDay: 0 };
}



/** Одна строка юнит-экономики с полным разложением расходов. */

export function calculateUnitEconomicsRow(input, settingsInput = {}) {

  const settings = mergeUnitSettings(settingsInput);



  const purchasePrice = num(input.purchasePrice);

  const salePrice = num(input.salePrice);

  const basePrice = num(input.basePrice) || salePrice;

  const ourPrice = num(input.ourPrice) || salePrice;



  const packagingCost = hasOverride(input.packagingCost)

    ? num(input.packagingCost)

    : settings.defaultPackagingCost;



  const warehouseCoeff =

    input.warehouseCoeff != null && input.warehouseCoeff !== ''

      ? num(input.warehouseCoeff)

      : settings.defaultWarehouseCoeff;



  const lengthCm = num(input.lengthCm);

  const widthCm = num(input.widthCm);

  const heightCm = num(input.heightCm);



  const volumeLiters =
    lengthCm > 0 && widthCm > 0 && heightCm > 0
      ? (lengthCm * widthCm * heightCm) / 1000
      : null;

  const billedLiters = billingLiters(volumeLiters);

  const logisticsFirst =
    pickTariffNumber(input, 'logisticsFirstLiter', settings, 'logisticsFirstLiter') ??
    settings.logisticsFirstLiter;
  const logisticsExtra =
    pickTariffNumber(input, 'logisticsAdditionalLiter', settings, 'logisticsAdditionalLiter') ??
    settings.logisticsAdditionalLiter;

  const fboForwardDelivery = calcWbForwardDelivery(
    volumeLiters,
    logisticsFirst,
    logisticsExtra,
    warehouseCoeff
  );
  const fboReturnDelivery = calcWbReturnDelivery(volumeLiters, logisticsFirst, logisticsExtra);

  const fbsFirst =
    pickTariffNumber(input, 'fbsFirstLiter', settings, 'fbsFirstLiter') ??
    settings.fbsFirstLiter ??
    logisticsFirst;
  const fbsExtra =
    pickTariffNumber(input, 'fbsAdditionalLiter', settings, 'fbsAdditionalLiter') ??
    settings.fbsAdditionalLiter ??
    logisticsExtra;
  const fbsCoeff =
    pickTariffNumber(input, 'fbsCoeff', settings, 'fbsCoeff') ?? settings.fbsCoeff ?? 1;
  const fbsForwardDelivery = calcWbForwardDelivery(volumeLiters, fbsFirst, fbsExtra, fbsCoeff);
  const fbsReturnDelivery = calcWbReturnDelivery(volumeLiters, fbsFirst, fbsExtra);

  const subLiterTariff = volumeLiters != null && !isOverOneLiter(volumeLiters) ? subLiterTierFlatRub(volumeLiters) : null;



  const fboBuyoutRate = resolveBuyoutRate(input.buyoutRateFbo, input.buyoutRate);
  const fbsBuyoutRate = resolveBuyoutRate(input.buyoutRateFbs, input.buyoutRate);
  const buyoutFromReport =
    (input.buyoutRateFbs != null && input.buyoutRateFbs !== '') ||
    (input.buyoutRateFbo != null && input.buyoutRateFbo !== '') ||
    (input.buyoutRate != null && input.buyoutRate !== '' && num(input.reportSales) > 0);

  const preferActual = settings.preferActualRates;



  // Для сравнения FBO/FBS — только расчёт по тарифам WB (как в Google-таблице).
  // Факт из отчёта реализации смешивает FBO/FBS и занижает FBO относительно FBS.
  const fboLogistics = calcLogisticsCost({
    forwardDelivery: fboForwardDelivery,
    returnDelivery: fboReturnDelivery,
    buyoutRate: fboBuyoutRate,
    returnMarkup: settings.returnLogisticsMarkup,
    useBuyoutWeighted: settings.useBuyoutWeightedLogistics,
    actualLogisticsRub: input.actualLogisticsRub,
    preferActual: false,
  });

  const logisticsFbo = fboLogistics.rub;
  const logisticsFboSource = fboLogistics.source;

  const fbsLogistics = calcLogisticsCost({
    forwardDelivery: fbsForwardDelivery,
    returnDelivery: fbsReturnDelivery,
    buyoutRate: fbsBuyoutRate,
    returnMarkup: settings.returnLogisticsMarkup,
    useBuyoutWeighted: settings.useBuyoutWeightedLogistics,
    actualLogisticsRub: input.actualFbsLogisticsRub,
    preferActual: false,
  });

  const logisticsFbs = fbsLogistics.rub;
  const logisticsFbsSource =
    preferActual && (input.actualLogisticsRubFbs ?? input.actualLogisticsRub) > 0
      ? 'actual_available'
      : fbsLogistics.source;



  const { storageRub, storageSource, storagePerDay } = resolveStorageRub(

    input,

    settings,

    volumeLiters,

    preferActual

  );



  const { usnRub, vatRub, taxRub } = computeSalesTaxes(salePrice, settings);



  const fboCategoryRate = num(input.fboCategoryRate) || 0.245;

  const fbsAvgDeliveryHours =

    input.fbsAvgDeliveryHours != null && input.fbsAvgDeliveryHours !== ''

      ? num(input.fbsAvgDeliveryHours)

      : settings.fbsAvgDeliveryHours;



  const {
    fbsCategoryRate,
    fbsDeliverySurcharge,
    fbsCategorySource,
  } = resolveFbsCategoryRate({
    fbsCategoryRate: input.fbsCategoryRate,
    fboCategoryRate,
    avgDeliveryHours: fbsAvgDeliveryHours,
    fbsCommissionMarkup: settings.fbsCommissionMarkup,
  });



  const fboTotalRate = fboCategoryRate + settings.extraCommissionRate;

  const fbsTotalRate = fbsCategoryRate + settings.extraCommissionRate;

  const fboCommissionRub = salePrice * fboTotalRate;

  const fbsCommissionRub = salePrice * fbsTotalRate;



  const defectRub = purchasePrice > 0 ? purchasePrice * settings.defectRate : 0;



  const acquiringRate =
    preferActual && positiveRate(input.acquiringRate) != null
      ? positiveRate(input.acquiringRate)
      : settings.acquiringRate;

  const retailPricePerUnit = num(input.retailPricePerUnit);
  const buyerPaidPrice =
    retailPricePerUnit > 0 ? retailPricePerUnit : ourPrice > 0 ? ourPrice : salePrice;

  let acquiringRub = 0;
  let acquiringSource = 'estimated';

  if (settings.includeAcquiring) {
    if (preferActual && input.actualAcquiringRub != null && input.actualAcquiringRub > 0) {
      acquiringRub = input.actualAcquiringRub;
      acquiringSource = 'actual';
    } else {
      acquiringRub = buyerPaidPrice * acquiringRate;
      acquiringSource = retailPricePerUnit > 0 ? 'retail-rate' : 'estimated';
    }
  }



  const acceptanceRub = settings.includeAcceptance

    ? preferActual && input.actualAcceptanceRub > 0

      ? input.actualAcceptanceRub

      : settings.acceptanceCostPerUnit

    : 0;



  let processingRub = 0;

  if (settings.includeProcessing) {

    if (hasOverride(input.processingCostOverride)) {

      processingRub = num(input.processingCostOverride);

    } else if (preferActual && input.actualProcessingRub > 0) {

      processingRub = input.actualProcessingRub;

    } else {

      processingRub = settings.processingCostPerUnit;

    }

  }



  const articleDrr = positiveRate(input.advertisingDrr);
  const advertisingDrr = settings.includeAdvertising ? articleDrr : null;
  const advertisingRub =
    settings.includeAdvertising && articleDrr != null ? salePrice * articleDrr : 0;



  const manualExtraCosts = hasOverride(input.manualExtraCosts) ? num(input.manualExtraCosts) : 0;



  const discountPct =

    basePrice > 0 && ourPrice > 0 && basePrice > ourPrice ? 1 - ourPrice / basePrice : null;

  const sppPct = salePrice > 0 && ourPrice > 0 ? 1 - ourPrice / salePrice : null;



  const extraCostsFbo =

    acquiringRub + storageRub + acceptanceRub + processingRub + advertisingRub + manualExtraCosts;

  const extraCostsFbs =

    acquiringRub + acceptanceRub + processingRub + advertisingRub + manualExtraCosts;



  let profitFbo = null;

  let profitFbs = null;

  let marginFbo = null;

  let marginFbs = null;

  let profitabilityFbo = null;

  let profitabilityFbs = null;



  if (salePrice > 0 && logisticsFbo != null) {

    profitFbo =

      salePrice -

      purchasePrice -

      fboCommissionRub -

      taxRub -

      packagingCost -

      defectRub -

      logisticsFbo -

      extraCostsFbo;

    profitFbs =

      salePrice -

      purchasePrice -

      fbsCommissionRub -

      taxRub -

      packagingCost -

      defectRub -

      (logisticsFbs ?? 0) -

      extraCostsFbs;

    marginFbo = profitFbo / salePrice;

    marginFbs = profitFbs / salePrice;

    profitabilityFbo = purchasePrice > 0 ? profitFbo / purchasePrice : null;

    profitabilityFbs = purchasePrice > 0 ? profitFbs / purchasePrice : null;

  }

  const logisticsCompare = compareLogisticsToActual(
    {
      logisticsFbo,
      logisticsFbs,
      baseDelivery: fboForwardDelivery,
      fbsBaseDelivery: fbsForwardDelivery,
      returnDeliveryFbo: fboReturnDelivery,
      returnDeliveryFbs: fbsReturnDelivery,
      volumeLiters,
      stockFbo: num(input.stockFbo),
      stockFbs: num(input.stockFbs),
    },
    actualStatsFromRow(input),
    settings
  );

  return {

    ...input,

    purchasePrice: purchasePrice || null,

    salePrice: salePrice || null,

    basePrice,

    ourPrice,

    packagingCost,

    warehouseCoeff,

    fboWarehouseName: input.fboWarehouseName || '',

    fbsWarehouseName: input.fbsWarehouseName || '',

    fbsCoeff,

    volumeLiters,

    billedLiters,

    buyoutRate: fbsBuyoutRate,
    buyoutRateFbs: fbsBuyoutRate,
    buyoutRateFbo: fboBuyoutRate,
    buyoutFromReport,

    fbsAvgDeliveryHours: fbsAvgDeliveryHours || null,

    fbsDeliverySurcharge,

    fbsCategorySource,

    actualLogisticsRub: input.actualLogisticsRub ?? null,

    baseDelivery: fboForwardDelivery,

    fbsBaseDelivery: fbsForwardDelivery,

    returnDeliveryFbo: fboReturnDelivery,

    returnDeliveryFbs: fbsReturnDelivery,

    subLiterTariff,

    logisticsFbo,

    logisticsFbs,

    logisticsFboSource,

    logisticsFbsSource,

    logisticsCompare,

    reportSales: input.reportSales ?? null,

    reportReturns: input.reportReturns ?? null,

    reportSalesFbs: input.reportSalesFbs ?? null,

    reportSalesFbo: input.reportSalesFbo ?? null,

    reportRetailSum: input.reportRetailSum ?? null,

    reportForPayNet: input.reportForPayNet ?? null,

    reportCommissionRub: input.reportCommissionRub ?? null,

    reportAcquiringRub: input.reportAcquiringRub ?? null,

    reportLogisticsRub: input.reportLogisticsRub ?? null,

    reportStorageRub: input.reportStorageRub ?? null,

    reportAcceptanceRub: input.reportAcceptanceRub ?? null,

    reportProcessingRub: input.reportProcessingRub ?? null,

    reportPenaltyRub: input.reportPenaltyRub ?? null,

    reportDeductionRub: input.reportDeductionRub ?? null,

    reportAdditionalPaymentRub: input.reportAdditionalPaymentRub ?? null,
    reportRetailReturnSum: input.reportRetailReturnSum ?? null,

    storageRub,

    storageSource,

    storagePerDay,

    storageDays: settings.storageDays,

    taxRub,
    usnRub,
    vatRub,

    acquiringRate,
    acquiringBasePrice: buyerPaidPrice,
    acquiringSource,
    acquiringRub,

    acceptanceRub,

    processingRub,

    manualExtraCosts,

    advertisingDrr,

    advertisingRub,

    adSpend: input.adSpend ?? null,

    extraCosts: extraCostsFbo,

    extraCostsFbo,

    extraCostsFbs,

    fboCategoryRate,

    fbsCategoryRate,

    fboTotalRate,

    fbsTotalRate,

    fboCommissionRub,

    fbsCommissionRub,

    defectRub,

    discountPct,

    sppPct,

    profitFbo,

    profitFbs,

    marginFbo,

    marginFbs,

    profitabilityFbo,

    profitabilityFbs,

    costBreakdown: {

      purchase: purchasePrice,

      commissionFbo: fboCommissionRub,

      commissionFbs: fbsCommissionRub,

      tax: taxRub,
      usn: usnRub,
      vat: vatRub,

      packaging: packagingCost,

      defect: defectRub,

      logisticsFbo,

      logisticsFbs,

      acquiring: acquiringRub,

      storage: storageRub,

      acceptance: acceptanceRub,

      processing: processingRub,

      advertising: advertisingRub,

      manualExtra: manualExtraCosts,

    },

  };

}


