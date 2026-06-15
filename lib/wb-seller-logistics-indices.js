import { withWbApiToken } from './wb-official-api.js';
import {
  computeLocalizationIndex,
  computeSalesDistributionIndex,
  normalizeLocalizationIndex,
  normalizeSalesDistributionIndex,
} from './wb-localization-indices.js';
import {
  buildWarehouseFoResolver,
  foZoneKey,
  isFbsOrderException,
  isLocalWbOrder,
} from './wb-warehouse-fo.js';

const STATISTICS_API = 'https://statistics-api.wildberries.ru';
const ORDERS_PAGE_SLEEP_MS = 650;
const DEFAULT_DAYS = 90;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function orderTimestamp(order) {
  const raw = order?.date || order?.lastChangeDate;
  const ts = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ts) ? ts : 0;
}

/** Заказы Statistics API за период (до ~90 дней хранения WB). */
export async function fetchStatisticsOrders(token, { days = DEFAULT_DAYS, maxPages = 50 } = {}) {
  return withWbApiToken(token, async () => {
    const spanDays = Math.min(Math.max(7, days), DEFAULT_DAYS);
    const cutoffMs = Date.now() - spanDays * 24 * 60 * 60 * 1000;
    let dateFrom = new Date(cutoffMs).toISOString();
    const orders = [];

    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL('/api/v1/supplier/orders', STATISTICS_API);
      url.searchParams.set('dateFrom', dateFrom);

      const response = await fetch(url, {
        headers: {
          Authorization: (token || '').trim(),
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`WB orders ${response.status}: ${text.slice(0, 200)}`);
      }

      const rows = await response.json();
      if (!Array.isArray(rows) || !rows.length) break;

      let oldestInPage = Infinity;
      for (const row of rows) {
        const ts = orderTimestamp(row);
        if (ts && ts < cutoffMs) continue;
        if (row.isCancel) continue;
        const country = String(row.countryName || 'Россия');
        if (country && !/росси/i.test(country)) continue;
        orders.push(row);
        if (ts > 0) oldestInPage = Math.min(oldestInPage, ts);
      }

      const last = rows[rows.length - 1];
      const nextFrom = last?.lastChangeDate || last?.date;
      if (!nextFrom || nextFrom === dateFrom) break;
      if (oldestInPage < cutoffMs && oldestInPage !== Infinity) break;
      dateFrom = nextFrom;
      await sleep(ORDERS_PAGE_SLEEP_MS);
    }

    return {
      orders,
      days: spanDays,
      fetchedPages: Math.min(maxPages, Math.ceil(orders.length / 80000) + 1),
    };
  });
}

function accumulateArticleStats(orders, resolveWarehouseFo) {
  const byNmId = new Map();

  for (const order of orders) {
    const nmId = Number(order.nmId ?? order.nm_id);
    if (!nmId) continue;

    let stat = byNmId.get(nmId);
    if (!stat) {
      stat = { orders: 0, localOrders: 0, exceptionOrders: 0 };
      byNmId.set(nmId, stat);
    }

    stat.orders += 1;

    if (isFbsOrderException(order)) {
      stat.exceptionOrders += 1;
      continue;
    }

    const destinationFo = foZoneKey(order.oblastOkrugName || order.oblast_okrug_name);
    const originFo = resolveWarehouseFo(order.warehouseName || order.warehouse);
    const local = isLocalWbOrder({ originFo, destinationFo });
    if (local === true) stat.localOrders += 1;
  }

  const articles = [];
  for (const stat of byNmId.values()) {
    if (!stat.orders) continue;
    const exceptionShare = stat.exceptionOrders / stat.orders;
    if (exceptionShare > 0.35) {
      articles.push({
        orders: stat.orders,
        localizationSharePct: null,
        isException: true,
      });
      continue;
    }

    const nonExceptionOrders = stat.orders - stat.exceptionOrders;
    const sharePct =
      nonExceptionOrders > 0 ? (stat.localOrders / nonExceptionOrders) * 100 : 0;
    articles.push({
      orders: stat.orders,
      localizationSharePct: sharePct,
      isException: false,
    });
  }

  return articles;
}

export function computeSellerLogisticsIndicesFromOrders(orders, { tariffByName } = {}) {
  const resolveWarehouseFo = buildWarehouseFoResolver(tariffByName);
  const articles = accumulateArticleStats(orders, resolveWarehouseFo);
  const totalOrders = articles.reduce((sum, item) => sum + (item.orders || 0), 0);

  if (!totalOrders) {
    return {
      localizationIndex: null,
      salesDistributionIndex: null,
      totalOrders: 0,
      skuCount: 0,
      avgLocalizationSharePct: null,
    };
  }

  const localizationIndex = computeLocalizationIndex(articles);
  const salesDistributionIndex = computeSalesDistributionIndex(articles);

  let localWeighted = 0;
  let nonExceptionOrders = 0;
  for (const item of articles) {
    if (item.isException) continue;
    const ordersCount = item.orders || 0;
    nonExceptionOrders += ordersCount;
    localWeighted += (item.localizationSharePct / 100) * ordersCount;
  }

  return {
    localizationIndex,
    salesDistributionIndex,
    totalOrders,
    skuCount: articles.length,
    avgLocalizationSharePct:
      nonExceptionOrders > 0 ? (localWeighted / nonExceptionOrders) * 100 : null,
  };
}

/** ИЛ/ИРП кабинета — оценка по заказам Statistics API (пересчёт при синхронизации). */
export async function fetchSellerLogisticsIndices(
  token,
  { days = DEFAULT_DAYS, maxPages = 50, tariffByName } = {}
) {
  return withWbApiToken(token, async () => {
    try {
      const { orders, days: spanDays } = await fetchStatisticsOrders(token, { days, maxPages });
      const computed = computeSellerLogisticsIndicesFromOrders(orders, { tariffByName });

      return {
        localizationIndex:
          computed.localizationIndex != null
            ? normalizeLocalizationIndex(computed.localizationIndex)
            : null,
        salesDistributionIndex:
          computed.salesDistributionIndex != null
            ? normalizeSalesDistributionIndex(computed.salesDistributionIndex)
            : null,
        totalOrders: computed.totalOrders,
        skuCount: computed.skuCount,
        avgLocalizationSharePct: computed.avgLocalizationSharePct,
        periodDays: spanDays,
        computedAt: new Date().toISOString(),
        source: 'orders-estimate',
        error: computed.totalOrders ? null : 'Недостаточно заказов за период для расчёта ИЛ/ИРП',
      };
    } catch (err) {
      return {
        localizationIndex: null,
        salesDistributionIndex: null,
        totalOrders: 0,
        skuCount: 0,
        avgLocalizationSharePct: null,
        periodDays: days,
        computedAt: new Date().toISOString(),
        source: null,
        error: err.message || 'Не удалось рассчитать ИЛ/ИРП по заказам',
      };
    }
  });
}
