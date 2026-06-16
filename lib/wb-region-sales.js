import { withWbApiToken } from './wb-official-api.js';
import { formatLocalDate } from './wb-analytics-period.js';
import {
  filterTariffsForCargoType,
  warehouseAcceptsCargoType,
  WB_CARGO,
} from './wb-cargo-type.js';
import { defaultWarehousesForFo, foZoneKey } from './wb-warehouse-fo.js';

const ANALYTICS_API = 'https://seller-analytics-api.wildberries.ru';
const STATISTICS_API = 'https://statistics-api.wildberries.ru';
const MAX_DAYS = 31;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  next.setHours(12, 0, 0, 0);
  return next;
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function rowQty(row) {
  return Math.max(0, Number(row.saleItemInvoiceQty ?? row.sale_item_invoice_qty) || 0);
}

function rowRevenue(row) {
  return Math.max(0, Number(row.saleInvoiceCostPrice ?? row.sale_invoice_cost_price) || 0);
}

function rowNmId(row) {
  return Number(row.nmID ?? row.nmId ?? row.nm_id) || 0;
}

function rowVendor(row) {
  return String(row.sa ?? row.supplierArticle ?? row.vendorCode ?? '').trim();
}

export function formatRegionFetchError(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/401|403|unauthorized|withdrawn/i.test(text)) {
    return 'Токен отклонён WB — обновите ключ в разделе «Данные».';
  }
  if (/429|too many/i.test(text)) {
    return 'Лимит WB на отчёт по регионам — подождите 10–20 сек и нажмите «Быстро» снова.';
  }
  return text.replace(/^WB region-sale \d+:\s*/i, 'WB: ');
}

async function fetchRegionSaleAnalytics(token, { days = 30 } = {}) {
  const span = Math.min(Math.max(1, days), MAX_DAYS);
  const end = addDays(new Date(), 0);
  const start = addDays(end, -(span - 1));

  const dateFrom = formatLocalDate(start);
  const dateTo = formatLocalDate(end);

  const url = new URL('/api/v1/analytics/region-sale', ANALYTICS_API);
  url.searchParams.set('dateFrom', dateFrom);
  url.searchParams.set('dateTo', dateTo);

  const response = await fetch(url, {
    headers: {
      Authorization: (token || '').trim(),
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`WB region-sale ${response.status}: ${text.slice(0, 200)}`);
  }

  const payload = await response.json();
  const report = Array.isArray(payload?.report) ? payload.report : Array.isArray(payload) ? payload : [];

  return {
    period: { dateFrom, dateTo, days: span },
    report,
    rowCount: report.length,
    source: 'analytics-region-sale',
  };
}

/** Запасной источник — заказы из Statistics API (regionName в каждой строке). */
async function fetchOrdersRegionStats(token, { days = 30 } = {}) {
  const span = Math.min(Math.max(1, days), MAX_DAYS);
  const end = addDays(new Date(), 0);
  const start = addDays(end, -(span - 1));
  const period = {
    dateFrom: formatLocalDate(start),
    dateTo: formatLocalDate(end),
    days: span,
  };

  let dateFrom = start.toISOString();
  const report = [];

  for (let page = 0; page < 25; page += 1) {
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

    for (const row of rows) {
      if (row.isCancel) continue;
      const nmId = Number(row.nmId ?? row.nm_id) || 0;
      if (!nmId) continue;
      report.push({
        regionName: row.regionName || row.region_name || '',
        foName: row.oblastOkrugName || row.oblast_okrug_name || '',
        cityName: row.city || row.cityName || '',
        nmID: nmId,
        sa: row.supplierArticle || row.supplier_article || '',
        saleItemInvoiceQty: 1,
        saleInvoiceCostPrice:
          Number(row.finishedPrice || row.totalPrice || row.priceWithDisc || row.finished_price) || 0,
      });
    }

    const last = rows[rows.length - 1];
    const nextFrom = last.lastChangeDate || last.last_change_date || last.date;
    if (!nextFrom || nextFrom === dateFrom) break;
    dateFrom = nextFrom;
    await sleep(320);
  }

  return {
    period,
    report,
    rowCount: report.length,
    source: 'statistics-orders',
  };
}

/** Продажи по регионам: Analytics region-sale, при пустом ответе — заказы Statistics. */
export async function fetchRegionSalesReport(token, { days = 30 } = {}) {
  return withWbApiToken(token, async () => {
    let analyticsError = null;

    try {
      const analytics = await fetchRegionSaleAnalytics(token, { days });
      if (analytics.report.length > 0) {
        return { ...analytics, error: null };
      }
    } catch (err) {
      analyticsError = err.message || 'Не удалось загрузить region-sale';
    }

    try {
      const orders = await fetchOrdersRegionStats(token, { days });
      return {
        ...orders,
        error:
          orders.report.length > 0
            ? analyticsError
              ? formatRegionFetchError(analyticsError)
              : null
            : formatRegionFetchError(analyticsError) || null,
      };
    } catch (ordersErr) {
      throw new Error(formatRegionFetchError(analyticsError || ordersErr.message));
    }
  });
}

function bumpBucket(map, key, { label, qty, revenue, cityName, regionName, foName, nmId, vendorCode }) {
  if (!key) return;
  let entry = map.get(key);
  if (!entry) {
    entry = {
      key,
      label: label || key,
      regionName: regionName || '',
      foName: foName || '',
      cityName: cityName || '',
      qty: 0,
      revenue: 0,
      nmIds: new Set(),
      vendors: new Set(),
    };
    map.set(key, entry);
  }
  entry.qty += qty;
  entry.revenue += revenue;
  if (nmId) entry.nmIds.add(nmId);
  if (vendorCode) entry.vendors.add(vendorCode);
}

function finalizeBuckets(map, totalQty) {
  return [...map.values()]
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      regionName: entry.regionName,
      foName: entry.foName,
      cityName: entry.cityName,
      qty: entry.qty,
      revenue: Math.round(entry.revenue * 100) / 100,
      sharePct: totalQty > 0 ? entry.qty / totalQty : 0,
      skuCount: entry.nmIds.size,
      vendorCount: entry.vendors.size,
    }))
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
}

const FO_WAREHOUSE_HINTS = [
  {
    pattern: /центральн|москов|тула|калуж|рязан|владимир|твер|ярослав|смолен|брян|орлов|курск|липец|тамбов/i,
    warehouses: ['Коледино', 'Подольск', 'Электросталь', 'Обухово', 'Алексин', 'Тула'],
  },
  {
    pattern: /северо-запад|ленинград|петербург|псков|новгород|карел|мурман|архангельск|коми|калининград/i,
    warehouses: ['Санкт-Петербург', 'Уткина Заводь', 'Шушары'],
  },
  {
    pattern: /южн|краснодар|ростов|волгоград|ставрополь|адыге|крым|севастополь|калмык|дагестан/i,
    warehouses: ['Краснодар', 'Невинномысск', 'Волгоград'],
  },
  {
    pattern: /приволж|татар|башкорт|самар|нижегород|перм|удмурт|чуваш|марий|мордов|оренбург|саратов|ульянов|пенз/i,
    warehouses: ['Казань', 'Самара', 'Пенза', 'Новосемейкино'],
  },
  {
    pattern: /ураль|свердлов|челябин|тюмен|курган|хмао|янао/i,
    warehouses: ['Екатеринбург', 'Челябинск', 'Тюмень'],
  },
  {
    pattern: /сибир|новосибир|омск|краснояр|иркут|алтай|хакас|тува|бурят|забайкал/i,
    warehouses: ['Новосибирск', 'Красноярск', 'Омск'],
  },
  {
    pattern: /дальн|примор|хабаров|сахалин|камчат|амур|магадан|якут/i,
    warehouses: ['Хабаровск', 'Владивосток'],
  },
  {
    pattern: /северн|якут|чукот/i,
    warehouses: ['Хабаровск', 'Новосибирск'],
  },
];

function scoreWarehouseName(name, haystack) {
  const key = normalizeText(name);
  if (!key) return 0;
  if (haystack.includes(key)) return 4;
  const parts = key.split(/\s+/).filter((p) => p.length >= 4);
  return parts.some((part) => haystack.includes(part)) ? 2 : 0;
}

/** Название федерального округа, не склада WB. */
export function isFederalDistrictLabel(name) {
  const hay = normalizeText(name);
  if (!hay) return false;
  if (/федеральн|фо\b|округ/.test(hay)) return true;
  return /^(центральн|северо-западн|южн|северо-кавказск|приволжск|уральск|сибирск|дальневосточн)/.test(
    hay
  );
}

function isValidWarehouseLabel(name, cargoType = WB_CARGO.MGT) {
  const label = String(name || '').trim();
  return Boolean(label) && !isFederalDistrictLabel(label) && warehouseAcceptsCargoType(label, cargoType);
}

function filterWarehouseNames(names = [], cargoType = WB_CARGO.MGT) {
  return names.filter((name) => isValidWarehouseLabel(name, cargoType));
}

function sanitizeWarehouseDemand(entries = [], cargoType = WB_CARGO.MGT) {
  return entries.filter((entry) => isValidWarehouseLabel(entry.warehouseName || entry.label, cargoType));
}

export function suggestWarehousesForLocation(
  { regionName, foName, cityName },
  tariffList = [],
  { cargoType = WB_CARGO.MGT } = {}
) {
  const haystack = normalizeText([regionName, foName, cityName].filter(Boolean).join(' '));
  const scores = new Map();
  const eligibleTariffs = filterTariffsForCargoType(tariffList, cargoType);

  for (const hint of FO_WAREHOUSE_HINTS) {
    if (!hint.pattern.test(haystack)) continue;
    for (const name of hint.warehouses) {
      if (!warehouseAcceptsCargoType(name, cargoType)) continue;
      scores.set(name, (scores.get(name) || 0) + 3);
    }
  }

  for (const tariff of eligibleTariffs) {
    const warehouseName = String(tariff.warehouseName || '').trim();
    if (!warehouseName) continue;
    let score = scoreWarehouseName(warehouseName, haystack);
    const geo = normalizeText(tariff.geoName);
    if (geo && (haystack.includes(geo) || geo.includes(haystack.split(' ')[0] || ''))) {
      score += 2;
    }
    if (score > 0) scores.set(warehouseName, (scores.get(warehouseName) || 0) + score);
  }

  if (!scores.size) {
    const foFallback = defaultWarehousesForFo(foName || regionName || cityName);
    for (const name of foFallback) {
      if (!warehouseAcceptsCargoType(name, cargoType)) continue;
      scores.set(name, 2);
    }
  }

  if (!scores.size && foZoneKey(foName || regionName)) {
    for (const name of defaultWarehousesForFo(foName || regionName)) {
      if (!warehouseAcceptsCargoType(name, cargoType)) continue;
      scores.set(name, 1);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name]) => name);
}

function forceWarehouseSuggestionsForRegion(entry) {
  return defaultWarehousesForFo(entry.foName || entry.regionName || entry.label).slice(0, 4);
}

function resolveRegionSuggestedWarehouses(entry, tariffList, cargoType) {
  const suggested = suggestWarehousesForLocation(entry, tariffList, { cargoType });
  if (suggested.length) return suggested;

  const cached = filterWarehouseNames(entry.suggestedWarehouses, cargoType);
  if (cached.length) return cached;

  return forceWarehouseSuggestionsForRegion(entry);
}

function rebuildWarehouseDemand(regions, totalQty) {
  const warehouseDemand = new Map();
  for (const region of regions) {
    const suggested = region.suggestedWarehouses || [];
    if (!suggested.length) continue;
    const portion = region.qty / suggested.length;
    for (const warehouseName of suggested) {
      const key = normalizeText(warehouseName);
      const hit = warehouseDemand.get(key) || {
        warehouseName,
        qty: 0,
        revenue: 0,
        regions: [],
      };
      hit.qty += portion;
      hit.revenue += region.revenue / suggested.length;
      hit.regions.push(region.label || region.regionName || '');
      warehouseDemand.set(key, hit);
    }
  }

  return [...warehouseDemand.values()]
    .map((entry) => ({
      key: normalizeText(entry.warehouseName),
      label: entry.warehouseName,
      warehouseName: entry.warehouseName,
      qty: Math.round(entry.qty),
      revenue: Math.round(entry.revenue * 100) / 100,
      sharePct: totalQty > 0 ? entry.qty / totalQty : 0,
      regions: [...new Set(entry.regions.filter(Boolean))].slice(0, 6),
    }))
    .sort((a, b) => b.qty - a.qty);
}

function rebuildWarehouseDemandFromRegions(regions, totalQty, cargoType = WB_CARGO.MGT) {
  const prepared = regions.map((entry) => ({
    ...entry,
    suggestedWarehouses: resolveRegionSuggestedWarehouses(entry, [], cargoType),
  }));
  return sanitizeWarehouseDemand(rebuildWarehouseDemand(prepared, totalQty), cargoType);
}

/** Пересчёт складов на клиенте после подгрузки тарифов (F5 / устаревший снимок). */
export function enrichRegionDemandSnapshot(
  snapshot,
  { tariffList = [], cargoType = WB_CARGO.MGT } = {}
) {
  if (!snapshot?.byRegion?.length) return snapshot;

  const warehouseCargoType = cargoType === WB_CARGO.SGT ? WB_CARGO.SGT : WB_CARGO.MGT;

  let byRegion = snapshot.byRegion.map((entry) => ({
    ...entry,
    suggestedWarehouses: resolveRegionSuggestedWarehouses(entry, tariffList, warehouseCargoType),
  }));

  let warehouses = sanitizeWarehouseDemand(
    rebuildWarehouseDemand(byRegion, snapshot.totalQty || 0),
    warehouseCargoType
  );

  if (!warehouses.length) {
    byRegion = snapshot.byRegion.map((entry) => ({
      ...entry,
      suggestedWarehouses: forceWarehouseSuggestionsForRegion(entry),
    }));
    warehouses = sanitizeWarehouseDemand(
      rebuildWarehouseDemand(byRegion, snapshot.totalQty || 0),
      warehouseCargoType
    );
  }

  if (!warehouses.length) {
    warehouses = rebuildWarehouseDemandFromRegions(snapshot.byRegion, snapshot.totalQty || 0, warehouseCargoType);
  }

  return {
    ...snapshot,
    byRegion,
    warehouses,
  };
}

export function buildRegionDemandSnapshot(
  reportRows,
  { catalogNmIds = null, tariffList = [], cargoType = WB_CARGO.MGT } = {}
) {
  const rows = (reportRows || []).filter((row) => {
    const qty = rowQty(row);
    if (qty <= 0) return false;
    if (!catalogNmIds?.size) return true;
    const nmId = rowNmId(row);
    return nmId && catalogNmIds.has(nmId);
  });

  const byRegion = new Map();
  const byFo = new Map();
  const byCity = new Map();
  const byNmId = new Map();
  const byNmIdRegion = new Map();
  let totalQty = 0;
  let totalRevenue = 0;

  for (const row of rows) {
    const qty = rowQty(row);
    const revenue = rowRevenue(row);
    const foName = String(row.foName || row.fo_name || row.oblastOkrugName || 'Не указан').trim() || 'Не указан';
    let regionName = String(row.regionName || row.region_name || '').trim();
    const cityName = String(row.cityName || row.city_name || '').trim();
    if (!regionName || /^не указан$/i.test(regionName)) {
      regionName = cityName || foName;
    }
    regionName = regionName || 'Не указан';
    const nmId = rowNmId(row);
    const vendorCode = rowVendor(row);

    totalQty += qty;
    totalRevenue += revenue;

    bumpBucket(byRegion, normalizeText(regionName), {
      label: regionName,
      qty,
      revenue,
      regionName,
      foName,
      nmId,
      vendorCode,
    });
    bumpBucket(byFo, normalizeText(foName), {
      label: foName,
      qty,
      revenue,
      regionName,
      foName,
      nmId,
      vendorCode,
    });
    if (cityName) {
      bumpBucket(byCity, `${normalizeText(regionName)}::${normalizeText(cityName)}`, {
        label: cityName,
        qty,
        revenue,
        regionName,
        foName,
        cityName,
        nmId,
        vendorCode,
      });
    }
    if (nmId) {
      bumpBucket(byNmId, String(nmId), {
        label: vendorCode || String(nmId),
        qty,
        revenue,
        regionName,
        foName,
        cityName,
        nmId,
        vendorCode,
      });
      bumpBucket(byNmIdRegion, `${nmId}::${normalizeText(regionName)}`, {
        label: vendorCode || String(nmId),
        qty,
        revenue,
        regionName,
        foName,
        cityName,
        nmId,
        vendorCode,
      });
    }
  }

  const regions = finalizeBuckets(byRegion, totalQty).map((entry) => ({
    ...entry,
    suggestedWarehouses: resolveRegionSuggestedWarehouses(entry, tariffList, cargoType),
  }));

  const warehouseCargoType = cargoType === WB_CARGO.SGT ? WB_CARGO.SGT : WB_CARGO.MGT;
  let warehouses = sanitizeWarehouseDemand(rebuildWarehouseDemand(regions, totalQty), warehouseCargoType);
  if (!warehouses.length) {
    const forcedRegions = regions.map((entry) => ({
      ...entry,
      suggestedWarehouses: forceWarehouseSuggestionsForRegion(entry),
    }));
    warehouses = sanitizeWarehouseDemand(rebuildWarehouseDemand(forcedRegions, totalQty), warehouseCargoType);
  }

  return {
    totalQty,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    rowCount: rows.length,
    filteredByCatalog: Boolean(catalogNmIds?.size),
    byRegion: regions,
    byFo: finalizeBuckets(byFo, totalQty),
    byCity: finalizeBuckets(byCity, totalQty).slice(0, 100),
    byNmId: finalizeBuckets(byNmId, totalQty).slice(0, 50),
    byNmIdRegion: finalizeBuckets(byNmIdRegion, totalQty)
      .map((entry) => ({
        ...entry,
        nmId: entry.nmId || Number(entry.key?.split('::')[0]) || 0,
        vendorCode: entry.vendorCode || entry.label || '',
        regionLabel: entry.regionName || entry.label || '',
      }))
      .slice(0, 300),
    warehouses,
  };
}

export function serializeRegionDemandSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    totalQty: snapshot.totalQty ?? 0,
    totalRevenue: snapshot.totalRevenue ?? 0,
    rowCount: snapshot.rowCount ?? 0,
    filteredByCatalog: snapshot.filteredByCatalog ?? false,
    byRegion: snapshot.byRegion ?? [],
    byFo: snapshot.byFo ?? [],
    byCity: snapshot.byCity ?? [],
    byNmId: snapshot.byNmId ?? [],
    byNmIdRegion: snapshot.byNmIdRegion ?? [],
    warehouses: sanitizeWarehouseDemand(snapshot.warehouses ?? []),
  };
}
