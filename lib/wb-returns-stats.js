import { restoreRealizationResult } from './wb-realization-stats.js';
import { realizationDigitKey } from './unit-economics/article-match.js';
import { vendorLookupKeys } from './unit-economics/vendor-key.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct(part, whole) {
  if (!whole || whole <= 0) return null;
  return part / whole;
}

function rowOperName(row) {
  return String(row.supplier_oper_name || row.sellerOperName || row.doc_type_name || row.docTypeName || '')
    .trim()
    .toLowerCase();
}

function rowBonusType(row) {
  return String(row.bonus_type_name || row.bonusTypeName || '').trim();
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

function logisticsRowRub(row) {
  const abs = (v) => Math.abs(num(v));
  return (
    abs(row.delivery_rub ?? row.deliveryRub) +
    abs(row.rebill_logistic_cost ?? row.rebillLogisticCost) +
    abs(row.delivery_service ?? row.deliveryService)
  );
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

/** Категории из отчёта реализации — не «причины возврата» от покупателя, а типы операций WB. */
export const RETURN_OPERATION_CATEGORIES = {
  goods_return: {
    id: 'goods_return',
    label: 'Возврат товара',
    hint: 'Строки операции «Возврат» в отчёте реализации — фактическое количество и сумма retail.',
    factual: true,
  },
  reverse_logistics: {
    id: 'reverse_logistics',
    label: 'Обратная логистика',
    hint: 'Строки «Логистика» с bonus_type_name «от клиента» / «возврат» — стоимость доставки обратно.',
    factual: true,
  },
  for_pay_reversal: {
    id: 'for_pay_reversal',
    label: 'Удержание к перечислению',
    hint: 'Сумма ppvz_for_pay по возвратам — сколько WB не перечислило по возвращённым продажам.',
    factual: true,
  },
};

/**
 * Парсит сырые строки отчёта реализации (reportDetailByPeriod / finance weekly).
 * WB не публикует причины возврата покупателя — только типы операций.
 */
export function parseReturnsFromReportRows(rows = []) {
  const byNm = new Map();
  const byVendor = new Map();
  const byReason = new Map();
  let totalReturns = 0;
  let totalSales = 0;
  let totalReturnLogisticsRub = 0;
  let totalRetailReturnRub = 0;
  let totalForPayReturnsRub = 0;

  const ensureNm = (nmId) => {
    if (!byNm.has(nmId)) {
      byNm.set(nmId, {
        nmId,
        vendorCode: '',
        returns: 0,
        sales: 0,
        returnLogisticsRub: 0,
        retailReturnRub: 0,
        forPayReturnsRub: 0,
        reasons: new Map(),
      });
    }
    return byNm.get(nmId);
  };

  const bumpReason = (bucket, reasonKey, { qty = 0, rub = 0, label = '' }) => {
    const prev = bucket.reasons.get(reasonKey) || { qty: 0, rub: 0, label };
    bucket.reasons.set(reasonKey, {
      qty: prev.qty + qty,
      rub: prev.rub + rub,
      label: label || prev.label,
    });
    const global = byReason.get(reasonKey) || { qty: 0, rub: 0, label: label || reasonKey };
    byReason.set(reasonKey, {
      qty: global.qty + qty,
      rub: global.rub + rub,
      label: label || global.label,
    });
  };

  for (const row of rows) {
    const nmId = rowNmId(row);
    if (!nmId) continue;

    const stat = ensureNm(nmId);
    const vendor = rowVendorCode(row);
    if (vendor && !stat.vendorCode) stat.vendorCode = vendor;

    const operRaw = rowOperName(row);
    const docType = String(row.doc_type_name || row.docTypeName || '')
      .trim()
      .toLowerCase();
    const qty = Math.abs(num(row.quantity)) || 1;
    const isSale = operRaw === 'продажа' || docType === 'продажа';
    const isReturn = operRaw === 'возврат' || docType === 'возврат';
    const isLogistics = operRaw === 'логистика';
    const bonus = rowBonusType(row).toLowerCase();

    if (isSale) {
      stat.sales += qty;
      totalSales += qty;
    }

    if (isReturn) {
      const retail = money(row, 'retail_amount', 'retailAmount');
      const forPay = money(row, 'ppvz_for_pay', 'forPay');
      stat.returns += qty;
      stat.retailReturnRub += retail;
      stat.forPayReturnsRub += forPay;
      totalReturns += qty;
      totalRetailReturnRub += retail;
      totalForPayReturnsRub += forPay;
      bumpReason(stat, 'goods_return', {
        qty,
        rub: retail,
        label: RETURN_OPERATION_CATEGORIES.goods_return.label,
      });
    }

    if (isLogistics && (bonus.includes('от клиента') || bonus.includes('возврат'))) {
      const rub = logisticsRowRub(row);
      stat.returnLogisticsRub += rub;
      totalReturnLogisticsRub += rub;
      const reasonKey = bonus || 'reverse_logistics';
      bumpReason(stat, reasonKey, {
        qty: 1,
        rub,
        label: rowBonusType(row) || RETURN_OPERATION_CATEGORIES.reverse_logistics.label,
      });
    }
  }

  for (const stat of byNm.values()) {
    if (!stat.vendorCode) continue;
    for (const key of vendorLookupKeys(stat.vendorCode)) {
      const prev = byVendor.get(key);
      if (!prev) {
        byVendor.set(key, { ...stat, reasons: new Map(stat.reasons) });
      }
    }
  }

  const reasonBreakdown = [...byReason.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      qty: v.qty,
      rub: v.rub,
      sharePct: totalReturnLogisticsRub + totalRetailReturnRub > 0 ? v.rub / (totalReturnLogisticsRub + totalRetailReturnRub) : null,
    }))
    .sort((a, b) => (b.rub || b.qty) - (a.rub || a.qty));

  return {
    byNmId: byNm,
    byVendorCode: byVendor,
    reasonBreakdown,
    totals: {
      returns: totalReturns,
      sales: totalSales,
      returnRate: pct(totalReturns, totalReturns + totalSales),
      returnLogisticsRub: totalReturnLogisticsRub,
      retailReturnRub: totalRetailReturnRub,
      forPayReturnsRub: totalForPayReturnsRub,
      totalReturnCostRub: totalReturnLogisticsRub,
    },
    hasReturnReasons: false,
    reasonNote:
      'WB не передаёт причины возврата покупателя в отчёте реализации. Ниже — типы операций из bonus_type_name и «Возврат».',
  };
}

function finalizeSkuLine(base) {
  const sales = num(base.sales);
  const returns = num(base.returns);
  const denom = sales + returns;
  return {
    ...base,
    sales,
    returns,
    buyoutRate: denom > 0 ? sales / denom : null,
    returnRate: denom > 0 ? returns / denom : null,
    returnLogisticsRub: num(base.returnLogisticsRub),
    retailReturnRub: num(base.retailReturnRub),
    forPayReturnsRub: num(base.forPayReturnsRub),
    avgReturnLogisticsRub: returns > 0 ? num(base.returnLogisticsRub) / returns : null,
    returnCostPerSaleRub: sales > 0 ? num(base.returnLogisticsRub) / sales : null,
    reasonBreakdown: base.reasonBreakdown || [],
  };
}

function statFromRealizationNm(stat, nmId) {
  return finalizeSkuLine({
    nmId,
    vendorCode: stat.vendorCode || '',
    brand: '',
    title: '',
    subjectName: '',
    sales: stat.sales,
    returns: stat.returns,
    buyoutRate: stat.buyoutRate,
    returnLogisticsRub: stat.returnLogisticsSum,
    retailReturnRub: stat.retailReturnSum,
    forPayReturnsRub: stat.forPayReturnsSum,
    forwardLogisticsRub: stat.forwardLogisticsSum,
    avgReturnLogisticsRub: stat.avgReturnLogisticsRub,
    reasonBreakdown: [
      stat.returns > 0
        ? {
            key: 'goods_return',
            label: RETURN_OPERATION_CATEGORIES.goods_return.label,
            qty: stat.returns,
            rub: stat.retailReturnSum,
            factual: true,
          }
        : null,
      stat.returnLogisticsSum > 0
        ? {
            key: 'reverse_logistics',
            label: RETURN_OPERATION_CATEGORIES.reverse_logistics.label,
            qty: null,
            rub: stat.returnLogisticsSum,
            factual: true,
          }
        : null,
    ].filter(Boolean),
  });
}

function enrichSkuFromRow(line, row) {
  if (!row) return line;
  return finalizeSkuLine({
    ...line,
    nmId: row.nmId || line.nmId,
    vendorCode: row.vendorCode || line.vendorCode,
    brand: row.brand || '',
    title: row.title || '',
    subjectName: row.subjectName || '',
    sales: num(row.reportSales) || line.sales,
    returns: num(row.reportReturns) || line.returns,
    buyoutRate: row.buyoutRate ?? line.buyoutRate,
    returnLogisticsRub: num(row.reportReturnLogistics) || line.returnLogisticsRub,
    retailReturnRub: num(row.reportRetailReturnSum) || line.retailReturnRub,
    forPayReturnsRub: line.forPayReturnsRub,
    forwardLogisticsRub: num(row.reportForwardLogistics) || line.forwardLogisticsRub,
    avgReturnLogisticsRub: row.actualReturnLogisticsRub ?? line.avgReturnLogisticsRub,
    orders7d: row.orders7d ?? 0,
    reasonBreakdown: line.reasonBreakdown,
  });
}

function aggregateReasons(skuLines) {
  const map = new Map();
  for (const sku of skuLines) {
    for (const r of sku.reasonBreakdown || []) {
      const prev = map.get(r.key) || { key: r.key, label: r.label, qty: 0, rub: 0, factual: r.factual !== false };
      map.set(r.key, {
        key: r.key,
        label: r.label,
        qty: prev.qty + (num(r.qty) || 0),
        rub: prev.rub + num(r.rub),
        factual: prev.factual && r.factual !== false,
      });
    }
  }
  const totalRub = [...map.values()].reduce((s, r) => s + r.rub, 0);
  return [...map.values()]
    .map((r) => ({ ...r, sharePct: totalRub > 0 ? r.rub / totalRub : null }))
    .sort((a, b) => (b.rub || b.qty) - (a.rub || a.qty));
}

function matchRowForNm(rows, nmId, vendorCode) {
  const byNm = rows.find((r) => Number(r.nmId) === Number(nmId));
  if (byNm) return byNm;
  if (!vendorCode) return null;
  const digit = realizationDigitKey(vendorCode);
  return (
    rows.find((r) => r.vendorCode === vendorCode) ||
    rows.find((r) => realizationDigitKey(r.vendorCode) === digit && digit.length >= 3) ||
    null
  );
}

/**
 * Агрегирует метрики возвратов из уже синхронизированного снимка отчёта реализации и строк каталога.
 * Новых запросов к WB API не делает.
 */
export function buildReturnsStats({
  realizationSnapshot = null,
  rows = [],
  period = null,
  source = null,
  realizationError = null,
} = {}) {
  const realization = restoreRealizationResult(realizationSnapshot);
  const skuMap = new Map();

  if (realization.byNmId?.size) {
    for (const [nmId, stat] of realization.byNmId) {
      if (!stat.returns && !stat.returnLogisticsSum && !stat.retailReturnSum) continue;
      const line = statFromRealizationNm(stat, nmId);
      const row = matchRowForNm(rows, nmId, stat.vendorCode);
      skuMap.set(Number(nmId), enrichSkuFromRow(line, row));
    }
  }

  for (const row of rows) {
    const returns = num(row.reportReturns);
    const returnLogistics = num(row.reportReturnLogistics);
    const retailReturn = num(row.reportRetailReturnSum);
    if (!returns && !returnLogistics && !retailReturn) continue;

    const nmId = Number(row.nmId) || 0;
    const existing = nmId ? skuMap.get(nmId) : null;
    if (existing) {
      skuMap.set(nmId, enrichSkuFromRow(existing, row));
      continue;
    }

    skuMap.set(nmId || row.vendorCode, enrichSkuFromRow(finalizeSkuLine({ nmId, vendorCode: row.vendorCode }), row));
  }

  const skuLines = [...skuMap.values()].sort((a, b) => {
    const byReturns = (b.returns || 0) - (a.returns || 0);
    if (byReturns !== 0) return byReturns;
    return (b.returnLogisticsRub || 0) - (a.returnLogisticsRub || 0);
  });

  const totals = skuLines.reduce(
    (acc, sku) => {
      acc.returns += sku.returns;
      acc.sales += sku.sales;
      acc.returnLogisticsRub += sku.returnLogisticsRub;
      acc.retailReturnRub += sku.retailReturnRub;
      acc.forPayReturnsRub += sku.forPayReturnsRub;
      acc.skuWithReturns += sku.returns > 0 ? 1 : 0;
      return acc;
    },
    {
      returns: 0,
      sales: 0,
      returnLogisticsRub: 0,
      retailReturnRub: 0,
      forPayReturnsRub: 0,
      skuWithReturns: 0,
    }
  );

  const denom = totals.sales + totals.returns;
  totals.returnRate = denom > 0 ? totals.returns / denom : null;
  totals.buyoutRate = denom > 0 ? totals.sales / denom : null;
  totals.totalReturnCostRub = totals.returnLogisticsRub;
  totals.avgReturnLogisticsRub = totals.returns > 0 ? totals.returnLogisticsRub / totals.returns : null;
  totals.returnCostPerSaleRub = totals.sales > 0 ? totals.returnLogisticsRub / totals.sales : null;

  const reasonBreakdown = aggregateReasons(skuLines);

  const reportPeriod = period || realization.period || null;
  const reportSource = source || realization.source || null;

  return {
    period: reportPeriod,
    source: reportSource,
    error: realizationError || realization.error || null,
    loaded: Boolean(realizationSnapshot || skuLines.length),
    hasReturnReasons: false,
    reasonNote:
      'Причины возврата покупателя WB в API не отдаёт. Показаны фактические операции из отчёта реализации: «Возврат» (кол-во и retail) и обратная логистика (bonus_type_name).',
    totals,
    reasonBreakdown,
    bySku: skuLines,
    byVendor: groupByVendor(skuLines),
    bySubject: groupByField(skuLines, 'subjectName'),
  };
}

function groupByVendor(skuLines) {
  const groups = new Map();
  for (const sku of skuLines) {
    const key = sku.vendorCode || `nm:${sku.nmId}`;
    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, { ...sku, nmIds: [sku.nmId].filter(Boolean) });
      continue;
    }
    groups.set(key, finalizeSkuLine({
      ...prev,
      sales: prev.sales + sku.sales,
      returns: prev.returns + sku.returns,
      returnLogisticsRub: prev.returnLogisticsRub + sku.returnLogisticsRub,
      retailReturnRub: prev.retailReturnRub + sku.retailReturnRub,
      forPayReturnsRub: prev.forPayReturnsRub + sku.forPayReturnsRub,
      reasonBreakdown: [...(prev.reasonBreakdown || []), ...(sku.reasonBreakdown || [])],
      nmIds: [...new Set([...(prev.nmIds || []), sku.nmId].filter(Boolean))],
    }));
  }
  return [...groups.values()].sort((a, b) => (b.returns || 0) - (a.returns || 0));
}

function groupByField(skuLines, field) {
  const groups = new Map();
  for (const sku of skuLines) {
    const key = sku[field] || '—';
    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, { label: key, ...sku });
      continue;
    }
    groups.set(key, finalizeSkuLine({
      ...prev,
      sales: prev.sales + sku.sales,
      returns: prev.returns + sku.returns,
      returnLogisticsRub: prev.returnLogisticsRub + sku.returnLogisticsRub,
      retailReturnRub: prev.retailReturnRub + sku.retailReturnRub,
      skuCount: (prev.skuCount || 1) + 1,
    }));
  }
  return [...groups.values()]
    .map((g) => ({ ...g, skuCount: g.skuCount || 1 }))
    .sort((a, b) => (b.returns || 0) - (a.returns || 0));
}

export function filterReturnsSkuLines(lines, { query = '', brand = '', subject = '', minReturns = 0, onlyWithCost = false } = {}) {
  const q = query.trim().toLowerCase();
  return lines.filter((row) => {
    if (minReturns > 0 && (row.returns || 0) < minReturns) return false;
    if (onlyWithCost && !(row.returnLogisticsRub > 0)) return false;
    if (brand && row.brand !== brand) return false;
    if (subject && row.subjectName !== subject) return false;
    if (!q) return true;
    const hay = [row.vendorCode, row.brand, row.title, row.subjectName, row.nmId].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}
