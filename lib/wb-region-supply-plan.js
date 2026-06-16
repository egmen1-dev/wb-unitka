import {
  krpForLocalizationShare,
  ktrForLocalizationShare,
  normalizeLocalizationIndex,
  normalizeSalesDistributionIndex,
} from './wb-localization-indices.js';
import {
  aggregateProductProfile,
  estimateFboLogisticsPerUnit,
  resolveRegionTariffContext,
} from './region-supply-recommendations.js';
import {
  isFederalDistrictLabel,
  suggestWarehousesForLocation,
} from './wb-region-sales.js';
import { buildWarehouseFoResolver, foZoneKey } from './wb-warehouse-fo.js';
import { lookupWarehouseTariff, normalizeWarehouseKey } from './wb-warehouse-tariffs.js';

function roundPct(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

function roundRub(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

function indexRowsByNmId(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const nmId = Number(row.nmId);
    if (nmId) map.set(nmId, row);
  }
  return map;
}

function stockAtWarehouse(stockByWarehouse = [], warehouseName) {
  const key = normalizeWarehouseKey(warehouseName);
  if (!key) return 0;
  for (const entry of stockByWarehouse) {
    const whKey = normalizeWarehouseKey(entry.name || entry.warehouseName);
    if (!whKey) continue;
    if (whKey === key || whKey.includes(key) || key.includes(whKey)) {
      return Math.max(0, Number(entry.qty) || 0);
    }
  }
  return 0;
}

function stockInFo(stockByWarehouse = [], destFo, resolveFo) {
  if (!destFo) return 0;
  let qty = 0;
  for (const entry of stockByWarehouse) {
    const name = entry.name || entry.warehouseName || '';
    const whFo = foZoneKey(resolveFo(name) || name);
    if (whFo && whFo === destFo) qty += Math.max(0, Number(entry.qty) || 0);
  }
  return qty;
}

function resolveTargetWarehouse(regionEntry, actionByRegion, tariffList, cargoType) {
  const action = actionByRegion.get(regionEntry.regionLabel || regionEntry.regionName || regionEntry.label);
  if (action?.warehouseName && !isFederalDistrictLabel(action.warehouseName)) {
    return action.warehouseName;
  }
  const suggested = suggestWarehousesForLocation(
    {
      regionName: regionEntry.regionName || regionEntry.regionLabel,
      foName: regionEntry.foName,
      cityName: regionEntry.cityName,
    },
    tariffList,
    { cargoType }
  ).filter((name) => !isFederalDistrictLabel(name));
  return suggested[0] || '';
}

function estimateArticleLocalizationShare(row, sellerAvgSharePct) {
  const stockByWarehouse = row.fboStockByWarehouse || [];
  const totalStock = Math.max(0, Number(row.stockFbo) || 0);
  if (!totalStock) {
    return Math.max(0, Math.min(100, Number(sellerAvgSharePct) || 0));
  }
  // Без данных по заказам на уровне артикула — ориентир на среднюю долю кабинета.
  return Math.max(0, Math.min(100, Number(sellerAvgSharePct) || 0));
}

function projectedShareAfterLocalizing(currentSharePct, articleOrders, regionOrders) {
  const orders = Math.max(0, Number(articleOrders) || 0);
  const extra = Math.max(0, Number(regionOrders) || 0);
  if (!orders || !extra) return currentSharePct;
  const localOrders = (currentSharePct / 100) * orders;
  const nonLocalInRegion = Math.min(extra, Math.max(0, orders - localOrders));
  return Math.min(100, ((localOrders + nonLocalInRegion) / orders) * 100);
}

function buildNmIdRegionRows(snapshot, rowsByNmId) {
  if (snapshot?.byNmIdRegion?.length) {
    return snapshot.byNmIdRegion.map((entry) => ({
      nmId: Number(entry.nmId) || Number(entry.key?.split('::')[0]) || 0,
      vendorCode: entry.vendorCode || entry.label || '',
      regionLabel: entry.regionLabel || entry.regionName || entry.label || '',
      foName: entry.foName || '',
      qty: Math.max(0, Number(entry.qty) || 0),
      revenue: Math.max(0, Number(entry.revenue) || 0),
      sharePct: entry.sharePct || 0,
    }));
  }

  const articleTotals = new Map((snapshot?.byNmId || []).map((item) => [Number(item.key), item]));
  const approx = [];
  for (const region of snapshot?.byRegion || []) {
    const regionShare = region.sharePct || 0;
    for (const [nmId, article] of articleTotals) {
      if (!nmId) continue;
      const qty = Math.round((article.qty || 0) * regionShare);
      if (!qty) continue;
      approx.push({
        nmId,
        vendorCode: article.label || '',
        regionLabel: region.label || region.regionName || '',
        foName: region.foName || '',
        qty,
        revenue: (article.revenue || 0) * regionShare,
        sharePct: (snapshot.totalQty || 0) > 0 ? qty / snapshot.totalQty : 0,
      });
    }
  }
  return approx;
}

/**
 * Влияние артикула в регионе на ИЛ кабинета: доля штрафа и потенциал улучшения при локальной отгрузке.
 */
export function buildRegionIlImpact({
  snapshot,
  rows = [],
  settings = {},
  meta = {},
  tariffCache = null,
  supplyPlan = null,
}) {
  const totalOrders = Math.max(0, Number(snapshot?.totalQty) || 0);
  if (!totalOrders) {
    return { rows: [], totalOrders: 0, localizationIndex: 1, summary: null };
  }

  const localizationIndex = normalizeLocalizationIndex(
    settings.localizationIndex ?? meta.localizationIndex ?? 1
  );
  const salesDistributionIndex = normalizeSalesDistributionIndex(
    settings.salesDistributionIndex ?? meta.salesDistributionIndex ?? 0
  );
  const sellerAvgSharePct = meta.avgLocalizationSharePct ?? null;
  const rowsByNmId = indexRowsByNmId(rows);
  const articleTotals = new Map(
    (snapshot.byNmId || []).map((item) => [Number(item.key), Math.max(0, Number(item.qty) || 0)])
  );

  const tariffCtx = resolveRegionTariffContext(tariffCache, rows, settings, meta);
  const resolveFo = buildWarehouseFoResolver(tariffCtx.byName);
  const actionByRegion = new Map();
  for (const action of supplyPlan?.actions || []) {
    actionByRegion.set(action.regionLabel, action);
  }

  const regionByLabel = new Map(
    (snapshot.byRegion || []).map((region) => [region.label || region.regionName, region])
  );

  const impactRows = [];
  for (const entry of buildNmIdRegionRows(snapshot, rowsByNmId)) {
    if (!entry.nmId || !entry.qty) continue;

    const productRow = rowsByNmId.get(entry.nmId);
    const articleOrders = articleTotals.get(entry.nmId) || entry.qty;
    const sharePct = entry.sharePct || entry.qty / totalOrders;
    const localizationSharePct = estimateArticleLocalizationShare(productRow, sellerAvgSharePct);
    const ktrCurrent = ktrForLocalizationShare(localizationSharePct);
    const projectedShare = projectedShareAfterLocalizing(
      localizationSharePct,
      articleOrders,
      entry.qty
    );
    const ktrProjected = ktrForLocalizationShare(projectedShare);
    const ktrDelta = Math.max(0, ktrCurrent - ktrProjected);

    const ilImpactPct = roundPct((sharePct * ktrCurrent) / localizationIndex * 100, 2);
    const ilImprovePct = roundPct((sharePct * ktrDelta) / localizationIndex * 100, 2);

    const regionMeta = regionByLabel.get(entry.regionLabel) || entry;
    const destFo = foZoneKey(entry.foName || regionMeta.foName || entry.regionLabel);
    const stockByWarehouse = productRow?.fboStockByWarehouse || [];
    const localStockQty = stockInFo(stockByWarehouse, destFo, resolveFo);
    const hasLocalStock = localStockQty > 0;

    const targetWarehouse = resolveTargetWarehouse(
      { ...entry, ...regionMeta },
      actionByRegion,
      tariffCtx.tariffList,
      tariffCtx.warehouseCargoType
    );

    impactRows.push({
      id: `${entry.nmId}-${entry.regionLabel}`,
      nmId: entry.nmId,
      vendorCode: entry.vendorCode || productRow?.vendorCode || String(entry.nmId),
      regionLabel: entry.regionLabel,
      foName: entry.foName || regionMeta.foName || '',
      orders: entry.qty,
      sharePct,
      revenue: roundRub(entry.revenue),
      localizationSharePct: roundPct(localizationSharePct, 0),
      ktrCurrent: roundPct(ktrCurrent, 2),
      ilImpactPct,
      ilImprovePct,
      hasLocalStock,
      localStockQty,
      targetWarehouse,
      priority: ilImprovePct || ilImpactPct || sharePct * 100,
    });
  }

  impactRows.sort(
    (a, b) =>
      (b.ilImprovePct || 0) - (a.ilImprovePct || 0) ||
      (b.ilImpactPct || 0) - (a.ilImpactPct || 0) ||
      b.orders - a.orders
  );

  const topImprove = impactRows.slice(0, 20).reduce((sum, row) => sum + (row.ilImprovePct || 0), 0);

  return {
    rows: impactRows,
    totalOrders,
    localizationIndex,
    salesDistributionIndex,
    summary: {
      topImprovePct: roundPct(topImprove, 1),
      rowsWithOpportunity: impactRows.filter((row) => !row.hasLocalStock && row.ilImprovePct > 0).length,
    },
  };
}

/**
 * Потери из-за отсутствия локального остатка: заказы под риском, retail и штраф ИЛ/ИРП.
 */
export function buildStockShortageLosses({
  snapshot,
  rows = [],
  settings = {},
  meta = {},
  tariffCache = null,
  supplyPlan = null,
  ilImpact = null,
}) {
  const impact = ilImpact || buildRegionIlImpact({ snapshot, rows, settings, meta, tariffCache, supplyPlan });
  if (!impact.rows.length) {
    return { rows: [], summary: null };
  }

  const localizationIndex = impact.localizationIndex ?? 1;
  const salesDistributionIndex = impact.salesDistributionIndex ?? 0;
  const profile = aggregateProductProfile(rows);
  const tariffCtx = resolveRegionTariffContext(tariffCache, rows, settings, meta);
  const defaultTariff = tariffCtx.defaultTariff || {};
  const baseLogistics = estimateFboLogisticsPerUnit(profile, defaultTariff, settings, {
    localizationIndex: 1,
    salesDistributionIndex: 0,
  });
  const forwardBase = baseLogistics?.forward || profile.currentWarehouseCoeff * 46;
  const priceRub = profile.priceRub || 1500;

  const lossRows = [];
  const rowsByNmId = indexRowsByNmId(rows);
  for (const row of impact.rows) {
    if (row.hasLocalStock) continue;

    const productRow = rowsByNmId.get(row.nmId);
    const atRiskOrders = row.orders;
    const avgRevenuePerOrder = row.revenue && atRiskOrders ? row.revenue / atRiskOrders : priceRub;
    const ilPenaltyPerUnit = forwardBase * Math.max(0, (row.ktrCurrent || 1) - 1);
    const irpRate = krpForLocalizationShare(row.localizationSharePct ?? 0);
    const irpPenaltyPerUnit = priceRub * irpRate;
    const indexPenaltyPerUnit = ilPenaltyPerUnit + irpPenaltyPerUnit;
    const totalPenalty = indexPenaltyPerUnit * atRiskOrders;
    const lostRevenue = avgRevenuePerOrder * atRiskOrders;

    lossRows.push({
      id: row.id,
      nmId: row.nmId,
      vendorCode: row.vendorCode,
      regionLabel: row.regionLabel,
      foName: row.foName,
      atRiskOrders,
      sharePct: row.sharePct,
      lostRevenue: roundRub(lostRevenue),
      ilPenaltyRub: roundRub(ilPenaltyPerUnit * atRiskOrders),
      irpPenaltyRub: roundRub(irpPenaltyPerUnit * atRiskOrders),
      totalPenaltyRub: roundRub(totalPenalty),
      ilImprovePct: row.ilImprovePct,
      targetWarehouse: row.targetWarehouse,
      reason:
        (productRow?.stockFbo ?? 0) <= 0
          ? 'Нет остатка FBO'
          : 'Нет остатка в ФО спроса — заказы уходят нелокально',
      priority: totalPenalty || lostRevenue * 0.05,
    });
  }

  lossRows.sort((a, b) => (b.totalPenaltyRub || 0) - (a.totalPenaltyRub || 0) || b.atRiskOrders - a.atRiskOrders);

  const summary = {
    atRiskOrders: lossRows.reduce((sum, row) => sum + row.atRiskOrders, 0),
    lostRevenue: roundRub(lossRows.reduce((sum, row) => sum + (row.lostRevenue || 0), 0)),
    indexPenaltyRub: roundRub(lossRows.reduce((sum, row) => sum + (row.totalPenaltyRub || 0), 0)),
    skuCount: new Set(lossRows.map((row) => row.nmId)).size,
    localizationIndex,
    salesDistributionIndex,
  };

  return { rows: lossRows, summary };
}

/**
 * План отгрузки: SKU × склад × количество, приоритет по влиянию на ИЛ и спросу.
 */
export function buildShipToWarehousePlan({
  snapshot,
  rows = [],
  settings = {},
  meta = {},
  tariffCache = null,
  supplyPlan = null,
  ilImpact = null,
  shortageLosses = null,
}) {
  const impact = ilImpact || buildRegionIlImpact({ snapshot, rows, settings, meta, tariffCache, supplyPlan });
  const losses =
    shortageLosses ||
    buildStockShortageLosses({ snapshot, rows, settings, meta, tariffCache, supplyPlan, ilImpact: impact });

  const rowsByNmId = indexRowsByNmId(rows);
  const tariffCtx = resolveRegionTariffContext(tariffCache, rows, settings, meta);
  const byWarehouse = new Map();

  const sourceRows = losses.rows.length ? losses.rows : impact.rows.filter((row) => !row.hasLocalStock);
  for (const row of sourceRows) {
    const warehouseName = row.targetWarehouse;
    if (!warehouseName || isFederalDistrictLabel(warehouseName)) continue;

    const productRow = rowsByNmId.get(row.nmId);
    const stockByWarehouse = productRow?.fboStockByWarehouse || [];
    const currentStock = stockAtWarehouse(stockByWarehouse, warehouseName);
    const demandQty = row.atRiskOrders ?? row.orders ?? 0;
    const coverBuffer = Math.max(2, Math.ceil(demandQty * 0.15));
    const shipQty = Math.max(0, demandQty + coverBuffer - currentStock);
    if (!shipQty) continue;

    const whKey = normalizeWarehouseKey(warehouseName);
    const tariff = lookupWarehouseTariff(tariffCtx.byName, warehouseName, tariffCtx.defaultTariff);
    const hit =
      byWarehouse.get(whKey) ||
      {
        warehouseName,
        warehouseCoeff: tariff?.warehouseCoeff ?? null,
        totalQty: 0,
        lines: [],
        regions: new Set(),
        ilImprovePct: 0,
      };

    hit.totalQty += shipQty;
    hit.ilImprovePct += row.ilImprovePct || 0;
    hit.regions.add(row.regionLabel);
    hit.lines.push({
      id: `${row.nmId}-${warehouseName}`,
      nmId: row.nmId,
      vendorCode: row.vendorCode,
      regionLabel: row.regionLabel,
      demandQty,
      shipQty,
      currentStock,
      ilImprovePct: row.ilImprovePct,
      lostRevenue: row.lostRevenue,
      priority: (row.ilImprovePct || 0) * 10 + demandQty,
    });
    byWarehouse.set(whKey, hit);
  }

  const plan = [...byWarehouse.values()]
    .map((entry) => {
      const lines = entry.lines.sort((a, b) => b.priority - a.priority);
      return {
        warehouseName: entry.warehouseName,
        warehouseCoeff: entry.warehouseCoeff,
        totalQty: entry.totalQty,
        skuCount: lines.length,
        regions: [...entry.regions].slice(0, 6),
        ilImprovePct: roundPct(entry.ilImprovePct, 1),
        lines,
      };
    })
    .sort((a, b) => b.ilImprovePct - a.ilImprovePct || b.totalQty - a.totalQty);

  const flatLines = plan
    .flatMap((group) =>
      group.lines.map((line) => ({
        ...line,
        warehouseName: group.warehouseName,
        warehouseCoeff: group.warehouseCoeff,
      }))
    )
    .sort((a, b) => b.priority - a.priority);

  return {
    byWarehouse: plan,
    lines: flatLines,
    summary: {
      totalUnits: flatLines.reduce((sum, line) => sum + line.shipQty, 0),
      warehouseCount: plan.length,
      skuCount: new Set(flatLines.map((line) => line.nmId)).size,
      topIlImprovePct: roundPct(flatLines.slice(0, 15).reduce((sum, line) => sum + (line.ilImprovePct || 0), 0), 1),
    },
  };
}

/** Полный анализ для вкладки «Регионы». */
export function buildRegionSupplyAnalysis(ctx) {
  const ilImpact = buildRegionIlImpact(ctx);
  const shortageLosses = buildStockShortageLosses({ ...ctx, ilImpact });
  const shipPlan = buildShipToWarehousePlan({ ...ctx, ilImpact, shortageLosses });
  return { ilImpact, shortageLosses, shipPlan };
}
