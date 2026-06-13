import { withWbApiToken } from './wb-official-api.js';
import {
  normalizeWarehouseKey,
  resolveOfficeName,
  resolveSellerOfficeId,
} from './wb-warehouse-tariffs.js';

const MARKETPLACE_API = 'https://marketplace-api.wildberries.ru';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Сборочные задания FBS за период — считаем офисы WB и склады продавца. */
export async function fetchFbsAssemblyOrderStats(token, { days = 30, maxPages = 40 } = {}) {
  return withWbApiToken(token, async () => {
    const authToken = (token || '').trim();
    const dateFrom = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const officeCounts = new Map();
    const sellerWarehouseCounts = new Map();
    let next = 0;
    let totalOrders = 0;
    let lastError = null;

    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL('/api/v3/orders', MARKETPLACE_API);
      url.searchParams.set('limit', '1000');
      url.searchParams.set('next', String(next));
      url.searchParams.set('dateFrom', String(dateFrom));

      let data;
      try {
        const response = await fetch(url, {
          headers: { Authorization: authToken, Accept: 'application/json' },
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`WB marketplace ${response.status}: ${text.slice(0, 200)}`);
        }
        data = await response.json();
      } catch (err) {
        lastError = err.message || 'Не удалось загрузить сборочные задания FBS';
        if (page === 0) throw err;
        break;
      }

      const orders = data?.orders || [];
      if (!orders.length) break;

      for (const order of orders) {
        const officeId = Number(order.officeId);
        const warehouseId = Number(order.warehouseId);
        if (officeId) officeCounts.set(officeId, (officeCounts.get(officeId) || 0) + 1);
        if (warehouseId) {
          sellerWarehouseCounts.set(warehouseId, (sellerWarehouseCounts.get(warehouseId) || 0) + 1);
        }
        totalOrders += 1;
      }

      const nextCursor = data?.next;
      if (nextCursor == null || nextCursor === next || orders.length < 1000) break;
      next = nextCursor;
      await sleep(220);
    }

    return {
      officeCounts,
      sellerWarehouseCounts,
      totalOrders,
      periodDays: days,
      error: lastError,
    };
  });
}

function topCountEntry(counts) {
  if (!counts?.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
}

function findSellerWarehouseByOffice(activeWarehouses, wbOfficesById, officeId) {
  const direct = activeWarehouses.find((w) => resolveSellerOfficeId(w) === officeId);
  if (direct) return direct;

  const officeName = resolveOfficeName(wbOfficesById, officeId);
  if (!officeName) return null;
  const officeKey = normalizeWarehouseKey(officeName);

  return (
    activeWarehouses.find((w) => {
      const name = w.name || '';
      const linked = resolveOfficeName(wbOfficesById, resolveSellerOfficeId(w));
      return (
        normalizeWarehouseKey(name) === officeKey ||
        (linked && normalizeWarehouseKey(linked) === officeKey)
      );
    }) || null
  );
}

function isSgtWarehouse(warehouse, wbOfficesById) {
  const officeName = resolveOfficeName(wbOfficesById, resolveSellerOfficeId(warehouse));
  const hay = `${warehouse?.name || ''} ${officeName || ''}`.toLowerCase();
  return hay.includes('сгт');
}

/**
 * Основной склад FBS для тарифа: офис WB с макс. числом сборочных заданий за период.
 */
export function resolvePrimaryFbsShipmentContext({
  sellerWarehouses = [],
  wbOfficesById,
  shipmentStats,
}) {
  const activeWarehouses = sellerWarehouses.filter((w) => w.id && !w.isDeleting);

  const topOffice = topCountEntry(shipmentStats?.officeCounts);
  if (topOffice && topOffice[1] > 0) {
    const officeId = topOffice[0];
    const officeName = resolveOfficeName(wbOfficesById, officeId);
    const sellerWarehouse = findSellerWarehouseByOffice(activeWarehouses, wbOfficesById, officeId);
    return {
      sellerWarehouse,
      officeName,
      officeId,
      orderCount: topOffice[1],
      source: 'orders_office',
    };
  }

  const topSellerWh = topCountEntry(shipmentStats?.sellerWarehouseCounts);
  if (topSellerWh && topSellerWh[1] > 0) {
    const warehouseId = topSellerWh[0];
    const sellerWarehouse = activeWarehouses.find((w) => Number(w.id) === warehouseId) || null;
    const officeId = resolveSellerOfficeId(sellerWarehouse);
    const officeName = resolveOfficeName(wbOfficesById, officeId) || sellerWarehouse?.name || '';
    return {
      sellerWarehouse,
      officeName,
      officeId,
      orderCount: topSellerWh[1],
      source: 'orders_warehouse',
    };
  }

  const nonSgt = activeWarehouses.filter((w) => !isSgtWarehouse(w, wbOfficesById));
  const fallback = nonSgt[0] || activeWarehouses[0] || null;
  if (fallback) {
    const officeId = resolveSellerOfficeId(fallback);
    return {
      sellerWarehouse: fallback,
      officeName: resolveOfficeName(wbOfficesById, officeId) || fallback.name || '',
      officeId,
      orderCount: 0,
      source: 'fallback',
    };
  }

  return {
    sellerWarehouse: null,
    officeName: '',
    officeId: null,
    orderCount: 0,
    source: 'none',
  };
}
