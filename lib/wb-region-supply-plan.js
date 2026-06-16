import {
  krpForLocalizationShare,
  ktrForLocalizationShare,
  normalizeLocalizationIndex,
  normalizeSalesDistributionIndex,
} from './wb-localization-indices.js';
import {
  aggregateProductProfile,
  estimateFboLogisticsPerUnit,
  projectIndicesAfterLocalStock,
  resolveRegionTariffContext,
} from './region-supply-recommendations.js';
import {
  isFederalDistrictLabel,
  suggestWarehousesForLocation,
} from './wb-region-sales.js';
import { buildWarehouseFoResolver, foZoneKey } from './wb-warehouse-fo.js';
import { lookupWarehouseTariff, normalizeWarehouseKey } from './wb-warehouse-tariffs.js';

const STOCK_HORIZON_OPTIONS = [7, 14, 30, 45];
const DEFAULT_STOCK_HORIZON_DAYS = 14;
const SHIP_BUFFER_SHARE = 0.15;
const SHIP_BUFFER_MIN = 2;

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

function resolveRegionSalesPeriodDays(meta = {}, snapshot = null) {
  const period = meta?.regionSalesPeriod;
  if (period?.dateFrom && period?.dateTo) {
    const from = new Date(period.dateFrom).getTime();
    const to = new Date(period.dateTo).getTime();
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
      return Math.max(1, Math.round((to - from) / (24 * 60 * 60 * 1000)) + 1);
    }
  }
  const totalQty = Number(snapshot?.totalQty) || 0;
  if (totalQty > 0) return 30;
  return 30;
}

export function resolveStockHorizonDays(settings = {}) {
  const raw = Number(settings.regionStockHorizonDays);
  if (STOCK_HORIZON_OPTIONS.includes(raw)) return raw;
  return DEFAULT_STOCK_HORIZON_DAYS;
}

function scaleDemandToHorizon(demandQty, periodDays, horizonDays) {
  const demand = Math.max(0, Number(demandQty) || 0);
  const period = Math.max(1, Number(periodDays) || 30);
  const horizon = Math.max(1, Number(horizonDays) || DEFAULT_STOCK_HORIZON_DAYS);
  return Math.ceil((demand / period) * horizon);
}

function shipBufferQty(scaledDemand) {
  return Math.max(SHIP_BUFFER_MIN, Math.ceil(scaledDemand * SHIP_BUFFER_SHARE));
}

function productVolumeLiters(row) {
  const l = Number(row?.lengthCm);
  const w = Number(row?.widthCm);
  const h = Number(row?.heightCm);
  if (l > 0 && w > 0 && h > 0) return (l * w * h) / 1000;
  return null;
}

function estimateSupplyLineCosts(productRow, tariff, settings, shipQty, horizonDays) {
  const qty = Math.max(0, Number(shipQty) || 0);
  if (!qty) {
    return { acceptanceRub: 0, storageRub: 0, supplyCostRub: 0 };
  }

  const volumeLiters = productVolumeLiters(productRow) || 1;
  const storageBase = tariff?.storageBasePerLiter ?? settings.storageBasePerLiter ?? 0.07;
  const storageExtra = tariff?.storageAdditionalPerLiter ?? settings.storageAdditionalPerLiter ?? 0.07;
  const storageCoeff = tariff?.storageCoeff ?? settings.storageCoeff ?? 1;
  const perDay =
    (storageBase + Math.max(0, volumeLiters - 1) * storageExtra) * storageCoeff;
  const storageRub = Math.round(perDay * horizonDays * qty);

  const acceptancePerUnit =
    productRow?.actualAcceptanceRub > 0
      ? productRow.actualAcceptanceRub
      : settings.acceptanceCostPerUnit ?? 0;
  const acceptanceRub = Math.round(Math.max(0, acceptancePerUnit) * qty);

  return {
    acceptanceRub,
    storageRub,
    supplyCostRub: acceptanceRub + storageRub,
  };
}

function resolveArticleLocalizationShare(nmId, productRow, meta, sellerAvgSharePct) {
  const byNmId = meta?.localizationByNmId;
  const articleStat = byNmId?.[nmId] ?? byNmId?.[String(nmId)];
  if (articleStat?.localizationSharePct != null && !articleStat.isException) {
    return Math.max(0, Math.min(100, articleStat.localizationSharePct));
  }

  const stockByWarehouse = productRow?.fboStockByWarehouse || [];
  const totalStock = Math.max(0, Number(productRow?.stockFbo) || 0);
  if (!totalStock) {
    return Math.max(0, Math.min(100, Number(sellerAvgSharePct) || 0));
  }

  return Math.max(0, Math.min(100, Number(sellerAvgSharePct) || 0));
}

function estimateArticleLocalizationShare(row, sellerAvgSharePct, meta) {
  const nmId = Number(row?.nmId);
  if (nmId) {
    return resolveArticleLocalizationShare(nmId, row, meta, sellerAvgSharePct);
  }
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
    const localizationSharePct = estimateArticleLocalizationShare(productRow, sellerAvgSharePct, meta);
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
 * SKU×регион с избыточным остатком в ФО спроса — отгрузка не нужна на горизонте.
 */
export function buildOverstockSkipRows({
  snapshot,
  rows = [],
  settings = {},
  meta = {},
  tariffCache = null,
  ilImpact = null,
}) {
  const impact = ilImpact || buildRegionIlImpact({ snapshot, rows, settings, meta, tariffCache });
  if (!impact.rows.length) {
    return { rows: [], summary: null };
  }

  const periodDays = resolveRegionSalesPeriodDays(meta, snapshot);
  const horizonDays = resolveStockHorizonDays(settings);
  const rowsByNmId = indexRowsByNmId(rows);
  const skipRows = [];

  for (const row of impact.rows) {
    const productRow = rowsByNmId.get(row.nmId);
    const foStockQty = row.localStockQty ?? 0;
    if (!foStockQty) continue;

    const horizonDemand = scaleDemandToHorizon(row.orders, periodDays, horizonDays);
    if (foStockQty <= horizonDemand) continue;

    skipRows.push({
      id: `skip-${row.id}`,
      nmId: row.nmId,
      vendorCode: row.vendorCode,
      regionLabel: row.regionLabel,
      foName: row.foName,
      orders: row.orders,
      horizonDemand,
      foStockQty,
      surplusQty: foStockQty - horizonDemand,
      horizonDays,
      reason: `Остаток в ФО (${foStockQty} шт.) покрывает спрос на ${horizonDays} дн. (${horizonDemand} шт.)`,
      priority: foStockQty - horizonDemand,
    });
  }

  skipRows.sort((a, b) => b.surplusQty - a.surplusQty || b.orders - a.orders);

  return {
    rows: skipRows,
    summary: {
      skuCount: new Set(skipRows.map((row) => row.nmId)).size,
      surplusUnits: skipRows.reduce((sum, row) => sum + (row.surplusQty || 0), 0),
      horizonDays,
    },
  };
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
  const periodDays = resolveRegionSalesPeriodDays(meta, snapshot);
  const horizonDays = resolveStockHorizonDays(settings);
  const overstock = buildOverstockSkipRows({
    snapshot,
    rows,
    settings,
    meta,
    tariffCache,
    ilImpact: impact,
  });
  const skipIds = new Set(overstock.rows.map((row) => row.id.replace(/^skip-/, '')));
  const byWarehouse = new Map();

  const sourceRows = losses.rows.length ? losses.rows : impact.rows.filter((row) => !row.hasLocalStock);
  for (const row of sourceRows) {
    if (skipIds.has(row.id)) continue;

    const warehouseName = row.targetWarehouse;
    if (!warehouseName || isFederalDistrictLabel(warehouseName)) continue;

    const productRow = rowsByNmId.get(row.nmId);
    const stockByWarehouse = productRow?.fboStockByWarehouse || [];
    const currentStock = stockAtWarehouse(stockByWarehouse, warehouseName);
    const rawDemandQty = row.atRiskOrders ?? row.orders ?? 0;
    const scaledDemand = scaleDemandToHorizon(rawDemandQty, periodDays, horizonDays);
    const coverBuffer = shipBufferQty(scaledDemand);
    const shipQty = Math.max(0, scaledDemand + coverBuffer - currentStock);
    if (!shipQty) continue;

    const whKey = normalizeWarehouseKey(warehouseName);
    const tariff = lookupWarehouseTariff(tariffCtx.byName, warehouseName, tariffCtx.defaultTariff);
    const supplyCosts = estimateSupplyLineCosts(productRow, tariff, settings, shipQty, horizonDays);
    const hit =
      byWarehouse.get(whKey) ||
      {
        warehouseName,
        warehouseCoeff: tariff?.warehouseCoeff ?? null,
        totalQty: 0,
        totalSupplyCostRub: 0,
        lines: [],
        regions: new Set(),
        ilImprovePct: 0,
      };

    hit.totalQty += shipQty;
    hit.totalSupplyCostRub += supplyCosts.supplyCostRub;
    hit.ilImprovePct += row.ilImprovePct || 0;
    hit.regions.add(row.regionLabel);
    hit.lines.push({
      id: `${row.nmId}-${warehouseName}`,
      nmId: row.nmId,
      vendorCode: row.vendorCode,
      regionLabel: row.regionLabel,
      demandQty: rawDemandQty,
      horizonDemandQty: scaledDemand,
      shipQty,
      currentStock,
      ilImprovePct: row.ilImprovePct,
      lostRevenue: row.lostRevenue,
      acceptanceRub: supplyCosts.acceptanceRub,
      storageRub: supplyCosts.storageRub,
      supplyCostRub: supplyCosts.supplyCostRub,
      priority: (row.ilImprovePct || 0) * 10 + scaledDemand,
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
        totalSupplyCostRub: roundRub(entry.totalSupplyCostRub),
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
    overstock: overstock.rows,
    horizonDays,
    periodDays,
    summary: {
      totalUnits: flatLines.reduce((sum, line) => sum + line.shipQty, 0),
      totalSupplyCostRub: roundRub(flatLines.reduce((sum, line) => sum + (line.supplyCostRub || 0), 0)),
      warehouseCount: plan.length,
      skuCount: new Set(flatLines.map((line) => line.nmId)).size,
      skipCount: overstock.rows.length,
      topIlImprovePct: roundPct(flatLines.slice(0, 15).reduce((sum, line) => sum + (line.ilImprovePct || 0), 0), 1),
    },
  };
}

/** Полный анализ для вкладки «Регионы». */
export function buildRegionSupplyAnalysis(ctx) {
  const ilImpact = buildRegionIlImpact(ctx);
  const shortageLosses = buildStockShortageLosses({ ...ctx, ilImpact });
  const shipPlan = buildShipToWarehousePlan({ ...ctx, ilImpact, shortageLosses });
  const overstockSkip = buildOverstockSkipRows({ ...ctx, ilImpact });
  return { ilImpact, shortageLosses, shipPlan, overstockSkip };
}

export function resolveRegionDemandDays(settings = {}) {
  const raw = Number(settings.regionDemandDays);
  if ([7, 14, 30].includes(raw)) return raw;
  return 30;
}

/**
 * Симуляция отгрузки shipQty единиц SKU на склад WB: прогноз ИЛ, ИРП и ₽/ед.
 */
export function simulateShipmentScenario({
  nmId,
  warehouseName,
  shipQty = 0,
  regionLabel = '',
  snapshot,
  rows = [],
  settings = {},
  meta = {},
  tariffCache = null,
  supplyPlan = null,
}) {
  const productRow = indexRowsByNmId(rows).get(Number(nmId));
  if (!productRow || !warehouseName) {
    return { error: 'Выберите артикул и склад' };
  }

  const qty = Math.max(0, Number(shipQty) || 0);
  const localizationIndex = normalizeLocalizationIndex(
    settings.localizationIndex ?? meta.localizationIndex ?? 1
  );
  const salesDistributionIndex = normalizeSalesDistributionIndex(
    settings.salesDistributionIndex ?? meta.salesDistributionIndex ?? 0
  );
  const indices = { localizationIndex, salesDistributionIndex };

  const tariffCtx = resolveRegionTariffContext(tariffCache, rows, settings, meta);
  const resolveFo = buildWarehouseFoResolver(tariffCtx.byName);
  const profile = aggregateProductProfile([productRow]);
  const tariff = lookupWarehouseTariff(tariffCtx.byName, warehouseName, tariffCtx.defaultTariff);

  let regionSharePct = 0;
  let foName = '';
  if (regionLabel) {
    const region = (snapshot?.byRegion || []).find(
      (r) => (r.label || r.regionName) === regionLabel
    );
    regionSharePct = region?.sharePct || 0;
    foName = region?.foName || '';
  } else {
    const topRegion = (snapshot?.byRegion || [])[0];
    regionSharePct = topRegion?.sharePct || 0;
    foName = topRegion?.foName || '';
    regionLabel = topRegion?.label || '';
  }

  const whFo = foZoneKey(resolveFo(warehouseName) || warehouseName);
  const destFo = foZoneKey(foName || regionLabel);
  const isLocal = Boolean(whFo && destFo && whFo === destFo);

  const baseCost = estimateFboLogisticsPerUnit(profile, tariff, settings, indices);
  const projected = isLocal
    ? projectIndicesAfterLocalStock(localizationIndex, salesDistributionIndex, regionSharePct)
    : indices;
  const effectiveCost = isLocal
    ? estimateFboLogisticsPerUnit(profile, tariff, settings, projected)
    : baseCost;

  const horizonDays = resolveStockHorizonDays(settings);
  const supplyCosts = estimateSupplyLineCosts(productRow, tariff, settings, qty, horizonDays);
  const costPerUnit = effectiveCost?.perUnit ?? baseCost?.perUnit ?? null;
  const supplyCostPerUnit = qty > 0 ? Math.round(supplyCosts.supplyCostRub / qty) : 0;

  const articleOrders =
    (snapshot?.byNmId || []).find((a) => Number(a.key) === Number(nmId))?.qty || 0;
  const sellerAvgSharePct = meta.avgLocalizationSharePct ?? 50;
  const currentShare = resolveArticleLocalizationShare(Number(nmId), productRow, meta, sellerAvgSharePct);
  const projectedShare = isLocal && articleOrders
    ? projectedShareAfterLocalizing(currentShare, articleOrders, Math.round(articleOrders * regionSharePct))
    : currentShare;

  return {
    nmId: Number(nmId),
    vendorCode: productRow.vendorCode || String(nmId),
    warehouseName,
    regionLabel,
    foName,
    shipQty: qty,
    isLocal,
    warehouseCoeff: tariff?.warehouseCoeff ?? null,
    localizationIndex,
    salesDistributionIndex,
    projectedIl: roundPct(projected.localizationIndex, 2),
    projectedIrpPct: roundPct((projected.salesDistributionIndex ?? 0) * 100, 2),
    ilDelta: roundPct(localizationIndex - projected.localizationIndex, 2),
    irpDeltaPct: roundPct((salesDistributionIndex - projected.salesDistributionIndex) * 100, 2),
    costPerUnit: roundRub(costPerUnit),
    baseCostPerUnit: roundRub(baseCost?.perUnit),
    supplyCostRub: supplyCosts.supplyCostRub,
    supplyCostPerUnit,
    totalRubPerUnit: costPerUnit != null ? roundRub(costPerUnit + supplyCostPerUnit) : null,
    localizationSharePct: roundPct(currentShare, 0),
    projectedLocalizationSharePct: roundPct(projectedShare, 0),
    acceptanceRub: supplyCosts.acceptanceRub,
    storageRub: supplyCosts.storageRub,
  };
}

function resolveMatrixStatus({ foStockQty, horizonDemand, hasShipLine, hasSkipLine }) {
  if (hasSkipLine || (foStockQty > 0 && foStockQty > horizonDemand * 1.15)) return 'skip';
  if (hasShipLine || (foStockQty <= 0 && horizonDemand > 0)) return 'ship';
  if (foStockQty >= horizonDemand) return 'ok';
  return 'ship';
}

/**
 * Матрица ФО×SKU: спрос, остаток в ФО, дней покрытия, статус (ok/ship/skip).
 */
export function buildFoSkuMatrix({
  snapshot,
  rows = [],
  settings = {},
  meta = {},
  tariffCache = null,
  supplyPlan = null,
  regionAnalysis = null,
}) {
  const analysis =
    regionAnalysis ||
    buildRegionSupplyAnalysis({ snapshot, rows, settings, meta, tariffCache, supplyPlan });

  const periodDays = resolveRegionSalesPeriodDays(meta, snapshot);
  const horizonDays = resolveStockHorizonDays(settings);
  const rowsByNmId = indexRowsByNmId(rows);
  const tariffCtx = resolveRegionTariffContext(tariffCache, rows, settings, meta);
  const resolveFo = buildWarehouseFoResolver(tariffCtx.byName);

  const shipByKey = new Map();
  for (const line of analysis.shipPlan.lines || []) {
    shipByKey.set(`${line.nmId}::${line.regionLabel}`, line);
  }
  const skipByKey = new Set((analysis.overstockSkip.rows || []).map((r) => `${r.nmId}::${r.regionLabel}`));

  const matrixRows = [];
  for (const entry of buildNmIdRegionRows(snapshot, rowsByNmId)) {
    if (!entry.nmId || !entry.qty) continue;

    const productRow = rowsByNmId.get(entry.nmId);
    const destFo = foZoneKey(entry.foName || entry.regionLabel);
    const foStockQty = stockInFo(productRow?.fboStockByWarehouse || [], destFo, resolveFo);
    const horizonDemand = scaleDemandToHorizon(entry.qty, periodDays, horizonDays);
    const dailyDemand = horizonDemand / Math.max(1, horizonDays);
    const daysOfCover =
      dailyDemand > 0 ? Math.round((foStockQty / dailyDemand) * 10) / 10 : foStockQty > 0 ? 999 : 0;

    const key = `${entry.nmId}::${entry.regionLabel}`;
    const status = resolveMatrixStatus({
      foStockQty,
      horizonDemand,
      hasShipLine: shipByKey.has(key),
      hasSkipLine: skipByKey.has(key),
    });

    matrixRows.push({
      id: key,
      nmId: entry.nmId,
      vendorCode: entry.vendorCode || productRow?.vendorCode || String(entry.nmId),
      foName: entry.foName || destFo || '—',
      foKey: destFo || entry.foName || '',
      regionLabel: entry.regionLabel,
      demandQty: entry.qty,
      horizonDemand,
      foStockQty,
      daysOfCover,
      status,
      horizonDays,
    });
  }

  matrixRows.sort(
    (a, b) =>
      (a.status === 'ship' ? 0 : a.status === 'ok' ? 1 : 2) - (b.status === 'ship' ? 0 : b.status === 'ok' ? 1 : 2) ||
      b.demandQty - a.demandQty
  );

  const byFo = new Map();
  for (const row of matrixRows) {
    const fo = row.foName || '—';
    if (!byFo.has(fo)) {
      byFo.set(fo, { foName: fo, ship: 0, ok: 0, skip: 0, demand: 0 });
    }
    const g = byFo.get(fo);
    g[row.status] += 1;
    g.demand += row.demandQty;
  }

  return {
    rows: matrixRows,
    summary: {
      shipCount: matrixRows.filter((r) => r.status === 'ship').length,
      okCount: matrixRows.filter((r) => r.status === 'ok').length,
      skipCount: matrixRows.filter((r) => r.status === 'skip').length,
      skuFoPairs: matrixRows.length,
      byFo: [...byFo.values()].sort((a, b) => b.demand - a.demand),
    },
  };
}

/** Таблица приоритета складов по ФО: рекомендованный склад, покрытие спроса, подсказка по доставке. */
export function buildFoWarehousePriority({
  snapshot,
  rows = [],
  settings = {},
  meta = {},
  tariffCache = null,
  supplyPlan = null,
}) {
  const tariffCtx = resolveRegionTariffContext(tariffCache, rows, settings, meta);
  const resolveFo = buildWarehouseFoResolver(tariffCtx.byName);
  const actionByFo = new Map();

  for (const action of supplyPlan?.actions || []) {
    const fo = foZoneKey(action.foName || action.regionLabel);
    if (!fo || actionByFo.has(fo)) continue;
    actionByFo.set(fo, action);
  }

  const avgDeliveryHours = meta.sellerAvgDeliveryHours ?? null;
  const foRows = [];

  for (const fo of snapshot?.byFo || []) {
    const foKey = foZoneKey(fo.label || fo.foName);
    const action = actionByFo.get(foKey);
    const regionsInFo = (snapshot.byRegion || []).filter(
      (r) => foZoneKey(r.foName || r.label) === foKey
    );
    const foDemand = fo.qty || regionsInFo.reduce((s, r) => s + (r.qty || 0), 0);
    const coveredDemand = regionsInFo
      .filter((r) => {
        const act = (supplyPlan?.actions || []).find((a) => a.regionLabel === (r.label || r.regionName));
        return act?.isLocal;
      })
      .reduce((s, r) => s + (r.qty || 0), 0);
    const coveragePct = foDemand > 0 ? Math.round((coveredDemand / foDemand) * 1000) / 10 : 0;

    const warehouseName =
      action?.warehouseName ||
      suggestWarehousesForLocation(
        { regionName: fo.label, foName: fo.label },
        tariffCtx.tariffList,
        { cargoType: tariffCtx.warehouseCargoType }
      ).find((n) => !isFederalDistrictLabel(n)) ||
      '';

    const whFo = warehouseName ? foZoneKey(resolveFo(warehouseName) || warehouseName) : '';
    const isLocal = Boolean(whFo && foKey && whFo === foKey);

    let deliveryHint = '—';
    if (avgDeliveryHours != null) {
      deliveryHint = isLocal
        ? `~${Math.round(avgDeliveryHours * 0.7)} ч (локально)`
        : `~${Math.round(avgDeliveryHours * 1.3)} ч (межрегион)`;
    } else if (isLocal) {
      deliveryHint = 'Локальный ФО';
    } else {
      deliveryHint = 'Межрегиональная доставка';
    }

    foRows.push({
      foName: fo.label || fo.foName,
      foKey,
      warehouseName: warehouseName || '—',
      warehouseCoeff: action?.warehouseCoeff ?? null,
      coveragePct,
      demandQty: foDemand,
      sharePct: fo.sharePct || 0,
      isLocal,
      deliveryHint,
      costPerUnit: action?.costPerUnit ?? null,
    });
  }

  foRows.sort((a, b) => (b.sharePct || 0) - (a.sharePct || 0));

  return { rows: foRows };
}
