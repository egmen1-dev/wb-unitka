#!/usr/bin/env node
/**
 * Синхронизация юнит-экономики с WB API → Google Таблица
 * Закупочные цены (колонка K) НЕ перезаписываются.
 *
 * Нужно:
 *   WB_API_TOKEN в .env.local
 *   GOOGLE_SHEET_ID=id таблицы
 *   GOOGLE_SERVICE_ACCOUNT_PATH=путь к json ключу сервисного аккаунта
 *   Таблицу расшарить на email сервисного аккаунта (Редактор)
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envPath = resolve(root, '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && process.env[m[1].trim()] === undefined) {
      process.env[m[1].trim()] = m[2].trim();
    }
  }
}

const { fetchWbCatalogSnapshot } = await import('../lib/fetch-wb-catalog.js');
const { pushWbDataToGoogleSheet } = await import('../lib/push-to-sheet.js');

const sheetId = process.env.GOOGLE_SHEET_ID?.trim();
const jsonOnly = process.argv.includes('--json');

console.log('Загрузка данных из WB API...');
const snapshot = await fetchWbCatalogSnapshot();
console.log(`Товаров: ${snapshot.products.length}`);
console.log(`Тарифы логистики: ${snapshot.boxTariffs.firstLiter} + ${snapshot.boxTariffs.additionalLiter}/л`);

const cachePath = resolve(dirname(fileURLToPath(import.meta.url)), '../cache/wb-snapshot.json');
writeFileSync(cachePath, JSON.stringify(snapshot, null, 2));
console.log('Снимок:', cachePath);

if (jsonOnly || !sheetId) {
  if (!sheetId) {
    console.log('\nДля записи в Google Таблицу задайте GOOGLE_SHEET_ID в .env.local');
  }
  process.exit(0);
}

console.log(`Запись в Google Таблицу ${sheetId}...`);
const result = await pushWbDataToGoogleSheet(sheetId, snapshot);
console.log(`Готово: обновлено ${result.updatedRows} строк, закупки не тронуты.`);
