import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { articleDigitKey } from './unit-economics/article-match.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SUPPLIER_VK_DOC_URL =
  'https://vk.com/doc98349869_699441243?hash=Qwp6zmigdZzGikeng1unqDYOK5CRshU0tDYIcjsB63X&dl=LhqouAx9ZmfKsOBcOajJrmBqZk4JLz4Ze3fUoRS3wGo&from_module=vkmsg_desktop';

const BUNDLED_PATH = join(__dirname, '../wb-unit-economics-sheet/data/supplier-prices.json');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let memoryCache = null;

function formatSupplierArticle(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value === Math.trunc(value)) {
    return String(Math.trunc(value));
  }
  return String(value ?? '').trim();
}

function parsePrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** Строит индекс digitKey → { price, article }. */
export function buildSupplierPriceIndex(rows) {
  const byDigitKey = new Map();

  for (const row of rows) {
    const article = row?.[0];
    const price = parsePrice(row?.[3]);
    if (article == null || article === '' || price == null) continue;

    const digitKey = articleDigitKey(article);
    if (!digitKey) continue;

    byDigitKey.set(digitKey, {
      price,
      article: formatSupplierArticle(article),
    });
  }

  return byDigitKey;
}

export function serializeSupplierIndex(byDigitKey) {
  return Object.fromEntries(
    [...byDigitKey.entries()].map(([key, value]) => [key, value])
  );
}

export function deserializeSupplierIndex(data) {
  const byDigitKey = new Map();
  const source = data?.byDigitKey && typeof data.byDigitKey === 'object' ? data.byDigitKey : data;

  for (const [key, value] of Object.entries(source || {})) {
    const price = typeof value === 'number' ? value : Number(value?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    byDigitKey.set(key, {
      price,
      article: value?.article ? String(value.article) : key,
    });
  }

  return byDigitKey;
}

export function lookupSupplierPrice(vendorCode, byDigitKey) {
  if (!vendorCode || !byDigitKey?.size) return null;
  const hit = byDigitKey.get(articleDigitKey(vendorCode));
  return hit?.price ?? null;
}

function loadBundledSupplierIndex() {
  try {
    const raw = readFileSync(BUNDLED_PATH, 'utf8');
    const data = JSON.parse(raw);
    return {
      byDigitKey: deserializeSupplierIndex(data),
      syncedAt: data.syncedAt || null,
      source: data.source || 'bundled',
    };
  } catch {
    return { byDigitKey: new Map(), syncedAt: null, source: 'missing' };
  }
}

function extractVkDownloadUrl(html) {
  const normalized = String(html).replace(/\\\//g, '/');
  const match = normalized.match(/https:\/\/psv[^"'\s]+?\.xls[x]?/i);
  return match?.[0] || null;
}

export async function fetchSupplierWorkbookBuffer(vkDocUrl = DEFAULT_SUPPLIER_VK_DOC_URL) {
  const pageResponse = await fetch(vkDocUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wb-unit-calc/1.0)' },
  });

  if (!pageResponse.ok) {
    throw new Error(`VK документ недоступен (${pageResponse.status})`);
  }

  const html = await pageResponse.text();
  const fileUrl = extractVkDownloadUrl(html);
  if (!fileUrl) {
    throw new Error('Не удалось найти ссылку на прайс в документе VK');
  }

  const fileResponse = await fetch(fileUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; wb-unit-calc/1.0)',
      Referer: 'https://vk.com/',
    },
  });

  if (!fileResponse.ok) {
    throw new Error(`Прайс поставщика недоступен (${fileResponse.status})`);
  }

  return Buffer.from(await fileResponse.arrayBuffer());
}

export function parseSupplierWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return parseSupplierWorkbookData(workbook);
}

export function parseSupplierWorkbookData(workbook) {
  const sheetName = workbook.SheetNames.find((name) => name === 'TDSheet') || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Пропускаем заголовок «Остатки…» и строку с названиями колонок.
  const dataRows = rows.slice(2);
  const byDigitKey = buildSupplierPriceIndex(dataRows);

  return {
    byDigitKey,
    totalRows: dataRows.length,
    sheetName,
    matchedItems: byDigitKey.size,
  };
}

export async function fetchSupplierPriceIndex({
  vkDocUrl = process.env.SUPPLIER_VK_DOC_URL || DEFAULT_SUPPLIER_VK_DOC_URL,
  forceRefresh = false,
} = {}) {
  if (!forceRefresh && memoryCache && Date.now() - memoryCache.loadedAt < CACHE_TTL_MS) {
    return memoryCache;
  }

  try {
    const buffer = await fetchSupplierWorkbookBuffer(vkDocUrl);
    const parsed = parseSupplierWorkbook(buffer);
    memoryCache = {
      byDigitKey: parsed.byDigitKey,
      syncedAt: new Date().toISOString(),
      source: 'vk',
      totalRows: parsed.totalRows,
      loadedAt: Date.now(),
    };
    return memoryCache;
  } catch (error) {
    const bundled = loadBundledSupplierIndex();
    if (bundled.byDigitKey.size > 0) {
      memoryCache = {
        ...bundled,
        loadedAt: Date.now(),
        fallbackError: error.message,
      };
      return memoryCache;
    }
    throw error;
  }
}

export function collectSupplierPurchases(products, byDigitKey, purchaseOverrides = {}) {
  const matched = {};

  for (const product of products || []) {
    const vendorCode = String(product.vendorCode || '');
    if (!vendorCode) continue;

    const override = purchaseOverrides[vendorCode];
    if (override != null && override !== '') continue;

    const price = lookupSupplierPrice(vendorCode, byDigitKey);
    if (price != null) {
      matched[vendorCode] = price;
    }
  }

  return matched;
}
