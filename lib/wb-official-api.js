import {
  buildTariffIndex,
  pickDefaultBoxTariff,
} from './wb-warehouse-tariffs.js';

const CONTENT_API = 'https://content-api.wildberries.ru';
const PRICES_API = 'https://discounts-prices-api.wildberries.ru';
const MARKETPLACE_API = 'https://marketplace-api.wildberries.ru';
const COMMON_API = 'https://common-api.wildberries.ru';
const STATISTICS_API = 'https://statistics-api.wildberries.ru';
const ANALYTICS_API = 'https://seller-analytics-api.wildberries.ru';

let runtimeToken = null;

function getToken() {
  return runtimeToken || process.env.WB_API_TOKEN?.trim() || null;
}

export function hasOfficialWbApi(token) {
  return Boolean(token?.trim() || getToken());
}

/** Временно подставляет токен (для запросов с разными ключами). */
export async function withWbApiToken(token, fn) {
  const prev = runtimeToken;
  runtimeToken = token?.trim() || null;
  try {
    return await fn();
  } finally {
    runtimeToken = prev;
  }
}

async function wbFetch(baseUrl, path, { method = 'GET', body = null, query = null } = {}) {
  const token = getToken();
  if (!token) {
    throw new Error('WB_API_TOKEN не задан');
  }

  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const maxAttempts = 5;
  let lastText = '';

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: token,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.ok) {
      return response.json();
    }

    lastText = await response.text().catch(() => '');
    const retryable = response.status === 429 || response.status === 461 || response.status === 503;

    if (retryable && attempt < maxAttempts - 1) {
      const retryAfterSec = Number(response.headers.get('Retry-After')) || 0;
      const waitMs =
        retryAfterSec > 0 ? retryAfterSec * 1000 : Math.min(30_000, 2000 * 2 ** attempt);
      await sleep(waitMs);
      continue;
    }

    if (response.status === 429 || response.status === 461) {
      throw new Error(
        `WB API ${response.status} ${path}: слишком много запросов — подождите 1–2 мин и повторите синхронизацию`
      );
    }

    throw new Error(`WB API ${response.status} ${path}: ${lastText.slice(0, 200)}`);
  }

  throw new Error(`WB API ${path}: ${lastText.slice(0, 200)}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenCacheKey() {
  const token = getToken();
  if (!token) return '';
  return token.length > 16 ? token.slice(-16) : token;
}

const memoryTariffCache = new Map();

function readMemoryTariff(kind) {
  const entry = memoryTariffCache.get(`${tokenCacheKey()}:${kind}`);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.value;
}

function writeMemoryTariff(kind, value, ttlMs = 6 * 60 * 60 * 1000) {
  const key = tokenCacheKey();
  if (!key) return;
  memoryTariffCache.set(`${key}:${kind}`, { value, expiresAt: Date.now() + ttlMs });
}

export async function fetchAllContentCards() {
  const cards = [];
  let cursor = { limit: 100 };
  let hasMore = true;

  while (hasMore) {
    const data = await wbFetch(CONTENT_API, '/content/v2/get/cards/list', {
      method: 'POST',
      query: { locale: 'ru' },
      body: {
        settings: {
          sort: { ascending: true },
          filter: { withPhoto: -1 },
          cursor,
        },
      },
    });

    const batch = data.cards || [];
    cards.push(...batch);

    const nextCursor = data.cursor;
    if (!batch.length || !nextCursor?.nmID || (nextCursor.total ?? 0) < cursor.limit) {
      hasMore = false;
    } else {
      cursor = {
        limit: 100,
        updatedAt: nextCursor.updatedAt,
        nmID: nextCursor.nmID,
      };
      await sleep(650);
    }
  }

  return cards;
}

/** Одна страница каталога (до 100 карточек) — для пошаговой полной синхронизации. */
export async function fetchContentCardsChunk(cursor = null) {
  const requestCursor = cursor || { limit: 100 };
  const data = await wbFetch(CONTENT_API, '/content/v2/get/cards/list', {
    method: 'POST',
    query: { locale: 'ru' },
    body: {
      settings: {
        sort: { ascending: true },
        filter: { withPhoto: -1 },
        cursor: requestCursor,
      },
    },
  });

  const batch = data.cards || [];
  const nextCursor = data.cursor;
  const hasMore =
    batch.length > 0 &&
    nextCursor?.nmID &&
    (nextCursor.total ?? 0) >= requestCursor.limit;

  return {
    cards: batch,
    nextCursor: hasMore
      ? { limit: 100, updatedAt: nextCursor.updatedAt, nmID: nextCursor.nmID }
      : null,
    done: !hasMore,
  };
}

/** Карточки, изменённые после указанной даты (новые товары, габариты, SKU). */
export async function fetchContentCardsUpdatedSince(updatedSince, { maxPages = 5 } = {}) {
  if (!updatedSince) return [];

  const cards = [];
  let cursor = { limit: 100 };
  let hasMore = true;
  let page = 0;

  while (hasMore && page < maxPages) {
    page += 1;
    const data = await wbFetch(CONTENT_API, '/content/v2/get/cards/list', {
      method: 'POST',
      query: { locale: 'ru' },
      body: {
        settings: {
          sort: { ascending: true },
          filter: {
            withPhoto: -1,
            updatedAt: updatedSince,
          },
          cursor,
        },
      },
    });

    const batch = data.cards || [];
    cards.push(...batch);

    const nextCursor = data.cursor;
    if (!batch.length || !nextCursor?.nmID || (nextCursor.total ?? 0) < cursor.limit) {
      hasMore = false;
    } else {
      cursor = {
        limit: 100,
        updatedAt: nextCursor.updatedAt,
        nmID: nextCursor.nmID,
      };
      await sleep(650);
    }
  }

  return cards;
}

/** Точечная подгрузка карточек по nmId (новые товары из Prices API). */
export async function fetchContentCardsByNmIds(nmIds = [], { concurrency = 4 } = {}) {
  const unique = [...new Set(nmIds.map(Number).filter(Boolean))];
  if (!unique.length) return [];

  const cards = [];

  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const batchCards = await Promise.all(
      batch.map(async (nmId) => {
        try {
          const data = await wbFetch(CONTENT_API, '/content/v2/get/cards/list', {
            method: 'POST',
            query: { locale: 'ru' },
            body: {
              settings: {
                sort: { ascending: true },
                filter: { withPhoto: -1, textSearch: String(nmId) },
                cursor: { limit: 20 },
              },
            },
          });
          return (data.cards || []).find((c) => Number(c.nmID) === nmId) || null;
        } catch {
          return null;
        }
      })
    );
    cards.push(...batchCards.filter(Boolean));
    if (i + concurrency < unique.length) {
      await sleep(350);
    }
  }

  return cards;
}

function pickCardForVendor(cards, vendorCode) {
  const keys = new Set(
    [vendorCode, `${vendorCode}.0`, vendorCode.replace(/\.0$/, '')]
      .map((v) => String(v || '').trim())
      .filter(Boolean)
  );
  return (
    cards.find((card) => keys.has(String(card.vendorCode || '').trim())) ||
    cards.find((card) => Number(card.nmID) === Number(vendorCode)) ||
    cards[0] ||
    null
  );
}

/** Поиск карточек по артикулу продавца (textSearch в Content API). */
export async function fetchContentCardsByVendorCodes(vendorCodes = [], { concurrency = 4 } = {}) {
  const unique = [...new Set(vendorCodes.map((v) => String(v || '').trim()).filter(Boolean))];
  if (!unique.length) return [];

  const cards = [];
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const batchCards = await Promise.all(
      batch.map(async (vendorCode) => {
        try {
          const data = await wbFetch(CONTENT_API, '/content/v2/get/cards/list', {
            method: 'POST',
            query: { locale: 'ru' },
            body: {
              settings: {
                sort: { ascending: true },
                filter: { withPhoto: -1, textSearch: vendorCode },
                cursor: { limit: 20 },
              },
            },
          });
          return pickCardForVendor(data.cards || [], vendorCode);
        } catch {
          return null;
        }
      })
    );
    cards.push(...batchCards.filter(Boolean));
    if (i + concurrency < unique.length) await sleep(350);
  }

  return cards;
}

export async function fetchAllPrices() {
  const pricesByNmId = new Map();
  let offset = 0;
  const limit = 1000;

  while (true) {
    const data = await wbFetch(PRICES_API, '/api/v2/list/goods/filter', {
      query: { limit, offset },
    });

    const items = data.data?.listGoods || data.listGoods || [];
    if (!items.length) break;

    for (const item of items) {
      pricesByNmId.set(item.nmID, item);
    }

    offset += limit;
    await sleep(650);
  }

  return pricesByNmId;
}

export async function fetchWarehouses() {
  const data = await wbFetch(MARKETPLACE_API, '/api/v3/warehouses');
  return Array.isArray(data) ? data : data?.warehouses || [];
}

/** Склады WB (офисы приёма FBS) — для привязки склада продавца к тарифу. */
export async function fetchWbOffices() {
  const data = await wbFetch(MARKETPLACE_API, '/api/v3/offices');
  const list = Array.isArray(data) ? data : data?.offices || [];
  const byId = new Map();
  for (const office of list) {
    const id = Number(office.id ?? office.officeId);
    if (id) byId.set(id, office);
  }
  return { list, byId };
}

export async function fetchStocksForWarehouse(warehouseId, skus = []) {
  if (!warehouseId || !skus.length) return new Map();

  const stocksBySku = new Map();
  const chunkSize = 1000;

  for (let i = 0; i < skus.length; i += chunkSize) {
    const chunk = skus.slice(i, i + chunkSize);
    const data = await wbFetch(MARKETPLACE_API, `/api/v3/stocks/${warehouseId}`, {
      method: 'POST',
      body: { skus: chunk },
    });

    for (const item of data.stocks || []) {
      stocksBySku.set(item.sku, item.amount ?? 0);
    }

    if (i + chunkSize < skus.length) {
      await sleep(350);
    }
  }

  return stocksBySku;
}

export function extractPriceFromGoods(goods) {
  if (!goods) return { price: 0, oldPrice: null };

  const size = goods.sizes?.[0];
  const price = Math.round(
    Number(size?.discountedPrice || goods.discountedPrice || size?.price || goods.price || 0)
  );
  const oldPrice = Math.round(Number(size?.price || goods.price || 0));
  const hasDiscount = oldPrice > price && price > 0;

  return {
    price,
    oldPrice: hasDiscount ? oldPrice : null,
  };
}

export function extractStockFromCard(card, stocksBySku = new Map()) {
  const skus = (card.sizes || []).flatMap((size) => size.skus || []);
  const amounts = skus.map((sku) => stocksBySku.get(sku) ?? 0);
  const stock = amounts.reduce((sum, value) => sum + value, 0);

  return {
    stock,
    inStock: stock > 0,
  };
}

/** FBS-остаток по карточке с выбором склада продавца с максимальным остатком. */
export function extractFbsStockForCard(card, stocksBySellerWarehouse = []) {
  const skus = (card.sizes || []).flatMap((size) => size.skus || []).filter(Boolean);
  if (!skus.length) {
    return { stock: 0, sellerWarehouse: null, sellerWarehouseName: '' };
  }

  let bestWarehouse = null;
  let bestQty = 0;
  let total = 0;

  for (const entry of stocksBySellerWarehouse) {
    const qty = skus.reduce((sum, sku) => sum + (entry.stocks.get(sku) ?? 0), 0);
    total += qty;
    if (qty > bestQty) {
      bestQty = qty;
      bestWarehouse = entry.warehouse;
    }
  }

  return {
    stock: total,
    sellerWarehouse: bestWarehouse,
    sellerWarehouseName: bestWarehouse?.name || '',
  };
}

/** Комиссии WB по subjectID: FBO (marketplace) и FBS (supplier), доли 0..1 */
export async function fetchCommissionTariffs() {
  const cached = readMemoryTariff('commission');
  if (cached) return cached;

  const data = await wbFetch(COMMON_API, '/api/v1/tariffs/commission', {
    query: { locale: 'ru' },
  });
  const bySubject = new Map();
  for (const row of data.report || []) {
    const subjectId = Number(row.subjectID);
    if (!subjectId) continue;
    bySubject.set(subjectId, {
      fboCategory: Number(row.kgvpMarketplace || 0) / 100,
      fbsCategory: Number(row.kgvpSupplier || 0) / 100,
      subjectName: row.subjectName || '',
      parentName: row.parentName || '',
    });
  }
  writeMemoryTariff('commission', bySubject);
  return bySubject;
}

/** Все тарифы коробов по складам WB на дату. */
export async function fetchAllBoxTariffs(date = new Date().toISOString().slice(0, 10)) {
  const data = await wbFetch(COMMON_API, '/api/v1/tariffs/box', { query: { date } });
  const list = data.response?.data?.warehouseList || data.data?.warehouseList || [];
  const byName = buildTariffIndex(list);
  const defaultTariff = pickDefaultBoxTariff(list);
  const warehouses = [...byName.values()];
  return { byName, warehouses, defaultTariff, date, rawCount: list.length };
}

export async function fetchAllBoxTariffsWithFallback() {
  const cached = readMemoryTariff('box');
  if (cached) return cached;

  const today = new Date();
  const dates = [0, 1, -1].map((shift) => {
    const d = new Date(today);
    d.setDate(d.getDate() + shift);
    return d.toISOString().slice(0, 10);
  });

  let last = null;
  for (const date of dates) {
    const result = await fetchAllBoxTariffs(date);
    last = result;
    if (result.byName.size > 0) {
      writeMemoryTariff('box', result);
      return result;
    }
    await sleep(400);
  }
  const fallback = last || (await fetchAllBoxTariffs());
  writeMemoryTariff('box', fallback);
  return fallback;
}

/** Тарифы логистики, хранения и FBS — дефолтный склад + индекс по всем складам. */
export async function fetchBoxTariffs(date = new Date().toISOString().slice(0, 10)) {
  const all = await fetchAllBoxTariffsWithFallback();
  return {
    ...all.defaultTariff,
    byName: all.byName,
    warehouses: all.warehouses,
    defaultTariff: all.defaultTariff,
    date: all.date,
    rawCount: all.rawCount,
  };
}

/** Остатки FBO по nmId и складу WB. */
export async function fetchFboStocksDetailed() {
  const byNmId = new Map();
  const dateFrom = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let data;
  try {
    data = await wbFetch(STATISTICS_API, '/api/v1/supplier/stocks', { query: { dateFrom } });
  } catch {
    return byNmId;
  }

  const items = Array.isArray(data) ? data : data?.data || [];
  for (const item of items) {
    const nmId = Number(item.nmId || item.nmID);
    if (!nmId) continue;

    const qty = Number(item.quantity || item.quantityFull || item.stock || 0) || 0;
    const warehouseName = String(item.warehouseName || item.warehouse || '').trim();

    if (!byNmId.has(nmId)) {
      byNmId.set(nmId, { total: 0, warehouses: [] });
    }

    const entry = byNmId.get(nmId);
    entry.total += qty;

    if (warehouseName && qty > 0) {
      const existing = entry.warehouses.find((w) => w.name === warehouseName);
      if (existing) existing.qty += qty;
      else entry.warehouses.push({ name: warehouseName, qty });
    }
  }

  return byNmId;
}

/** Остатки FBO по nmId (сумма по складам). */
export async function fetchFboStocks() {
  const detailed = await fetchFboStocksDetailed();
  const stocksByNmId = new Map();
  for (const [nmId, entry] of detailed) {
    stocksByNmId.set(nmId, entry.total);
  }
  return stocksByNmId;
}

export function extractDimensions(card) {
  const dims = card.dimensions || {};
  return {
    lengthCm: Number(dims.length || dims.depth || 0) || null,
    widthCm: Number(dims.width || 0) || null,
    heightCm: Number(dims.height || 0) || null,
  };
}

