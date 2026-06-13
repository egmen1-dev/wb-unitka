import { mergeUnitSettings } from './unit-economics/settings.js';
import { articleDigitKey } from './unit-economics/article-match.js';
import { vendorLookupKeys } from './unit-economics/vendor-key.js';
import { computeSalesTaxes } from './unit-economics/tax.js';
import { lookupAdvertStat, lookupAdvertStatByVendor } from './wb-advert-stats.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function positiveRate(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function vendorStatKeys(vendorCode) {
  const keys = [...vendorLookupKeys(vendorCode)];
  const digit = articleDigitKey(vendorCode);
  if (digit.length >= 3) keys.push(digit);
  return [...new Set(keys.filter(Boolean))];
}

function lookupVendorReportStat(vendorCode, vendorSales) {
  if (!vendorCode || !vendorSales) return null;
  for (const key of vendorStatKeys(vendorCode)) {
    if (vendorSales[key]?.sales > 0) return vendorSales[key];
  }
  return null;
}

function resolveRowAdvertFields(row, meta, catalogNmId = 0) {
  let adSpend = num(row.adSpend);
  let advertisingDrr = positiveRate(row.advertisingDrr);

  const hint =
    lookupAdvertStat(meta?.advertByNmId, row.nmId, catalogNmId) ||
    lookupAdvertStatByVendor(meta?.advertByVendor, row.vendorCode);
  if (!adSpend && hint?.adSpend > 0) adSpend = hint.adSpend;
  if (!advertisingDrr && hint?.advertisingDrr > 0) advertisingDrr = hint.advertisingDrr;

  return { adSpend, advertisingDrr };
}

function mergeRowAdvertFields(enriched, originalRow, meta) {
  const catalogNmId = Number(originalRow?.nmId) || 0;
  const fromRow = resolveRowAdvertFields(
    {
      ...enriched,
      adSpend: enriched.adSpend ?? originalRow?.adSpend,
      advertisingDrr: enriched.advertisingDrr ?? originalRow?.advertisingDrr,
    },
    meta,
    catalogNmId
  );

  return {
    ...enriched,
    adSpend: fromRow.adSpend > 0 ? fromRow.adSpend : enriched.adSpend ?? originalRow?.adSpend ?? null,
    advertisingDrr: fromRow.advertisingDrr ?? enriched.advertisingDrr ?? originalRow?.advertisingDrr ?? null,
  };
}

/** Реклама: факт adSpend из API Продвижение, иначе ДРР × retail из отчёта. */
export function resolveFactualAdSpend(row, settingsInput, retailSum, meta = null, adContext = {}) {
  const settings = mergeUnitSettings(settingsInput);
  if (settings.includeAdvertising === false) {
    return { adRub: 0, advertisingDrr: null, adFromFact: false, adAllocated: false };
  }

  const catalogNmId = num(adContext.catalogNmId);
  const { adSpend, advertisingDrr: articleDrrFromRow } = resolveRowAdvertFields(row, meta, catalogNmId);

  if (adSpend > 0) {
    const apiDrr = articleDrrFromRow;
    const drr = apiDrr ?? (retailSum > 0 ? adSpend / retailSum : null);
    return {
      adRub: adSpend,
      advertisingDrr: drr,
      adFromFact: true,
      adAllocated: false,
    };
  }

  const defaultDrr = positiveRate(settings.advertisingDrr) ?? positiveRate(meta?.globalAdvertisingDrr);
  const drr = articleDrrFromRow ?? defaultDrr;
  if (drr != null) {
    return {
      adRub: retailSum > 0 ? retailSum * drr : 0,
      advertisingDrr: drr,
      adFromFact: false,
      adAllocated: false,
    };
  }

  const totalSpend = num(meta?.totalAdSpend);
  const retailPoolTotal = num(adContext.retailPoolTotal);
  if (totalSpend > 0 && retailSum > 0 && retailPoolTotal > 0) {
    const adRub = totalSpend * (retailSum / retailPoolTotal);
    return {
      adRub,
      advertisingDrr: adRub / retailSum,
      adFromFact: true,
      adAllocated: true,
    };
  }

  return { adRub: 0, advertisingDrr: null, adFromFact: false, adAllocated: false };
}

/** Подставляет продажи из отчёта WB по артикулу, если в строке их нет. */
export function applyVendorReportToRow(row, vendorSales) {
  if (num(row.reportSales) > 0 || !vendorSales) return row;
  const stat = lookupVendorReportStat(row.vendorCode, vendorSales);
  if (!stat) return row;

  const sales = num(stat.sales);
  const retailSum = num(stat.retailSum) || num(row.retailPricePerUnit) * sales;

  return {
    ...row,
    nmId: stat.reportNmId || row.nmId,
    reportSales: sales,
    reportReturns: stat.returns ?? row.reportReturns,
    reportRetailSum: retailSum,
    reportRetailReturnSum: stat.retailReturnSum,
    reportForPayNet: stat.forPayNet,
    reportCommissionRub: stat.commissionRubSum,
    reportAcquiringRub: stat.acquiringFeeSum,
    reportLogisticsRub: stat.deliveryRubSum,
    reportStorageRub: stat.storageFeeSum,
    reportAcceptanceRub: stat.acceptanceSum,
    reportProcessingRub: stat.processingSum,
    reportPenaltyRub: stat.penaltySum,
    reportDeductionRub: stat.deductionSum,
    reportAdditionalPaymentRub: stat.additionalPaymentSum,
  };
}

/**
 * Эквайринг уже учтён в ppvz_for_pay, если сумма «к перечислению» ≈ retail − комиссия − эквайринг.
 * Иначе вычитаем эквайринг отдельно (встречается в legacy Statistics).
 */
function acquiringAlreadyInForPay(retailSum, forPayNet, commissionRub, acquiringRub) {
  if (retailSum <= 0 || acquiringRub <= 0) return true;
  const expected = retailSum - commissionRub - acquiringRub;
  return Math.abs(forPayNet - expected) <= Math.max(100, retailSum * 0.03);
}

/** Фактические суммы из отчёта реализации WB за период синхронизации. */
export function buildFactualPnlRow(row, settingsInput = {}, meta = null, adContext = {}) {
  const settings = mergeUnitSettings(settingsInput);
  const sales = num(row.reportSales);
  if (sales <= 0) return null;

  const retailSum = num(row.reportRetailSum) || num(row.retailPricePerUnit) * sales;
  const retailReturnSum = num(row.reportRetailReturnSum);
  const taxBase = Math.max(0, retailSum - retailReturnSum);
  const commissionRub = num(row.reportCommissionRub);
  const acquiringRub = num(row.reportAcquiringRub);

  let forPayNet = num(row.reportForPayNet);
  if (!forPayNet && retailSum > 0) {
    forPayNet = retailSum - commissionRub;
    if (!acquiringAlreadyInForPay(retailSum, forPayNet, commissionRub, acquiringRub)) {
      forPayNet -= acquiringRub;
    }
  }

  const logisticsRub = num(row.reportLogisticsRub);
  const storageRub = num(row.reportStorageRub);
  const acceptanceRub = num(row.reportAcceptanceRub);
  const processingRub = num(row.reportProcessingRub);
  const penaltyRub = num(row.reportPenaltyRub);
  const deductionRub = num(row.reportDeductionRub);
  const additionalPaymentRub = num(row.reportAdditionalPaymentRub);

  const { adRub, advertisingDrr, adFromFact, adAllocated } = resolveFactualAdSpend(
    row,
    settings,
    retailSum,
    meta,
    adContext
  );

  const purchasePrice = num(row.purchasePrice);
  const cogsRub = purchasePrice > 0 ? purchasePrice * sales : 0;
  const { usnRub, vatRub, taxRub } = computeSalesTaxes(taxBase, settings);

  const wbServiceCharges =
    logisticsRub + storageRub + acceptanceRub + processingRub + penaltyRub + deductionRub;

  const acquiringExtra =
    settings.includeAcquiring !== false && !acquiringAlreadyInForPay(retailSum, forPayNet, commissionRub, acquiringRub)
      ? acquiringRub
      : 0;

  /** Чистое поступление от WB после всех удержаний отчёта (до закупки, налога и рекламы). */
  const wbNetPayout = forPayNet - wbServiceCharges - acquiringExtra + additionalPaymentRub;

  const profitRub = wbNetPayout - cogsRub - taxRub - adRub;

  const wbCosts =
    commissionRub +
    acquiringRub +
    logisticsRub +
    storageRub +
    acceptanceRub +
    processingRub +
    penaltyRub +
    deductionRub +
    adRub -
    additionalPaymentRub;

  return {
    nmId: row.nmId,
    vendorCode: row.vendorCode,
    brand: row.brand,
    title: row.title,
    sales,
    returns: num(row.reportReturns),
    retailSum,
    retailReturnSum,
    taxBase,
    forPayNet,
    commissionRub,
    acquiringRub,
    acquiringInForPay: acquiringExtra === 0,
    logisticsRub,
    storageRub,
    acceptanceRub,
    processingRub,
    penaltyRub,
    deductionRub,
    additionalPaymentRub,
    adRub,
    advertisingDrr,
    adFromFact,
    adAllocated,
    cogsRub,
    usnRub,
    vatRub,
    taxRub,
    wbCosts,
    wbNetPayout,
    profitRub,
    revenueAfterWb: wbNetPayout,
    marginPct: retailSum > 0 ? profitRub / retailSum : null,
    hasPurchase: purchasePrice > 0,
    profitPerUnit: sales > 0 ? profitRub / sales : null,
  };
}

export function buildFactualPnlReport(rows, settings = {}, meta = {}) {
  const vendorSales = meta?.realizationVendorSales || null;
  const prepared = [];
  let retailPoolTotal = 0;

  for (const row of rows) {
    const enriched = mergeRowAdvertFields(applyVendorReportToRow(row, vendorSales), row, meta);
    const sales = num(enriched.reportSales);
    if (sales <= 0) continue;
    const retailSum = num(enriched.reportRetailSum) || num(enriched.retailPricePerUnit) * sales;
    retailPoolTotal += retailSum;
    prepared.push({ sourceRow: row, enriched, retailSum });
  }

  const adContext = { retailPoolTotal };
  const items = [];
  const totals = {
    sales: 0,
    retailSum: 0,
    forPayNet: 0,
    commissionRub: 0,
    acquiringRub: 0,
    logisticsRub: 0,
    storageRub: 0,
    acceptanceRub: 0,
    processingRub: 0,
    penaltyRub: 0,
    deductionRub: 0,
    additionalPaymentRub: 0,
    adRub: 0,
    cogsRub: 0,
    usnRub: 0,
    vatRub: 0,
    taxRub: 0,
    profitRub: 0,
    wbNetPayout: 0,
    skuCount: 0,
    withPurchase: 0,
    withoutPurchase: 0,
    adFromFactCount: 0,
    adEstimatedCount: 0,
    adAllocatedCount: 0,
    withDrrCount: 0,
  };

  for (const { sourceRow, enriched } of prepared) {
    const item = buildFactualPnlRow(enriched, settings, meta, {
      ...adContext,
      catalogNmId: sourceRow.nmId,
    });
    if (!item) continue;
    items.push({ row: enriched, pnl: item });
    totals.sales += item.sales;
    totals.retailSum += item.retailSum;
    totals.forPayNet += item.forPayNet;
    totals.commissionRub += item.commissionRub;
    totals.acquiringRub += item.acquiringRub;
    totals.logisticsRub += item.logisticsRub;
    totals.storageRub += item.storageRub;
    totals.acceptanceRub += item.acceptanceRub;
    totals.processingRub += item.processingRub;
    totals.penaltyRub += item.penaltyRub;
    totals.deductionRub += item.deductionRub;
    totals.additionalPaymentRub += item.additionalPaymentRub;
    totals.adRub += item.adRub;
    totals.cogsRub += item.cogsRub;
    totals.usnRub = (totals.usnRub || 0) + item.usnRub;
    totals.vatRub = (totals.vatRub || 0) + item.vatRub;
    totals.taxRub += item.taxRub;
    totals.profitRub += item.profitRub;
    totals.wbNetPayout += item.wbNetPayout;
    totals.skuCount += 1;
    if (item.hasPurchase) totals.withPurchase += 1;
    else totals.withoutPurchase += 1;
    if (item.adRub > 0) {
      if (item.adFromFact && !item.adAllocated) totals.adFromFactCount += 1;
      else if (item.adAllocated) totals.adAllocatedCount += 1;
      else totals.adEstimatedCount += 1;
    }
    if (item.advertisingDrr != null) totals.withDrrCount += 1;
  }

  items.sort((a, b) => b.pnl.profitRub - a.pnl.profitRub);

  totals.marginPct = totals.retailSum > 0 ? totals.profitRub / totals.retailSum : null;
  totals.profitPerUnit = totals.sales > 0 ? totals.profitRub / totals.sales : null;
  totals.advertisingDrr = totals.retailSum > 0 && totals.adRub > 0 ? totals.adRub / totals.retailSum : null;

  const adDrrLabel =
    totals.advertisingDrr != null ? `Реклама · ДРР ${(totals.advertisingDrr * 100).toFixed(1)}%` : 'Реклама';

  const costBreakdown = [
    { key: 'cogs', label: 'Закупка', rub: totals.cogsRub, color: '#6366f1' },
    { key: 'commission', label: 'Комиссия WB', rub: totals.commissionRub, color: '#f59e0b' },
    { key: 'logistics', label: 'Логистика', rub: totals.logisticsRub, color: '#0ea5e9' },
    { key: 'usn', label: 'УСН', rub: totals.usnRub || 0, color: '#64748b' },
    { key: 'vat', label: 'НДС', rub: totals.vatRub || 0, color: '#475569' },
    { key: 'acquiring', label: 'Эквайринг', rub: totals.acquiringRub, color: '#8b5cf6' },
    {
      key: 'ad',
      label: adDrrLabel,
      rub: totals.adRub,
      color: '#ec4899',
      drrPct: totals.advertisingDrr,
    },
    { key: 'storage', label: 'Хранение', rub: totals.storageRub, color: '#14b8a6' },
    { key: 'acceptance', label: 'Приёмка', rub: totals.acceptanceRub, color: '#84cc16' },
    { key: 'processing', label: 'Обработка', rub: totals.processingRub, color: '#a3e635' },
    { key: 'penalty', label: 'Штрафы', rub: totals.penaltyRub, color: '#ef4444' },
    { key: 'deduction', label: 'Удержания', rub: totals.deductionRub, color: '#dc2626' },
  ].filter((x) => x.rub > 0);

  if (totals.additionalPaymentRub > 0) {
    costBreakdown.push({
      key: 'compensation',
      label: 'Компенсации WB',
      rub: -totals.additionalPaymentRub,
      color: '#10b981',
    });
  }

  const topProfit = items.filter((x) => x.pnl.profitRub > 0).slice(0, 5);
  const topLoss = [...items].sort((a, b) => a.pnl.profitRub - b.pnl.profitRub).filter((x) => x.pnl.profitRub < 0).slice(0, 5);

  return { items, totals, costBreakdown, topProfit, topLoss };
}
