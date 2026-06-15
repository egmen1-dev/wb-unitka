import {
  calcWbLogisticsPerUnit,
  calcWbLogisticsReportAligned,
  isOverOneLiter,
} from './wb-logistics.js';
import { DEFAULT_SCHEME, resolveScheme } from './unit-scheme.js';

const MATCH_THRESHOLD = 0.25;

export const MATCH_LABELS = {
  ok: { label: 'Сходится', hint: '±25%', tone: 'ok' },
  low: { label: 'Факт выше', hint: 'расчёт занижен', tone: 'low' },
  high: { label: 'Расчёт выше', hint: 'расчёт завышен', tone: 'high' },
};

function matchLevel(deltaPct) {
  if (Math.abs(deltaPct) <= MATCH_THRESHOLD) return 'ok';
  return deltaPct > 0 ? 'low' : 'high';
}

function volumeBand(volumeLiters) {
  if (volumeLiters == null || volumeLiters <= 0) return 'unknown';
  return volumeLiters <= 1 ? 'subLiter' : 'overLiter';
}

/**
 * Сверка расчётной логистики FBS с фактом из отчёта реализации.
 */
export function compareLogisticsToActual(row, actualStats, settings = {}) {
  const scheme = resolveScheme(settings);
  const actual =
    scheme === 'fbs'
      ? actualStats?.avgLogisticsRubFbs ?? actualStats?.avgLogisticsRub
      : actualStats?.avgLogisticsRubFbo ?? actualStats?.avgLogisticsRub;

  const forwardDelivery =
    scheme === 'fbs'
      ? row.fbsForwardForLogistics ?? row.fbsBaseDelivery
      : row.fboForwardForLogistics ?? row.baseDelivery;
  const forwardRaw =
    scheme === 'fbs' ? row.fbsBaseDelivery : row.baseDelivery;
  const returnDelivery = scheme === 'fbs' ? row.returnDeliveryFbs : row.returnDeliveryFbo;

  if (actual == null || actual <= 0 || forwardDelivery == null || forwardDelivery <= 0) return null;

  const buyout =
    scheme === 'fbs'
      ? actualStats?.buyoutRateFbs ?? actualStats?.buyoutRate ?? 1
      : actualStats?.buyoutRateFbo ?? actualStats?.buyoutRate ?? 1;

  const markup = settings.returnLogisticsMarkup ?? 0.0454;

  const calcSimple = calcWbLogisticsPerUnit({
    forwardDelivery,
    returnDelivery,
    buyoutRate: buyout,
    returnMarkup: markup,
    useBuyoutWeighted: false,
  });

  const calcReportAligned = calcWbLogisticsReportAligned({
    forwardDelivery,
    returnDelivery,
    buyoutRate: buyout,
    returnMarkup: markup,
  });

  const calcFromRow = scheme === 'fbs' ? row.logisticsFbs : row.logisticsFbo;
  const primaryCalc = calcReportAligned ?? calcFromRow;
  const delta = actual - primaryCalc;
  const deltaPct = delta / primaryCalc;

  const forwardPerSale =
    scheme === 'fbs'
      ? actualStats?.avgForwardLogisticsRubFbs ?? actualStats?.avgForwardLogisticsRub
      : actualStats?.avgForwardLogisticsRub;
  const returnPerSale =
    scheme === 'fbs'
      ? actualStats?.avgReturnLogisticsRubFbs ?? actualStats?.avgReturnLogisticsRub
      : actualStats?.avgReturnLogisticsRub;
  const actualDecomposed =
    forwardPerSale != null && returnPerSale != null ? forwardPerSale + returnPerSale : null;

  const reasons = [];
  const sales =
    scheme === 'fbs'
      ? actualStats?.salesFbs ?? actualStats?.sales ?? 0
      : actualStats?.salesFbo ?? actualStats?.sales ?? 0;

  if (sales < 3) reasons.push('мало продаж в отчёте (<3)');

  if (actualStats?.salesFbs > 0 && actualStats?.salesFbo > 0 && scheme === 'fbs') {
    reasons.push('в отчёте есть и FBS, и FBO продажи');
  }

  if (buyout < 0.75) {
    reasons.push(`низкий выкуп ${Math.round(buyout * 100)}%`);
  }

  if (row.logisticsIndicesApplied && row.salesDistributionIndex > 0) {
    reasons.push(`ИРП ${(row.salesDistributionIndex * 100).toFixed(2)}% в расчёте`);
  }
  if (row.logisticsIndicesApplied && row.localizationIndex != null && row.localizationIndex !== 1) {
    reasons.push(`ИЛ ×${Number(row.localizationIndex).toFixed(2)} в расчёте`);
  }

  if (row.volumeLiters != null && !isOverOneLiter(row.volumeLiters) && !row.logisticsIndicesApplied) {
    reasons.push('≤1 л — в факте могут быть ИЛ/ИРП');
  }

  if (actualStats?.otherLogisticsSum > 0 && (actualStats?.forwardLogisticsSumFbs ?? 0) === 0) {
    reasons.push('часть логистики без bonus_type_name в отчёте');
  }

  if (actualDecomposed != null && Math.abs(actual - actualDecomposed) / actual > 0.15) {
    reasons.push('в факте есть логистика вне прямой/обратной');
  }

  const simpleDelta = actual - calcSimple;
  if (Math.abs(simpleDelta) > Math.abs(delta)) {
    reasons.push('сверка по формуле отчёта (с выкупом), не ×1,045');
  }

  return {
    scheme,
    actual,
    calc: primaryCalc,
    calcSimple,
    calcReportAligned: primaryCalc,
    actualDecomposed,
    delta,
    deltaPct,
    deltaRub: delta,
    match: matchLevel(deltaPct),
    volumeBand: volumeBand(row.volumeLiters),
    reasons,
    sales,
    buyout,
    forwardPerSale,
    returnPerSale,
    forwardCalc: forwardDelivery,
    forwardRaw,
    logisticsIrpSurcharge: row.logisticsIrpSurcharge,
    localizationIndex: row.localizationIndex,
    salesDistributionIndex: row.salesDistributionIndex,
    returnCalc: returnDelivery,
    fbsCoeff: row.fbsCoeff,
    subLiterTariff: row.subLiterTariff,
    volumeLiters: row.volumeLiters,
  };
}

export function actualStatsFromRow(row) {
  const hasFbs = row.actualLogisticsRubFbs != null && row.actualLogisticsRubFbs > 0;
  const hasAny = row.actualLogisticsRub != null && row.actualLogisticsRub > 0;
  if (!hasFbs && !hasAny) return null;

  return {
    avgLogisticsRub: row.actualLogisticsRubAll ?? row.actualLogisticsRub,
    avgLogisticsRubFbs: row.actualLogisticsRubFbs ?? row.actualLogisticsRub,
    avgLogisticsRubFbo: row.actualLogisticsRubFbo,
    avgForwardLogisticsRub: row.actualForwardLogisticsRub,
    avgReturnLogisticsRub: row.actualReturnLogisticsRub,
    avgForwardLogisticsRubFbs: row.actualForwardLogisticsRubFbs,
    avgReturnLogisticsRubFbs: row.actualReturnLogisticsRubFbs,
    sales: row.reportSales,
    salesFbs: row.reportSalesFbs,
    salesFbo: row.reportSalesFbo,
    buyoutRate: row.buyoutRate,
    buyoutRateFbs: row.buyoutRateFbs,
    buyoutRateFbo: row.buyoutRateFbo,
    forwardLogisticsSum: row.reportForwardLogistics,
    returnLogisticsSum: row.reportReturnLogistics,
    otherLogisticsSum: row.reportOtherLogistics,
    forwardLogisticsSumFbs: row.reportForwardLogisticsFbs,
    returnLogisticsSumFbs: row.reportReturnLogisticsFbs,
  };
}

export function buildLogisticsReconciliation(rows, settings = {}) {
  const scheme = resolveScheme(settings);
  const items = [];
  let withActual = 0;
  let ok = 0;
  let calcLow = 0;
  let calcHigh = 0;
  const ratios = [];
  const reasonCounts = new Map();
  const bandStats = {
    subLiter: { total: 0, ok: 0, calcLow: 0, calcHigh: 0, ratios: [] },
    overLiter: { total: 0, ok: 0, calcLow: 0, calcHigh: 0, ratios: [] },
  };
  let salesWeightedDelta = 0;
  let salesWeight = 0;

  for (const row of rows) {
    const cmp = compareLogisticsToActual(row, actualStatsFromRow(row), settings);
    if (!cmp) continue;
    withActual += 1;
    const ratio = cmp.actual / cmp.calc;
    ratios.push(ratio);
    if (cmp.match === 'ok') ok += 1;
    else if (cmp.match === 'low') calcLow += 1;
    else calcHigh += 1;

    for (const reason of cmp.reasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }

    const band = cmp.volumeBand;
    if (bandStats[band]) {
      bandStats[band].total += 1;
      bandStats[band][cmp.match] += 1;
      bandStats[band].ratios.push(ratio);
    }

    if (cmp.sales > 0) {
      salesWeightedDelta += cmp.deltaPct * cmp.sales;
      salesWeight += cmp.sales;
    }

    items.push({ row, cmp });
  }

  items.sort((a, b) => Math.abs(b.cmp.deltaPct) - Math.abs(a.cmp.deltaPct));

  ratios.sort((a, b) => a - b);
  const medianRatio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;

  const withDims = rows.filter((r) => r.volumeLiters != null && r.volumeLiters > 0).length;
  const withoutActual = withDims - withActual;
  const totalReportSales = items.reduce((s, x) => s + (x.cmp.sales || 0), 0);

  function finalizeBand(band) {
    const r = [...band.ratios].sort((a, b) => a - b);
    return {
      total: band.total,
      ok: band.ok,
      calcLow: band.calcLow,
      calcHigh: band.calcHigh,
      okPct: band.total > 0 ? band.ok / band.total : 0,
      medianRatio: r.length ? r[Math.floor(r.length / 2)] : null,
    };
  }

  const topReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));

  return {
    scheme,
    withActual,
    withDims,
    withoutActual,
    totalReportSales,
    ok,
    calcLow,
    calcHigh,
    okPct: withActual > 0 ? ok / withActual : 0,
    medianRatio,
    salesWeightedDeltaPct: salesWeight > 0 ? salesWeightedDelta / salesWeight : null,
    items,
    topMismatches: items.filter((x) => x.cmp.match !== 'ok').slice(0, 15),
    closeMatches: items.filter((x) => x.cmp.match === 'ok').slice(0, 8),
    subLiter: items.filter((x) => x.cmp.volumeBand === 'subLiter'),
    overLiter: items.filter((x) => x.cmp.volumeBand === 'overLiter'),
    bandStats: {
      subLiter: finalizeBand(bandStats.subLiter),
      overLiter: finalizeBand(bandStats.overLiter),
    },
    topReasons,
  };
}

export { DEFAULT_SCHEME };
