import { withWbApiToken } from './wb-official-api.js';
import { classifyFulfillmentFromReport } from './wb-fulfillment.js';
import { articleDigitKey } from './unit-economics/article-match.js';
import { vendorLookupKeys } from './unit-economics/vendor-key.js';

const STATISTICS_API = 'https://statistics-api.wildberries.ru';
const FINANCE_API = 'https://finance-api.wildberries.ru';

function vendorIndexKeys(vendorCode) {
  const keys = [...vendorLookupKeys(vendorCode)];
  const digit = articleDigitKey(vendorCode);
  if (digit.length >= 3) keys.push(digit);
  return [...new Set(keys.filter(Boolean))];
}

/** Пауза между страницами отчёта — лимит WB 1 req/min на seller. */
const REPORT_PAGE_SLEEP_MS = 61_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function moscowDateRange(days) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { dateFrom: fmt.format(start), dateTo: fmt.format(end) };
}

function money(row, ...keys) {
  for (const key of keys) {
    if (row[key] != null && row[key] !== '') {
      const n = Number(row[key]);
      if (Number.isFinite(n)) return Math.abs(n);
    }
  }
  return 0;
}

function normalizeReportRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return null;
}

function rowOperName(row) {
  return String(row.supplier_oper_name || row.sellerOperName || row.doc_type_name || row.docTypeName || '')
    .trim()
    .toLowerCase();
}

function rowNmId(row) {
  return Number(row.nm_id ?? row.nmId) || 0;
}

function rowVendorCode(row) {
  return String(
    row.vendor_code ??
      row.vendorCode ??
      row.sa_name ??
      row.saName ??
      row.supplier_article ??
      row.supplierArticle ??
      ''
  ).trim();
}

function rowRrdId(row) {
  return Number(row.rrd_id ?? row.rrdId) || 0;
}

function logisticsRowRub(row) {
  return (
    money(row, 'delivery_rub', 'deliveryRub') +
    money(row, 'rebill_logistic_cost', 'rebillLogisticCost') +
    money(row, 'delivery_service', 'deliveryService')
  );
}

function fulfillmentRow(row) {
  return {
    ...row,
    delivery_method: row.delivery_method || row.deliveryMethod || '',
    assembly_id: row.assembly_id ?? row.assemblyId,
    gi_id: row.gi_id ?? row.giId,
  };
}

/** Классификация строки «Логистика» по bonus_type_name из отчёта WB. */
export function classifyLogisticsRow(row) {
  const bonus = String(row.bonus_type_name || row.bonusTypeName || '').toLowerCase().trim();
  if (!bonus) return 'other';
  if (bonus.includes('к клиенту')) return 'forward';
  if (bonus.includes('от клиента') || bonus.includes('возврат')) return 'return';
  return 'other';
}

function emptySchemeBucket() {
  return {
    sales: 0,
    returns: 0,
    deliveryRubSum: 0,
    forwardLogisticsSum: 0,
    returnLogisticsSum: 0,
    otherLogisticsSum: 0,
    logisticsEvents: 0,
  };
}

function emptyStat() {
  return {
    sales: 0,
    returns: 0,
    retailSum: 0,
    retailReturnSum: 0,
    forPaySalesSum: 0,
    forPayReturnsSum: 0,
    commissionRubSum: 0,
    acquiringFeeSum: 0,
    deliveryRubSum: 0,
    forwardLogisticsSum: 0,
    returnLogisticsSum: 0,
    otherLogisticsSum: 0,
    logisticsEvents: 0,
    storageFeeSum: 0,
    acceptanceSum: 0,
    processingSum: 0,
    penaltySum: 0,
    deductionSum: 0,
    additionalPaymentSum: 0,
    commissionWeighted: 0,
    vendorCode: '',
    fbs: emptySchemeBucket(),
    fbo: emptySchemeBucket(),
    unknown: emptySchemeBucket(),
  };
}

function addSale(bucket, qty) {
  bucket.sales += qty;
}

function addReturn(bucket, qty) {
  bucket.returns += qty;
}

function addLogistics(bucket, row, rub) {
  bucket.deliveryRubSum += rub;
  bucket.logisticsEvents += 1;
  const kind = classifyLogisticsRow(row);
  if (kind === 'forward') bucket.forwardLogisticsSum += rub;
  else if (kind === 'return') bucket.returnLogisticsSum += rub;
  else bucket.otherLogisticsSum += rub;
}

function finalizeSchemeBucket(bucket) {
  const buyoutRate =
    bucket.sales + bucket.returns > 0 ? bucket.sales / (bucket.sales + bucket.returns) : null;

  return {
    buyoutRate,
    sales: bucket.sales,
    returns: bucket.returns,
    deliveryRubSum: bucket.deliveryRubSum,
    forwardLogisticsSum: bucket.forwardLogisticsSum,
    returnLogisticsSum: bucket.returnLogisticsSum,
    otherLogisticsSum: bucket.otherLogisticsSum,
    logisticsEvents: bucket.logisticsEvents,
    avgLogisticsRub: bucket.sales > 0 ? bucket.deliveryRubSum / bucket.sales : null,
    avgForwardLogisticsRub: bucket.sales > 0 ? bucket.forwardLogisticsSum / bucket.sales : null,
    avgReturnLogisticsRub: bucket.sales > 0 ? bucket.returnLogisticsSum / bucket.sales : null,
  };
}

function ingestReportRow(row, byNm, counters) {
  const nmId = rowNmId(row);
  if (!nmId) return;

  let stat = byNm.get(nmId);
  if (!stat) {
    stat = emptyStat();
    byNm.set(nmId, stat);
  }

  const vendor = rowVendorCode(row);
  if (vendor && !stat.vendorCode) stat.vendorCode = vendor;

  const operRaw = rowOperName(row);
  const qty = Math.abs(Number(row.quantity) || 0) || 1;
  let scheme = classifyFulfillmentFromReport(fulfillmentRow(row));
  if (scheme === 'unknown' && operRaw === 'логистика') {
    if (stat.fbs.sales > 0 && stat.fbo.sales === 0) scheme = 'fbs';
    else if (stat.fbo.sales > 0 && stat.fbs.sales === 0) scheme = 'fbo';
  }
  const schemeBucket = stat[scheme] || stat.unknown;

  const retailAmount = money(row, 'retail_amount', 'retailAmount');
  const docType = String(row.doc_type_name || row.docTypeName || '')
    .trim()
    .toLowerCase();
  const isSale = operRaw === 'продажа' || docType === 'продажа';
  const isReturn = operRaw === 'возврат' || docType === 'возврат';
  const isLogistics = operRaw === 'логистика';
  const isStorage = operRaw === 'хранение';

  if (isSale && retailAmount > 0) {
    counters.salesRows += 1;
    stat.sales += qty;
    addSale(schemeBucket, qty);
    stat.retailSum += retailAmount;
    stat.forPaySalesSum += money(row, 'ppvz_for_pay', 'forPay');
    stat.commissionRubSum += money(row, 'ppvz_sales_commission', 'ppvzSalesCommission');
    stat.acquiringFeeSum += money(row, 'acquiring_fee', 'acquiringFee');
    stat.commissionWeighted +=
      (Number(row.commission_percent ?? row.commissionPercent) || 0) * retailAmount;
  }

  if (isReturn) {
    stat.returns += qty;
    addReturn(schemeBucket, qty);
    stat.forPayReturnsSum += money(row, 'ppvz_for_pay', 'forPay');
    stat.retailReturnSum += money(row, 'retail_amount', 'retailAmount');
  }

  if (isLogistics) {
    const rub = logisticsRowRub(row);
    stat.deliveryRubSum += rub;
    stat.logisticsEvents += 1;
    addLogistics(schemeBucket, row, rub);

    const kind = classifyLogisticsRow(row);
    if (kind === 'forward') stat.forwardLogisticsSum += rub;
    else if (kind === 'return') stat.returnLogisticsSum += rub;
    else stat.otherLogisticsSum += rub;
  }

  if (isStorage) {
    stat.storageFeeSum += money(row, 'storage_fee', 'paidStorage');
  }

  if (operRaw === 'платная приемка' || operRaw === 'платная приёмка') {
    stat.acceptanceSum += money(row, 'acceptance', 'paidAcceptance');
  }

  if (operRaw === 'обработка товара') {
    stat.processingSum += money(row, 'acceptance', 'paidAcceptance', 'delivery_rub', 'deliveryRub', 'deliveryService');
  }

  stat.penaltySum += money(row, 'penalty');
  stat.deductionSum += money(row, 'deduction');
  stat.additionalPaymentSum += money(row, 'additional_payment', 'additionalPayment');

  counters.reportRowCount += 1;
}

function finalizeNmStats(byNm) {
  const result = new Map();
  let globalAcquiring = 0;
  let globalRetail = 0;

  for (const [nmId, stat] of byNm) {
    const buyoutRate =
      stat.sales + stat.returns > 0 ? stat.sales / (stat.sales + stat.returns) : null;

    const acquiringRate =
      stat.retailSum > 0 && stat.acquiringFeeSum > 0
        ? stat.acquiringFeeSum / stat.retailSum
        : null;

    const fbs = finalizeSchemeBucket(stat.fbs);
    const fbo = finalizeSchemeBucket(stat.fbo);

    if (stat.retailSum > 0 && stat.acquiringFeeSum > 0) {
      globalAcquiring += stat.acquiringFeeSum;
      globalRetail += stat.retailSum;
    }

    const forPayNet = stat.forPaySalesSum - stat.forPayReturnsSum;
    const commissionRub =
      stat.commissionRubSum > 0
        ? stat.commissionRubSum
        : stat.retailSum > 0
          ? stat.commissionWeighted / 100
          : 0;

    result.set(nmId, {
      reportNmId: nmId,
      vendorCode: stat.vendorCode || '',
      buyoutRate,
      buyoutRateFbs: fbs.buyoutRate,
      buyoutRateFbo: fbo.buyoutRate,
      acquiringRate,
      avgAcquiringRub: stat.sales > 0 ? stat.acquiringFeeSum / stat.sales : null,
      retailPricePerUnit: stat.sales > 0 ? stat.retailSum / stat.sales : null,
      avgLogisticsRub: stat.sales > 0 ? stat.deliveryRubSum / stat.sales : null,
      avgLogisticsRubFbs: fbs.avgLogisticsRub,
      avgLogisticsRubFbo: fbo.avgLogisticsRub,
      avgForwardLogisticsRub: stat.sales > 0 ? stat.forwardLogisticsSum / stat.sales : null,
      avgReturnLogisticsRub: stat.sales > 0 ? stat.returnLogisticsSum / stat.sales : null,
      avgForwardLogisticsRubFbs: fbs.avgForwardLogisticsRub,
      avgReturnLogisticsRubFbs: fbs.avgReturnLogisticsRub,
      avgStorageRub: stat.sales > 0 ? stat.storageFeeSum / stat.sales : null,
      avgAcceptanceRub: stat.sales > 0 ? stat.acceptanceSum / stat.sales : null,
      avgProcessingRub: stat.sales > 0 ? stat.processingSum / stat.sales : null,
      avgCommissionPct:
        stat.retailSum > 0 ? stat.commissionWeighted / stat.retailSum / 100 : null,
      sales: stat.sales,
      salesFbs: fbs.sales,
      salesFbo: fbo.sales,
      returns: stat.returns,
      retailSum: stat.retailSum,
      retailReturnSum: stat.retailReturnSum,
      retailSumNet: Math.max(0, stat.retailSum - stat.retailReturnSum),
      forPayNet,
      forPaySalesSum: stat.forPaySalesSum,
      forPayReturnsSum: stat.forPayReturnsSum,
      commissionRubSum: commissionRub,
      acquiringFeeSum: stat.acquiringFeeSum,
      deliveryRubSum: stat.deliveryRubSum,
      storageFeeSum: stat.storageFeeSum,
      acceptanceSum: stat.acceptanceSum,
      processingSum: stat.processingSum,
      penaltySum: stat.penaltySum,
      deductionSum: stat.deductionSum,
      additionalPaymentSum: stat.additionalPaymentSum,
      deliveryRubSumFbs: fbs.deliveryRubSum,
      deliveryRubSumFbo: fbo.deliveryRubSum,
      forwardLogisticsSum: stat.forwardLogisticsSum,
      returnLogisticsSum: stat.returnLogisticsSum,
      otherLogisticsSum: stat.otherLogisticsSum,
      forwardLogisticsSumFbs: fbs.forwardLogisticsSum,
      returnLogisticsSumFbs: fbs.returnLogisticsSum,
      logisticsEvents: stat.logisticsEvents,
      logisticsEventsFbs: fbs.logisticsEvents,
    });
  }

  return { byNmId: result, globalAcquiringRate: globalRetail > 0 ? globalAcquiring / globalRetail : null };
}

const VENDOR_MERGE_NUMERIC = [
  'sales',
  'returns',
  'retailSum',
  'retailReturnSum',
  'forPaySalesSum',
  'forPayReturnsSum',
  'commissionRubSum',
  'acquiringFeeSum',
  'deliveryRubSum',
  'storageFeeSum',
  'acceptanceSum',
  'processingSum',
  'penaltySum',
  'deductionSum',
  'additionalPaymentSum',
  'forwardLogisticsSum',
  'returnLogisticsSum',
  'otherLogisticsSum',
  'logisticsEvents',
  'salesFbs',
  'salesFbo',
  'deliveryRubSumFbs',
  'deliveryRubSumFbo',
  'forwardLogisticsSumFbs',
  'returnLogisticsSumFbs',
  'logisticsEventsFbs',
];

function mergeFinalizedStats(into, add) {
  const merged = { ...into };
  for (const key of VENDOR_MERGE_NUMERIC) {
    merged[key] = (Number(into[key]) || 0) + (Number(add[key]) || 0);
  }

  merged.forPayNet = merged.forPaySalesSum - merged.forPayReturnsSum;
  merged.buyoutRate =
    merged.sales + merged.returns > 0 ? merged.sales / (merged.sales + merged.returns) : null;
  merged.acquiringRate =
    merged.retailSum > 0 && merged.acquiringFeeSum > 0
      ? merged.acquiringFeeSum / merged.retailSum
      : null;
  merged.retailPricePerUnit = merged.sales > 0 ? merged.retailSum / merged.sales : null;
  merged.avgLogisticsRub = merged.sales > 0 ? merged.deliveryRubSum / merged.sales : null;
  merged.avgForwardLogisticsRub = merged.sales > 0 ? merged.forwardLogisticsSum / merged.sales : null;
  merged.avgReturnLogisticsRub = merged.sales > 0 ? merged.returnLogisticsSum / merged.sales : null;
  merged.avgStorageRub = merged.sales > 0 ? merged.storageFeeSum / merged.sales : null;
  merged.avgAcceptanceRub = merged.sales > 0 ? merged.acceptanceSum / merged.sales : null;
  merged.avgProcessingRub = merged.sales > 0 ? merged.processingSum / merged.sales : null;
  merged.avgAcquiringRub = merged.sales > 0 ? merged.acquiringFeeSum / merged.sales : null;
  merged.avgLogisticsRubFbs = merged.salesFbs > 0 ? merged.deliveryRubSumFbs / merged.salesFbs : null;
  merged.avgLogisticsRubFbo = merged.salesFbo > 0 ? merged.deliveryRubSumFbo / merged.salesFbo : null;
  merged.avgForwardLogisticsRubFbs =
    merged.salesFbs > 0 ? merged.forwardLogisticsSumFbs / merged.salesFbs : null;
  merged.avgReturnLogisticsRubFbs =
    merged.salesFbs > 0 ? merged.returnLogisticsSumFbs / merged.salesFbs : null;

  return merged;
}

function buildVendorIndex(byNm, byNmId) {
  return rebuildVendorIndexFromFinalized(byNmId, byNm);
}

export function rebuildVendorIndexFromFinalized(byNmId, rawByNm = null) {
  const byVendor = new Map();

  for (const [nmId, finalized] of byNmId) {
    const vendorCode = finalized.vendorCode || rawByNm?.get(nmId)?.vendorCode || '';
    if (!vendorCode) continue;

    const withNmId = { ...finalized, reportNmId: nmId, vendorCode };
    for (const key of vendorIndexKeys(vendorCode)) {
      const prev = byVendor.get(key);
      byVendor.set(key, prev ? mergeFinalizedStats(prev, withNmId) : withNmId);
    }
  }

  return byVendor;
}

function summarizeSales(byNm) {
  let skuWithSales = 0;
  let totalSales = 0;
  for (const stat of byNm.values()) {
    if (stat.sales > 0) {
      skuWithSales += 1;
      totalSales += stat.sales;
    }
  }
  return { skuWithSales, totalSales };
}

async function fetchReportJson(url, { token, method = 'GET', body = null, retries = 4 }) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: token,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204) {
      return { status: 204, rows: [], error: null };
    }

    if (response.status === 429 || response.status === 461) {
      if (attempt < retries - 1) {
        await sleep(Math.min(30_000, 2000 * 2 ** attempt));
        continue;
      }
      const text = await response.text().catch(() => '');
      return {
        status: response.status,
        rows: [],
        error: `Лимит WB на отчёт реализации (429) — подождите 1–2 мин: ${text.slice(0, 120)}`,
      };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let error = `Statistics/Finance API ${response.status}: ${text.slice(0, 160)}`;
      if (response.status === 401 || response.status === 403) {
        error =
          response.status === 401 || response.status === 403
            ? 'Нет доступа к отчёту реализации — включите категории Finance и/или Statistics в токене WB'
            : error;
      }
      return { status: response.status, rows: [], error };
    }

    const payload = await response.json();
    const rows = normalizeReportRows(payload);
    if (!rows) {
      return { status: response.status, rows: [], error: 'Неверный формат отчёта WB' };
    }
    return { status: response.status, rows, error: null };
  }

  return { status: 0, rows: [], error: 'Не удалось загрузить отчёт реализации' };
}

/**
 * Еженедельные отчёты реализации — тот же раздел, что в ЛК:
 * seller.wildberries.ru/.../reports-implementations/reports-weekly-new
 */
async function loadFinanceWeeklyReport(token, { dateFrom, dateTo, maxPages }) {
  const byNm = new Map();
  const counters = { reportRowCount: 0, salesRows: 0 };
  let rrdId = 0;
  let lastError = null;
  const pageLimit = 100_000;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchReportJson(`${FINANCE_API}/api/finance/v1/sales-reports/detailed`, {
      token,
      method: 'POST',
      body: {
        dateFrom,
        dateTo,
        limit: pageLimit,
        rrdId,
        period: 'weekly',
      },
    });

    if (result.error && counters.reportRowCount === 0) {
      return { ...result, source: 'finance-weekly', byNm, counters, partial: false };
    }
    if (result.error) {
      lastError = result.error;
      break;
    }
    if (result.status === 204 || !result.rows.length) break;

    for (const row of result.rows) {
      ingestReportRow(row, byNm, counters);
    }

    rrdId = rowRrdId(result.rows[result.rows.length - 1]);
    if (result.rows.length < pageLimit) break;
    if (page + 1 < maxPages) await sleep(REPORT_PAGE_SLEEP_MS);
  }

  return {
    status: 200,
    rows: [],
    error: lastError,
    source: 'finance-weekly',
    byNm,
    counters,
    partial: Boolean(lastError && counters.reportRowCount > 0),
  };
}

/** Legacy Statistics API (deprecated, fallback). */
async function loadStatisticsV5Report(token, { dateFrom, dateTo, maxPages }) {
  const byNm = new Map();
  const counters = { reportRowCount: 0, salesRows: 0 };
  let rrdid = 0;
  let lastError = null;
  const pageLimit = 5000;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL('/api/v5/supplier/reportDetailByPeriod', STATISTICS_API);
    url.searchParams.set('dateFrom', dateFrom);
    url.searchParams.set('dateTo', dateTo);
    url.searchParams.set('limit', String(pageLimit));
    url.searchParams.set('rrdid', String(rrdid));

    const result = await fetchReportJson(url.toString(), { token });

    if (result.error && counters.reportRowCount === 0) {
      return { ...result, source: 'statistics-v5', byNm, counters, partial: false };
    }
    if (result.error) {
      lastError = result.error;
      break;
    }
    if (result.status === 204 || !result.rows.length) break;

    for (const row of result.rows) {
      ingestReportRow(row, byNm, counters);
    }

    rrdid = rowRrdId(result.rows[result.rows.length - 1]);
    if (result.rows.length < pageLimit) break;
    if (page + 1 < maxPages) await sleep(REPORT_PAGE_SLEEP_MS);
  }

  return {
    status: 200,
    rows: [],
    error: lastError,
    source: 'statistics-v5',
    byNm,
    counters,
    partial: Boolean(lastError && counters.reportRowCount > 0),
  };
}

function buildResultPayload({ dateFrom, dateTo, source, byNm, counters, error, partial, financeWarning = null }) {
  const { byNmId, globalAcquiringRate } = finalizeNmStats(byNm);
  const byVendorCode = buildVendorIndex(byNm, byNmId);
  const { skuWithSales, totalSales } = summarizeSales(byNm);

  let resultError = error || null;
  if (!resultError && counters.reportRowCount === 0) {
    resultError = 'Отчёт реализации пуст за выбранный период';
  } else if (partial) {
    resultError = `${error}. Загружена часть строк (${counters.reportRowCount}) — повторите «Быстро» через 1–2 мин`;
  }

  return {
    byNmId,
    byVendorCode,
    globalAcquiringRate,
    period: counters.reportRowCount > 0 ? { dateFrom, dateTo } : null,
    error: resultError,
    rowCount: counters.reportRowCount,
    salesRows: counters.salesRows,
    skuWithSales,
    totalSales,
    source,
    financeWarning,
  };
}

/** Агрегирует фактические ставки из отчёта реализации за период (в т.ч. FBS отдельно). */
export async function fetchNmRealizationStats(token, { days = 30, maxPages = 8 } = {}) {
  return withWbApiToken(token, async () => {
    const { dateFrom, dateTo } = moscowDateRange(days);

    const finance = await loadFinanceWeeklyReport(token, { dateFrom, dateTo, maxPages });
    if (finance.counters.reportRowCount > 0) {
      return buildResultPayload({
        dateFrom,
        dateTo,
        source: finance.source,
        byNm: finance.byNm,
        counters: finance.counters,
        error: finance.error,
        partial: finance.partial,
      });
    }

    const stats = await loadStatisticsV5Report(token, { dateFrom, dateTo, maxPages });
    const usedStats = stats.counters.reportRowCount > 0;
    const financeWarning =
      !usedStats && finance.error ? finance.error : usedStats && finance.error ? finance.error : null;

    return buildResultPayload({
      dateFrom,
      dateTo,
      source: usedStats ? stats.source : finance.source,
      byNm: usedStats ? stats.byNm : finance.byNm,
      counters: usedStats ? stats.counters : finance.counters,
      error:
        stats.error ||
        (!usedStats ? finance.error : null) ||
        (stats.counters.reportRowCount === 0 && finance.counters.reportRowCount === 0
          ? 'Нет доступа к отчёту реализации — включите категории Finance и Statistics в токене WB'
          : null),
      partial: stats.partial || finance.partial,
      financeWarning,
    });
  });
}

export function serializeRealizationVendorSales(byVendorCode) {
  if (!byVendorCode?.size) return {};
  const out = {};
  for (const [key, stat] of byVendorCode) {
    if (!stat?.sales) continue;
    out[key] = {
      sales: stat.sales,
      returns: stat.returns,
      retailSum: stat.retailSum,
      retailReturnSum: stat.retailReturnSum,
      forPayNet: stat.forPayNet,
      commissionRubSum: stat.commissionRubSum,
      acquiringFeeSum: stat.acquiringFeeSum,
      deliveryRubSum: stat.deliveryRubSum,
      storageFeeSum: stat.storageFeeSum,
      acceptanceSum: stat.acceptanceSum,
      processingSum: stat.processingSum,
      penaltySum: stat.penaltySum,
      deductionSum: stat.deductionSum,
      additionalPaymentSum: stat.additionalPaymentSum,
      reportNmId: stat.reportNmId,
    };
  }
  return out;
}

export function serializeRealizationResult(result) {
  if (!result?.byNmId) return null;
  return {
    byNmId: Object.fromEntries(result.byNmId),
    byVendorCode: result.byVendorCode ? Object.fromEntries(result.byVendorCode) : {},
    globalAcquiringRate: result.globalAcquiringRate ?? null,
    period: result.period ?? null,
    error: result.error ?? null,
    rowCount: result.rowCount ?? 0,
    salesRows: result.salesRows ?? 0,
    skuWithSales: result.skuWithSales ?? 0,
    totalSales: result.totalSales ?? 0,
    source: result.source ?? null,
    financeWarning: result.financeWarning ?? null,
  };
}

export function restoreRealizationResult(snapshot) {
  if (!snapshot) {
    return {
      byNmId: new Map(),
      byVendorCode: new Map(),
      globalAcquiringRate: null,
      period: null,
      error: null,
      rowCount: 0,
      salesRows: 0,
      skuWithSales: 0,
      totalSales: 0,
      source: null,
    };
  }

  const byNmId = new Map(
    Object.entries(snapshot.byNmId || {}).map(([nmId, stat]) => [Number(nmId), stat])
  );
  let byVendorCode = new Map(Object.entries(snapshot.byVendorCode || {}));
  if (!byVendorCode.size && byNmId.size) {
    byVendorCode = rebuildVendorIndexFromFinalized(byNmId);
  }

  return {
    byNmId,
    byVendorCode,
    globalAcquiringRate: snapshot.globalAcquiringRate ?? null,
    period: snapshot.period ?? null,
    error: snapshot.error ?? null,
    rowCount: snapshot.rowCount ?? 0,
    salesRows: snapshot.salesRows ?? 0,
    skuWithSales: snapshot.skuWithSales ?? 0,
    totalSales: snapshot.totalSales ?? 0,
    source: snapshot.source ?? null,
  };
}

function findReportNmIdByVendor(realization, vendorCode) {
  if (!vendorCode || !realization?.byNmId) return 0;

  for (const key of vendorLookupKeys(vendorCode)) {
    const viaVendor = realization.byVendorCode?.get(key);
    if (viaVendor?.reportNmId) return Number(viaVendor.reportNmId) || 0;
  }

  const digit = articleDigitKey(vendorCode);
  if (digit) {
    const viaDigit = realization.byVendorCode?.get(digit);
    if (viaDigit?.reportNmId) return Number(viaDigit.reportNmId) || 0;
  }

  for (const key of vendorLookupKeys(vendorCode)) {
    for (const [reportNmId, stat] of realization.byNmId) {
      if (!stat.vendorCode) continue;
      if (vendorLookupKeys(stat.vendorCode).includes(key)) return reportNmId;
    }
  }

  return 0;
}

/** nmId из каталога или из отчёта WB по артикулу продавца. */
export function resolveReportNmId(realization, nmId, vendorCode) {
  const cachedNmId = Number(nmId) || 0;
  if (cachedNmId && realization?.byNmId?.has(cachedNmId)) return cachedNmId;
  return findReportNmIdByVendor(realization, vendorCode) || cachedNmId;
}

/** Сопоставление строки каталога со статистикой отчёта: nmId, затем артикул продавца. */
export function lookupRealizationStat(realization, nmId, vendorCode) {
  const byNmId = realization?.byNmId;
  const byVendorCode = realization?.byVendorCode;
  const resolvedNmId = resolveReportNmId(realization, nmId, vendorCode);

  if (resolvedNmId && byNmId?.get(resolvedNmId)?.sales) {
    return byNmId.get(resolvedNmId);
  }

  if (vendorCode && byVendorCode) {
    for (const key of vendorIndexKeys(vendorCode)) {
      const stat = byVendorCode.get(key);
      if (stat?.sales) return stat;
    }
  }

  if (resolvedNmId && byNmId?.has(resolvedNmId)) {
    return byNmId.get(resolvedNmId);
  }

  if (vendorCode && byVendorCode) {
    for (const key of vendorIndexKeys(vendorCode)) {
      const stat = byVendorCode.get(key);
      if (stat) return stat;
    }
  }

  return {};
}

export function computeRealizationCatalogOverlap(products, realization) {
  const catalogNmIds = new Set();
  const catalogVendorKeys = new Set();

  for (const product of products || []) {
    const nmId = Number(product.nmId);
    if (nmId) catalogNmIds.add(nmId);
    for (const key of vendorIndexKeys(product.vendorCode)) catalogVendorKeys.add(key);
  }

  let catalogNmInReport = 0;
  let catalogNmWithSales = 0;
  let catalogVendorInReport = 0;
  let catalogVendorWithSales = 0;

  for (const nmId of catalogNmIds) {
    const stat = realization?.byNmId?.get(nmId);
    if (stat) {
      catalogNmInReport += 1;
      if (stat.sales > 0) catalogNmWithSales += 1;
    }
  }

  for (const key of catalogVendorKeys) {
    const stat = realization?.byVendorCode?.get(key);
    if (stat) {
      catalogVendorInReport += 1;
      if (stat.sales > 0) catalogVendorWithSales += 1;
    }
  }

  return {
    catalogSku: catalogNmIds.size,
    catalogNmInReport,
    catalogNmWithSales,
    catalogVendorInReport,
    catalogVendorWithSales,
  };
}

/** Подставляет nmId из отчёта WB, если артикул совпадает по цифрам (61768 = 61768.0). */
export function patchCatalogNmIdsFromReport(catalog, realization) {
  if (!catalog?.length || !realization?.byNmId?.size) return catalog || [];

  const bestByDigit = new Map();
  for (const [nmId, stat] of realization.byNmId) {
    const digit = articleDigitKey(stat.vendorCode);
    if (!digit) continue;
    const prev = bestByDigit.get(digit);
    if (!prev || (stat.sales || 0) > (prev.sales || 0)) {
      bestByDigit.set(digit, { nmId: Number(nmId), vendorCode: stat.vendorCode || '', sales: stat.sales || 0 });
    }
  }

  if (!bestByDigit.size) return catalog;

  return catalog.map((product) => {
    const digit = articleDigitKey(product.vendorCode);
    const hit = digit ? bestByDigit.get(digit) : null;
    if (!hit?.nmId) return product;
    if (Number(product.nmId) === hit.nmId) return product;
    return {
      ...product,
      nmId: hit.nmId,
      vendorCode: product.vendorCode || hit.vendorCode,
    };
  });
}
