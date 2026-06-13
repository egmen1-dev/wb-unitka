import * as XLSX from 'xlsx';
import { articleDigitKey } from '@lib/unit-economics/article-match.js';

export function createCatalogId() {
  return `sup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function parsePrice(value) {
  const n = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildByDigitKeyFromRows(dataRows) {
  const byDigitKey = {};
  for (const row of dataRows) {
    const article = row?.[0];
    const price = parsePrice(row?.[3]);
    if (article == null || article === '' || price == null) continue;
    const digitKey = articleDigitKey(article);
    if (!digitKey) continue;
    byDigitKey[digitKey] = price;
  }
  return byDigitKey;
}

/** Парсинг XLS/XLSX в браузере — без отправки на сервер. */
export async function parseSupplierFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames.find((name) => name === 'TDSheet') || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const dataRows = rows.slice(2);
  const byDigitKey = buildByDigitKeyFromRows(dataRows);

  if (!Object.keys(byDigitKey).length) {
    throw new Error(
      'Не найдено цен. Нужен XLS/XLSX с колонками «Артикул» (A) и «Цена» (D), как в прайсе поставщика.'
    );
  }

  return {
    fileName: file.name,
    fileSize: file.size,
    totalItems: Object.keys(byDigitKey).length,
    sheetName,
    byDigitKey,
  };
}

export function lookupCatalogPrice(vendorCode, byDigitKey) {
  if (!vendorCode || !byDigitKey) return null;
  const hit = byDigitKey[articleDigitKey(vendorCode)];
  const price = typeof hit === 'number' ? hit : hit?.price;
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function applyCatalogToPurchases(vendorCodes, byDigitKey, purchases = {}) {
  const next = { ...purchases };
  let matched = 0;

  for (const vendorCode of vendorCodes) {
    const key = String(vendorCode || '');
    if (!key) continue;

    const price = lookupCatalogPrice(key, byDigitKey);
    if (price != null) {
      next[key] = price;
      matched += 1;
    }
  }

  return { purchases: next, matched };
}

export function countCatalogMatches(vendorCodes, byDigitKey) {
  let matched = 0;
  for (const vendorCode of vendorCodes) {
    if (lookupCatalogPrice(vendorCode, byDigitKey) != null) matched += 1;
  }
  return matched;
}

export function getActiveCatalog(catalogState) {
  if (!catalogState?.activeId) return null;
  return catalogState.items?.find((item) => item.id === catalogState.activeId) || null;
}

export function formatCatalogDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatFileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function buildCatalogEntry(parsed, file) {
  return {
    id: createCatalogId(),
    fileName: parsed.fileName || file.name,
    uploadedAt: new Date().toISOString(),
    fileSize: parsed.fileSize || file.size,
    totalItems: parsed.totalItems || Object.keys(parsed.byDigitKey || {}).length,
    sheetName: parsed.sheetName || '',
    byDigitKey: parsed.byDigitKey || {},
  };
}

export const EMPTY_CATALOG_STATE = {
  activeId: null,
  items: [],
};
