import { withWbApiToken } from './wb-official-api.js';
import { articleDigitKey } from './unit-economics/article-match.js';
import { vendorLookupKeys } from './unit-economics/vendor-key.js';

const ADVERT_API = 'https://advert-api.wildberries.ru';

const ACTIVE_STATUSES = new Set([7, 9, 11]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function advertFetch(token, path, query = null) {
  const url = new URL(path, ADVERT_API);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: token,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(`WB Advert API ${response.status} ${path}: ${text.slice(0, 200)}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function collectAdvertIds(countPayload) {
  const ids = new Set();
  for (const group of countPayload?.adverts || []) {
    if (!ACTIVE_STATUSES.has(group.status)) continue;
    for (const item of group.advert_list || []) {
      if (item.advertId) ids.add(item.advertId);
    }
  }
  return [...ids];
}

function aggregateNmFromFullstats(campaigns, byNm) {
  for (const campaign of campaigns || []) {
    const layers = [];

    if (Array.isArray(campaign.days) && campaign.days.length) {
      for (const day of campaign.days) {
        for (const app of day.apps || []) {
          layers.push(...(app.nms || []));
        }
      }
    }

    if (Array.isArray(campaign.nms) && campaign.nms.length) {
      layers.push(...campaign.nms);
    }

    for (const nm of layers) {
      const nmId = Number(nm.nmId || nm.nm_id);
      if (!nmId) continue;

      const spend = Number(nm.sum) || 0;
      const revenue = Number(nm.sum_price) || 0;
      const orders = Number(nm.orders) || 0;
      if (spend <= 0 && revenue <= 0 && orders <= 0) continue;

      const stat = byNm.get(nmId) || { spend: 0, revenue: 0, orders: 0 };
      stat.spend += spend;
      stat.revenue += revenue;
      stat.orders += orders;
      byNm.set(nmId, stat);
    }
  }
}

function finalizeDrr(byNm, salesRevenueByNm = new Map()) {
  let globalSpend = 0;
  let globalRevenue = 0;
  const result = new Map();

  for (const [nmId, stat] of byNm) {
    globalSpend += stat.spend;
    const salesRevenue = salesRevenueByNm.get(nmId) || 0;
    const denom = salesRevenue > 0 ? salesRevenue : stat.revenue;
    if (denom > 0) globalRevenue += denom;

    const advertisingDrr = stat.spend > 0 && denom > 0 ? stat.spend / denom : null;

    result.set(nmId, {
      adSpend: stat.spend,
      adRevenue: stat.revenue,
      adOrders: stat.orders,
      salesRevenue,
      advertisingDrr,
    });
  }

  return {
    byNmId: result,
    globalAdvertisingDrr: globalRevenue > 0 && globalSpend > 0 ? globalSpend / globalRevenue : null,
    totalAdSpend: globalSpend,
  };
}

/**
 * Средняя доля рекламных расходов (ДРР) по каждому nmId за период.
 * Источник: GET /adv/v3/fullstats (категория «Продвижение» в токене).
 */
export async function fetchNmAdvertStats(
  token,
  { days = 30, salesRevenueByNm = new Map(), maxCampaignChunks } = {}
) {
  return withWbApiToken(token, async () => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const beginDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);

    let advertIds = [];
    try {
      const countPayload = await advertFetch(token, '/adv/v1/promotion/count');
      advertIds = collectAdvertIds(countPayload);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        return {
          byNmId: new Map(),
          globalAdvertisingDrr: null,
          totalAdSpend: 0,
          period: { beginDate, endDate },
          error: 'Нет доступа к API Продвижения — добавьте категорию в токен WB',
        };
      }
      throw error;
    }

    if (!advertIds.length) {
      return {
        byNmId: new Map(),
        globalAdvertisingDrr: null,
        totalAdSpend: 0,
        period: { beginDate, endDate },
      };
    }

    const byNm = new Map();
    const chunkSize = 50;
    const maxChunks =
      maxCampaignChunks != null ? Math.max(1, Number(maxCampaignChunks) || 1) : Infinity;
    const idsToFetch = advertIds.slice(0, chunkSize * maxChunks);

    for (let offset = 0; offset < idsToFetch.length; offset += chunkSize) {
      const chunk = idsToFetch.slice(offset, offset + chunkSize);
      const stats = await advertFetch(token, '/adv/v3/fullstats', {
        ids: chunk.join(','),
        beginDate,
        endDate,
      });

      aggregateNmFromFullstats(stats, byNm);

      if (offset + chunkSize < idsToFetch.length) {
        await sleep(21000);
      }
    }

    const finalized = finalizeDrr(byNm, salesRevenueByNm);

    return {
      ...finalized,
      period: { beginDate, endDate },
      campaigns: advertIds.length,
    };
  });
}

function vendorAdvertKeys(vendorCode) {
  const keys = [...vendorLookupKeys(vendorCode)];
  const digit = articleDigitKey(vendorCode);
  if (digit.length >= 3) keys.push(digit);
  return [...new Set(keys.filter(Boolean))];
}

function pickSerializedEntry(serialized, id) {
  if (!serialized || id == null || id === '') return null;
  return serialized[id] ?? serialized[String(id)] ?? null;
}

function packAdvertHit(hit) {
  if (!hit) return null;
  return {
    adSpend: Number(hit.s) || 0,
    advertisingDrr: hit.d != null && hit.d > 0 ? hit.d : null,
  };
}

/** Компактный снимок для meta / workspace: { [nmId]: { s: spend, d: drr } }. */
export function serializeAdvertByNmId(byNmId) {
  if (!byNmId?.size) return null;
  const out = {};
  for (const [nmId, stat] of byNmId) {
    const spend = Number(stat.adSpend) || 0;
    const drr = Number(stat.advertisingDrr);
    if (spend > 0 || (Number.isFinite(drr) && drr > 0)) {
      out[String(nmId)] = { s: spend, d: Number.isFinite(drr) && drr > 0 ? drr : null };
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Индекс рекламы по артикулу продавца — если nmId в каталоге не совпал с API Продвижения. */
export function serializeAdvertByVendor(byNmIdMap, products = []) {
  if (!byNmIdMap?.size || !products?.length) return null;
  const out = {};
  for (const product of products) {
    const nmId = Number(product.nmId) || 0;
    if (!nmId) continue;
    const stat = byNmIdMap.get(nmId);
    if (!stat) continue;
    const spend = Number(stat.adSpend) || 0;
    const drr = Number(stat.advertisingDrr);
    if (spend <= 0 && !(Number.isFinite(drr) && drr > 0)) continue;
    const pack = { s: spend, d: Number.isFinite(drr) && drr > 0 ? drr : null };
    for (const key of vendorAdvertKeys(product.vendorCode)) {
      out[key] = pack;
    }
  }
  return Object.keys(out).length ? out : null;
}

export function serializeAdvertLookup(byNmIdMap, products = []) {
  return {
    byNmId: serializeAdvertByNmId(byNmIdMap),
    byVendor: serializeAdvertByVendor(byNmIdMap, products),
  };
}

export function lookupAdvertStat(serialized, nmId, fallbackNmId = 0) {
  if (!serialized) return null;
  const hit =
    pickSerializedEntry(serialized, nmId) ||
    pickSerializedEntry(serialized, fallbackNmId);
  return packAdvertHit(hit);
}

export function lookupAdvertStatByVendor(serialized, vendorCode) {
  if (!serialized || !vendorCode) return null;
  for (const key of vendorAdvertKeys(vendorCode)) {
    const hit = packAdvertHit(serialized[key]);
    if (hit && (hit.adSpend > 0 || hit.advertisingDrr > 0)) return hit;
  }
  return null;
}
