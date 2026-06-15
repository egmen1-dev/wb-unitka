import { normalizeWarehouseKey } from './wb-warehouse-tariffs.js';

/** Объединённые зоны WB (заказы внутри зоны = локальные). */
const MERGED_FO_ZONES = [
  ['северо-кавказский', 'южный'],
  ['сибирский', 'дальневосточный'],
];

const WAREHOUSE_FO_PATTERNS = [
  { pattern: /коледино|подольск|электросталь|обухово|алексин|тула|рязань|котовск/i, zone: 'центральный' },
  { pattern: /санкт-петербург|уткина|шушары|петербург/i, zone: 'северо-западный' },
  { pattern: /краснодар|невинномысск|волгоград/i, zone: 'южный' },
  { pattern: /казань|самара|пенза|новосемейкино|ижевск|пермь/i, zone: 'приволжский' },
  { pattern: /екатеринбург|челябинск|тюмень/i, zone: 'уральский' },
  { pattern: /новосибирск|красноярск|омск|барнаул/i, zone: 'сибирский' },
  { pattern: /хабаровск|владивосток/i, zone: 'дальневосточный' },
];

function normalizeFoText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

/** Ключ федерального округа с учётом объединённых зон WB. */
export function foZoneKey(foName) {
  const haystack = normalizeFoText(foName);
  if (!haystack) return '';

  for (const zone of MERGED_FO_ZONES) {
    if (zone.some((part) => haystack.includes(part))) {
      return zone.join('+');
    }
  }

  const match = haystack.match(
    /(центральн|северо-западн|южн|северо-кавказск|приволжск|уральск|сибирск|дальневосточн)/
  );
  return match ? match[1] : haystack.split(/\s+/)[0] || haystack;
}

function warehouseFoFromPatterns(warehouseName) {
  const key = normalizeFoText(warehouseName);
  if (!key) return '';
  for (const { pattern, zone } of WAREHOUSE_FO_PATTERNS) {
    if (pattern.test(key)) return zone;
  }
  return '';
}

/** Резолвер склада отгрузки → ФО (тарифы WB + эвристики по названию). */
export function buildWarehouseFoResolver(tariffByName = new Map()) {
  const byWarehouse = new Map();

  for (const [key, tariff] of tariffByName) {
    const fo = foZoneKey(tariff.geoName || '');
    if (fo) byWarehouse.set(key, fo);
  }

  return function resolveWarehouseFo(warehouseName) {
    const key = normalizeWarehouseKey(warehouseName);
    if (!key) return '';

    if (byWarehouse.has(key)) return byWarehouse.get(key);

    for (const [candidate, fo] of byWarehouse) {
      if (candidate.includes(key) || key.includes(candidate)) return fo;
    }

    return warehouseFoFromPatterns(warehouseName);
  };
}

export function isLocalWbOrder({ originFo, destinationFo }) {
  if (!originFo || !destinationFo) return null;
  return originFo === destinationFo;
}

export function isFbsOrderException(order) {
  const type = normalizeFoText(order?.warehouseType);
  return type.includes('продавца') || type.includes('marketplace') || type.includes('fbs');
}
