import { withWbApiToken } from './wb-official-api.js';
import { articleDigitKey } from './unit-economics/article-match.js';

const MARKETPLACE_API = 'https://marketplace-api.wildberries.ru';

const CARGO_TYPE_LABELS = {
  0: 'без типа',
  1: 'МГТ',
  2: 'СГТ',
  3: 'КГТ',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function marketplaceFetch(token, path, { method = 'GET', body = null, query = null } = {}) {
  const authToken = (token || '').trim();
  const url = new URL(path, MARKETPLACE_API);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  return fetch(url, {
    method,
    headers: {
      Authorization: authToken,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function readMarketplaceJson(response, path) {
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`WB marketplace ${response.status} ${path}: ${text.slice(0, 200)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`WB marketplace ${path}: неверный JSON`);
  }
}

/** Новые сборочные задания FBS — GET /api/v3/orders/new */
export async function fetchNewFbsOrders(token) {
  return withWbApiToken(token, async () => {
    const response = await marketplaceFetch(token, '/api/v3/orders/new');
    const data = await readMarketplaceJson(response, '/api/v3/orders/new');
    return data?.orders || [];
  });
}

/** Статусы сборочных заданий — POST /api/v3/orders/status (до 1000 id за запрос). */
export async function fetchFbsOrderStatuses(token, orderIds = []) {
  const ids = [...new Set(orderIds.map((id) => Number(id)).filter((id) => id > 0))];
  if (!ids.length) return new Map();

  return withWbApiToken(token, async () => {
    const byId = new Map();
    const chunkSize = 1000;

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const response = await marketplaceFetch(token, '/api/v3/orders/status', {
        method: 'POST',
        body: { orders: chunk },
      });
      const data = await readMarketplaceJson(response, '/api/v3/orders/status');
      for (const row of data?.orders || []) {
        if (row?.id != null) byId.set(Number(row.id), row);
      }
      if (i + chunkSize < ids.length) await sleep(220);
    }

    return byId;
  });
}

export function cargoTypeApiLabel(cargoType) {
  return CARGO_TYPE_LABELS[Number(cargoType)] || `тип ${cargoType}`;
}

export function officeLabelFromOrder(order) {
  const offices = order?.offices;
  if (Array.isArray(offices) && offices.length) return offices.join(', ');
  return order?.officeId ? `офис ${order.officeId}` : '—';
}

function officeLabel(order) {
  return officeLabelFromOrder(order);
}

function supplyGroupKey(order) {
  return [
    Number(order.officeId) || 0,
    Number(order.cargoType) || 0,
    Number(order.crossBorderType) || 0,
    order.options?.isB2B ? 'b2b' : 'b2c',
  ].join('|');
}

/** Агрегация по артикулу / nmId для списка поставщику. */
export function aggregateFbsPickList(orders = [], catalogByVendor = new Map(), supplierDigitKeys = null) {
  const supplierSet =
    supplierDigitKeys instanceof Set
      ? supplierDigitKeys
      : supplierDigitKeys
        ? new Set(supplierDigitKeys)
        : null;

  const byKey = new Map();

  for (const order of orders) {
    const vendorCode = String(order.article || '').trim();
    const nmId = Number(order.nmId) || 0;
    const key = `${vendorCode}::${nmId}`;
    const catalog = catalogByVendor.get(vendorCode) || catalogByVendor.get(String(nmId)) || null;

    const prev = byKey.get(key) || {
      vendorCode,
      nmId,
      qty: 0,
      orderIds: [],
      brand: catalog?.brand || '',
      title: catalog?.title || '',
      supplierInCatalog:
        Boolean(catalog?.inSupplierCatalog) ||
        Boolean(supplierSet && supplierSet.has(articleDigitKey(vendorCode))),
      offices: new Set(),
      cargoTypes: new Set(),
    };

    prev.qty += 1;
    prev.orderIds.push(Number(order.id));
    prev.offices.add(officeLabel(order));
    prev.cargoTypes.add(cargoTypeApiLabel(order.cargoType));
    if (!prev.brand && catalog?.brand) prev.brand = catalog.brand;
    if (!prev.title && catalog?.title) prev.title = catalog.title;

    byKey.set(key, prev);
  }

  return [...byKey.values()]
    .map((row) => ({
      vendorCode: row.vendorCode,
      nmId: row.nmId,
      qty: row.qty,
      orderIds: row.orderIds,
      brand: row.brand,
      title: row.title,
      supplierInCatalog: row.supplierInCatalog,
      offices: [...row.offices].join('; '),
      cargoTypes: [...row.cargoTypes].join(', '),
    }))
    .sort((a, b) => b.qty - a.qty || String(a.vendorCode).localeCompare(String(b.vendorCode), 'ru'));
}

/** Уникальные склады WB из заказов и групп поставок. */
export function listFbsOfficeLabels(orders = [], supplyGroups = []) {
  const labels = new Set();
  for (const group of supplyGroups) {
    if (group?.officeLabel && group.officeLabel !== '—') labels.add(group.officeLabel);
  }
  for (const order of orders) {
    const label = officeLabelFromOrder(order);
    if (label && label !== '—') labels.add(label);
  }
  return [...labels].sort((a, b) => a.localeCompare(b, 'ru'));
}

/** Агрегация pick-list только по выбранному складу (пустой label — все склады). */
export function aggregateFbsPickListForOffice(
  orders = [],
  officeLabel = '',
  catalogByVendor = new Map(),
  supplierDigitKeys = null
) {
  const filtered = officeLabel
    ? orders.filter((order) => officeLabelFromOrder(order) === officeLabel)
    : orders;
  return aggregateFbsPickList(filtered, catalogByVendor, supplierDigitKeys);
}

/** Группы для отдельных поставок WB (один офис + тип габарита + crossBorder). */
export function groupOrdersForSupplies(orders = []) {
  const groups = new Map();

  for (const order of orders) {
    const key = supplyGroupKey(order);
    const prev = groups.get(key) || {
      key,
      officeId: Number(order.officeId) || null,
      officeLabel: officeLabel(order),
      cargoType: Number(order.cargoType) || 0,
      cargoTypeLabel: cargoTypeApiLabel(order.cargoType),
      crossBorderType: Number(order.crossBorderType) || 0,
      isB2B: Boolean(order.options?.isB2B),
      orderIds: [],
      orders: [],
    };
    prev.orderIds.push(Number(order.id));
    prev.orders.push(order);
    groups.set(key, prev);
  }

  return [...groups.values()].sort((a, b) => b.orderIds.length - a.orderIds.length);
}

function defaultSupplyName(group, index) {
  const date = new Date().toISOString().slice(0, 10);
  const office = (group.officeLabel || 'FBS').replace(/\s+/g, ' ').slice(0, 24);
  return `Unitka ${date} ${office} ${group.cargoTypeLabel}${index > 0 ? ` #${index + 1}` : ''}`.trim();
}

/** POST /api/v3/supplies */
export async function createFbsSupply(token, name) {
  return withWbApiToken(token, async () => {
    const response = await marketplaceFetch(token, '/api/v3/supplies', {
      method: 'POST',
      body: { name: String(name || '').trim() || `FBS ${new Date().toISOString()}` },
    });
    const data = await readMarketplaceJson(response, 'POST /api/v3/supplies');
    if (!data?.id) throw new Error('WB не вернул id поставки');
    return data.id;
  });
}

/** PATCH /api/marketplace/v3/supplies/{supplyId}/orders — до 100 заказов за запрос. */
export async function addOrdersToFbsSupply(token, supplyId, orderIds = []) {
  const ids = [...new Set(orderIds.map((id) => Number(id)).filter((id) => id > 0))];
  if (!ids.length) return { added: 0 };

  return withWbApiToken(token, async () => {
    let added = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const response = await marketplaceFetch(
        token,
        `/api/marketplace/v3/supplies/${encodeURIComponent(supplyId)}/orders`,
        { method: 'PATCH', body: { orders: chunk } }
      );
      if (!response.ok && response.status !== 204) {
        const text = await response.text().catch(() => '');
        throw new Error(`Добавление в поставку ${supplyId}: ${response.status} ${text.slice(0, 200)}`);
      }
      added += chunk.length;
      if (i + 100 < ids.length) await sleep(220);
    }
    return { added };
  });
}

/**
 * Создаёт черновики поставок по группам (офис + cargoType + crossBorder).
 * Возвращает созданные supplyId — дальше в ЛК WB: короба, QR, передача в доставку.
 */
export async function createFbsSuppliesFromGroups(token, groups = [], { namePrefix = 'Unitka' } = {}) {
  const results = [];

  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const name = group.name?.trim() || `${namePrefix} ${defaultSupplyName(group, i)}`;
    try {
      const supplyId = await createFbsSupply(token, name);
      const { added } = await addOrdersToFbsSupply(token, supplyId, group.orderIds);
      results.push({
        ok: true,
        supplyId,
        name,
        orderCount: added,
        groupKey: group.key,
        officeLabel: group.officeLabel,
        cargoTypeLabel: group.cargoTypeLabel,
      });
      await sleep(220);
    } catch (err) {
      results.push({
        ok: false,
        name,
        groupKey: group.key,
        officeLabel: group.officeLabel,
        cargoTypeLabel: group.cargoTypeLabel,
        orderCount: group.orderIds?.length || 0,
        error: err.message || 'Ошибка создания поставки',
      });
    }
  }

  return results;
}

export function buildCatalogLookup(rows = [], { supplierDigitKeys = null } = {}) {
  const supplierSet =
    supplierDigitKeys instanceof Set
      ? supplierDigitKeys
      : new Set(supplierDigitKeys || []);

  const byVendor = new Map();
  for (const row of rows) {
    const vendorCode = String(row.vendorCode || '').trim();
    if (!vendorCode) continue;
    const digitKey = articleDigitKey(vendorCode);
    const entry = {
      brand: row.brand || '',
      title: row.title || '',
      nmId: row.nmId,
      inSupplierCatalog: Boolean(digitKey && supplierSet.has(digitKey)),
    };
    byVendor.set(vendorCode, entry);
    if (row.nmId) byVendor.set(String(row.nmId), entry);
  }
  return byVendor;
}

export function summarizeFbsAssembly(orders = [], pickList = [], supplyGroups = []) {
  return {
    orderCount: orders.length,
    skuCount: pickList.length,
    totalQty: pickList.reduce((sum, row) => sum + (row.qty || 0), 0),
    supplyGroupCount: supplyGroups.length,
    fetchedAt: new Date().toISOString(),
  };
}
