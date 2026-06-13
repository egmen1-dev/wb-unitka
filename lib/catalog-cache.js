import { initDb, getSql } from './db.js';
import { syncWildberriesProducts } from './wb-sync.js';
import {
  getAllProductOverrides,
  mergeCatalogWithOverrides,
} from './product-overrides.js';

const CACHE_TTL_MS = Number(process.env.WB_CACHE_TTL_MS || 60 * 60 * 1000);

let memoryCache = null;
let memoryExpiresAt = 0;

async function readCatalogFromDb() {
  try {
    await initDb();
    const db = getSql();
    const rows = await db`
      SELECT payload, synced_at
      FROM catalog_cache
      WHERE id = 1
      LIMIT 1
    `;
    const row = rows[0];
    if (!row?.payload) return null;

    const syncedAt = new Date(row.synced_at).getTime();
    if (Date.now() - syncedAt > CACHE_TTL_MS) {
      return null;
    }

    return row.payload;
  } catch {
    return null;
  }
}

async function writeCatalogToDb(data) {
  try {
    await initDb();
    const db = getSql();
    await db`
      INSERT INTO catalog_cache (id, payload, synced_at)
      VALUES (1, ${db.json(data)}, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        payload = EXCLUDED.payload,
        synced_at = NOW()
    `;
  } catch (error) {
    console.error('catalog cache write error', error);
  }
}

function rememberInMemory(data) {
  memoryCache = data;
  memoryExpiresAt = Date.now() + CACHE_TTL_MS;
}

export async function getRawCatalog({ forceRefresh = false, includeDetails = false } = {}) {
  const now = Date.now();

  if (!forceRefresh) {
    if (memoryCache && now < memoryExpiresAt) {
      return { data: memoryCache, fromCache: true, cacheLayer: 'memory' };
    }

    const dbCache = await readCatalogFromDb();
    if (dbCache) {
      rememberInMemory(dbCache);
      return { data: dbCache, fromCache: true, cacheLayer: 'db' };
    }
  }

  const data = await syncWildberriesProducts({
    supplierId: Number(process.env.WB_SUPPLIER_ID || 4277037),
    includeDetails,
  });

  rememberInMemory(data);
  await writeCatalogToDb(data);

  return { data, fromCache: false, cacheLayer: 'sync' };
}

export async function getPublicCatalog({ forceRefresh = false } = {}) {
  const { data, fromCache, cacheLayer } = await getRawCatalog({
    forceRefresh,
    includeDetails: false,
  });

  let products = data.products;

  try {
    const overrides = await getAllProductOverrides();
    if (overrides.size) {
      products = mergeCatalogWithOverrides(products, overrides);
    }
  } catch {
    // Postgres не подключён — отдаём каталог без ручных настроек.
  }

  return {
    ...data,
    products,
    total: products.length,
    fromCache,
    cacheLayer,
  };
}

export function getStaleRawCatalog() {
  return memoryCache;
}
