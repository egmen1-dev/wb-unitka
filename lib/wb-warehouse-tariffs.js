/** Нормализация названия склада WB для сопоставления тарифов. */
export function normalizeWarehouseKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/ё/g, 'е');
}

export function parseRuNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value || value === '-') return null;
  const parsed = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Одна строка warehouseList из GET /api/v1/tariffs/box. */
export function parseBoxTariffRow(row = {}) {
  const warehouseName = String(row.warehouseName || '').trim();
  const fbsFirst = parseRuNumber(row.boxDeliveryMarketplaceBase);
  const fbsExtra = parseRuNumber(row.boxDeliveryMarketplaceLiter);

  return {
    warehouseName,
    geoName: row.geoName || '',
    firstLiter: parseRuNumber(row.boxDeliveryBase) ?? 46,
    additionalLiter: parseRuNumber(row.boxDeliveryLiter) ?? 14,
    warehouseCoeff: (parseRuNumber(row.boxDeliveryCoefExpr) ?? 100) / 100,
    storageBasePerLiter: parseRuNumber(row.boxStorageBase) ?? 0.07,
    storageAdditionalPerLiter: parseRuNumber(row.boxStorageLiter) ?? 0.07,
    storageCoeff: (parseRuNumber(row.boxStorageCoefExpr) ?? 100) / 100,
    fbsFirstLiter: fbsFirst ?? 40,
    fbsAdditionalLiter: fbsExtra ?? 11,
    fbsCoeff: (parseRuNumber(row.boxDeliveryMarketplaceCoefExpr) ?? 100) / 100,
  };
}

export function buildTariffIndex(warehouseList = []) {
  const byName = new Map();
  for (const row of warehouseList) {
    const tariff = parseBoxTariffRow(row);
    if (!tariff.warehouseName || /цифровой/i.test(tariff.warehouseName)) continue;
    byName.set(normalizeWarehouseKey(tariff.warehouseName), tariff);
  }
  return byName;
}

export function pickDefaultBoxTariff(warehouseList = []) {
  const parsed = warehouseList
    .map(parseBoxTariffRow)
    .filter((t) => t.warehouseName && !/цифровой/i.test(t.warehouseName));
  return (
    parsed.find((t) => t.firstLiter > 0 && t.warehouseCoeff > 0) ||
    parsed[0] ||
    parseBoxTariffRow({})
  );
}

/** Сопоставление названия склада / офиса WB с тарифом коробов. */
export function lookupWarehouseTariff(byName, warehouseName, fallback) {
  if (!byName?.size) return fallback;
  const key = normalizeWarehouseKey(warehouseName);
  if (!key) return fallback;

  if (byName.has(key)) return byName.get(key);

  for (const [candidate, tariff] of byName) {
    if (candidate.includes(key) || key.includes(candidate)) return tariff;
  }

  return fallback;
}

/** Склад FBO с наибольшим остатком. */
export function pickPrimaryFboWarehouse(stockDetail) {
  const list = stockDetail?.warehouses || [];
  if (!list.length) return null;
  return [...list].sort((a, b) => b.qty - a.qty)[0];
}

export function resolveOfficeName(officesById, officeId) {
  if (officeId == null) return '';
  const office = officesById?.get?.(Number(officeId));
  return office?.name || office?.warehouseName || office?.city || '';
}

export function resolveSellerOfficeId(warehouse) {
  if (!warehouse) return null;
  const id = warehouse.officeId ?? warehouse.officeID ?? warehouse.office_id;
  return id != null ? Number(id) : null;
}

export function buildOfficesIndex(offices = []) {
  const byId = new Map();
  const byName = new Map();
  for (const office of offices) {
    const id = Number(office.id ?? office.officeId);
    if (id) byId.set(id, office);
    const name = office.name || office.warehouseName || '';
    if (name) byName.set(normalizeWarehouseKey(name), office);
  }
  return { byId, byName };
}

export function lookupFbsTariff({ tariffByName, defaultTariff, officeName, sellerWarehouseName }) {
  for (const name of [officeName, sellerWarehouseName].filter(Boolean)) {
    const hit = lookupWarehouseTariff(tariffByName, name, null);
    if (hit) return hit;
  }
  return defaultTariff;
}
