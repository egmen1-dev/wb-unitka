import { hydrateTariffCache, isTariffCacheFresh } from './wb-tariff-cache.js';
import {
  cargoTypeLabel,
  filterTariffsForCargoType,
  resolveMatrixCargoType,
  warehouseAcceptsCargoType,
  WB_CARGO,
} from './wb-cargo-type.js';
import {
  applyWbLogisticsIndices,
  ktrForLocalizationShare,
  krpForLocalizationShare,
  normalizeLocalizationIndex,
  normalizeSalesDistributionIndex,
  priceForSalesDistributionIndex,
} from './wb-localization-indices.js';
import {
  calcWbForwardDelivery,
  calcWbLogisticsPerUnit,
  calcWbReturnDelivery,
} from './wb-logistics.js';
import { suggestWarehousesForLocation } from './wb-region-sales.js';
import { buildWarehouseFoResolver, foZoneKey } from './wb-warehouse-fo.js';
import { lookupWarehouseTariff, normalizeWarehouseKey } from './wb-warehouse-tariffs.js';

function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function roundRub(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

function roundPct(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

/** Типовой товар для оценки ₽/ед. */
export function aggregateProductProfile(rows = []) {
  const volumes = [];
  const prices = [];
  const buyouts = [];
  const coeffs = [];
  const warehouses = new Map();

  for (const row of rows) {
    const l = Number(row.lengthCm);
    const w = Number(row.widthCm);
    const h = Number(row.heightCm);
    if (l > 0 && w > 0 && h > 0) volumes.push((l * w * h) / 1000);

    const price = priceForSalesDistributionIndex({
      basePrice: row.basePrice,
      salePrice: row.salePrice,
      ourPrice: row.ourPrice,
    });
    if (price > 0) prices.push(price);

    const buyout = Number(row.buyoutRateFbo ?? row.buyoutRate);
    if (buyout > 0) buyouts.push(buyout);

    const coeff = Number(row.warehouseCoeff);
    if (coeff > 0) coeffs.push(coeff);

    const wh = String(row.fboWarehouseName || '').trim();
    if (wh) warehouses.set(wh, (warehouses.get(wh) || 0) + 1);
  }

  let primaryWarehouse = '';
  let primaryCount = 0;
  for (const [name, count] of warehouses) {
    if (count > primaryCount) {
      primaryWarehouse = name;
      primaryCount = count;
    }
  }

  return {
    volumeLiters: median(volumes) || 1,
    priceRub: median(prices) || 1500,
    buyoutRate: median(buyouts) || 0.9,
    currentWarehouseCoeff: median(coeffs) || 2,
    primaryWarehouse,
    skuCount: rows.length,
  };
}

/** Коэфф. склада в % как в кабинете WB (205% при warehouseCoeff = 2.05). */
export function formatWarehouseCoeffPercent(coeff) {
  const n = Number(coeff);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${Math.round(n * 100)}%`;
}

/** Тарифы из строк таблицы, если кэш WB недоступен после F5. */
function buildTariffIndexFromRows(rows = [], settings = {}) {
  const stats = new Map();

  for (const row of rows) {
    const name = String(row.fboWarehouseName || '').trim();
    const coeff = Number(row.warehouseCoeff);
    if (!name || !(coeff > 0)) continue;
    const key = normalizeWarehouseKey(name);
    const hit = stats.get(key) || { warehouseName: name, coeffs: [] };
    hit.coeffs.push(coeff);
    stats.set(key, hit);
  }

  const byName = new Map();
  for (const [key, hit] of stats) {
    const sorted = hit.coeffs.sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];
    byName.set(key, {
      warehouseName: hit.warehouseName,
      warehouseCoeff: mid,
      firstLiter: settings.logisticsFirstLiter ?? 46,
      additionalLiter: settings.logisticsAdditionalLiter ?? 14,
      fromRows: true,
    });
  }
  return byName;
}

function resolveTariffs(tariffCache, cargoType = WB_CARGO.MGT, rows = [], settings = {}) {
  const hydrated = hydrateTariffCache(tariffCache, { allowStale: true });
  const tariffCacheStale = Boolean(hydrated && !isTariffCacheFresh(tariffCache));
  const byNameRaw = hydrated?.boxTariffs?.byName || new Map();
  const byName = new Map();
  for (const [key, tariff] of byNameRaw) {
    if (warehouseAcceptsCargoType(tariff.warehouseName, cargoType)) {
      byName.set(key, tariff);
    }
  }

  if (!byName.size && rows.length) {
    for (const [key, tariff] of buildTariffIndexFromRows(rows, settings)) {
      if (warehouseAcceptsCargoType(tariff.warehouseName, cargoType)) {
        byName.set(key, tariff);
      }
    }
  }
  const defaultTariffRaw = hydrated?.boxTariffs?.defaultTariff || hydrated?.boxTariffs || null;
  const defaultTariff =
    defaultTariffRaw && warehouseAcceptsCargoType(defaultTariffRaw.warehouseName, cargoType)
      ? defaultTariffRaw
      : [...byName.values()].find((t) => t.warehouseCoeff > 0) || null;
  const tariffList = filterTariffsForCargoType([...byName.values()], cargoType);
  return {
    tariffList,
    byName,
    defaultTariff,
    resolveFo: buildWarehouseFoResolver(byName),
    cargoType,
    tariffSource: hydrated?.boxTariffs?.tariffSource || (byName.size && [...byName.values()][0]?.fromRows ? 'rows' : 'tariffs/box'),
    tariffCacheDate: tariffCache?.cachedAt || hydrated?.boxTariffs?.date || null,
    tariffCacheStale,
    tariffFromRows: !byNameRaw.size && byName.size > 0,
  };
}

export function estimateFboLogisticsPerUnit(
  profile,
  tariff,
  settings,
  { localizationIndex = 1, salesDistributionIndex = 0 } = {}
) {
  const first = tariff?.firstLiter ?? settings.logisticsFirstLiter ?? 46;
  const extra = tariff?.additionalLiter ?? settings.logisticsAdditionalLiter ?? 14;
  const coeff = tariff?.warehouseCoeff ?? settings.defaultWarehouseCoeff ?? 2;
  const forward = calcWbForwardDelivery(profile.volumeLiters, first, extra, coeff);
  const ret = calcWbReturnDelivery(profile.volumeLiters, first, extra);
  if (forward == null) return null;

  const applyIndices = settings.includeLogisticsIndices !== false;
  const indices = applyIndices
    ? applyWbLogisticsIndices(forward, profile.priceRub, {
        localizationIndex,
        salesDistributionIndex,
      })
    : { forwardWithIndices: forward, forwardWithIl: forward, irpSurcharge: 0 };

  const perUnit = calcWbLogisticsPerUnit({
    forwardDelivery: indices.forwardWithIndices ?? forward,
    returnDelivery: ret,
    buyoutRate: profile.buyoutRate,
    returnMarkup: settings.returnLogisticsMarkup ?? 0.0454,
    useBuyoutWeighted: settings.useBuyoutWeightedLogistics !== false,
  });

  return {
    perUnit,
    forward,
    forwardWithIndices: indices.forwardWithIndices ?? forward,
    irpSurcharge: indices.irpSurcharge ?? 0,
    warehouseCoeff: coeff,
    warehouseName: tariff?.warehouseName || '',
    localizationIndex,
    salesDistributionIndex,
  };
}

function projectIndicesAfterLocalStock(currentIl, currentIrp, regionSharePct) {
  const share = Math.max(0, Math.min(1, regionSharePct || 0));
  const blend = share * 0.65;
  return {
    localizationIndex: Math.max(1, currentIl - blend * (currentIl - 1)),
    salesDistributionIndex: Math.max(0, currentIrp - blend * currentIrp),
  };
}

function syntheticTariff(warehouseName, settings, defaultTariff, cargoType = WB_CARGO.MGT) {
  if (!warehouseAcceptsCargoType(warehouseName, cargoType)) return null;
  const base = defaultTariff || {};
  return {
    warehouseName,
    firstLiter: base.firstLiter ?? settings.logisticsFirstLiter ?? 46,
    additionalLiter: base.additionalLiter ?? settings.logisticsAdditionalLiter ?? 14,
    warehouseCoeff: base.warehouseCoeff ?? settings.defaultWarehouseCoeff ?? 2,
    geoName: base.geoName || '',
    isSynthetic: true,
  };
}

function warehouseCandidates(region, tariffList, byName, defaultTariff, resolveFo, settings, cargoType) {
  const geoNames = suggestWarehousesForLocation(region, tariffList, { cargoType });
  const names = new Set(geoNames);

  const destFo = foZoneKey(region.foName || region.label);
  for (const tariff of tariffList) {
    const whFo = foZoneKey(resolveFo(tariff.warehouseName) || '');
    if (whFo && destFo && whFo === destFo) names.add(tariff.warehouseName);
  }

  const cheap = [...tariffList]
    .filter((t) => t.warehouseCoeff > 0)
    .sort((a, b) => a.warehouseCoeff - b.warehouseCoeff)
    .slice(0, 3);
  for (const t of cheap) names.add(t.warehouseName);

  if (defaultTariff?.warehouseName) names.add(defaultTariff.warehouseName);

  return [...names]
    .map((name) => {
      const tariff = lookupWarehouseTariff(byName, name, defaultTariff);
      if (tariff?.warehouseName && warehouseAcceptsCargoType(tariff.warehouseName, cargoType)) {
        return tariff;
      }
      if (!name) return null;
      return syntheticTariff(name, settings, defaultTariff, cargoType);
    })
    .filter(Boolean);
}

function analyzeWarehouseForRegion(region, tariff, profile, settings, indices, resolveFo) {
  const whFo = foZoneKey(resolveFo(tariff.warehouseName) || tariff.warehouseName || '');
  const destFo = foZoneKey(region.foName || region.label);
  const isLocal = Boolean(whFo && destFo && whFo === destFo);

  const baseCost = estimateFboLogisticsPerUnit(profile, tariff, settings, indices);
  if (!baseCost) return null;

  const projected = isLocal
    ? projectIndicesAfterLocalStock(indices.localizationIndex, indices.salesDistributionIndex, region.sharePct)
    : indices;

  const effectiveCost = isLocal
    ? estimateFboLogisticsPerUnit(profile, tariff, settings, projected)
    : baseCost;

  return {
    warehouseName: tariff.warehouseName,
    warehouseCoeff: tariff.warehouseCoeff,
    isLocal,
    isSynthetic: Boolean(tariff.isSynthetic),
    costPerUnit: baseCost.perUnit,
    effectiveCostPerUnit: effectiveCost?.perUnit ?? baseCost.perUnit,
    baseForwardPerUnit: baseCost.forward,
    ilMultiplier: baseCost.localizationIndex,
    irpSurcharge: baseCost.irpSurcharge,
    irpPct: (baseCost.salesDistributionIndex ?? 0) * 100,
    projectedIl: projected.localizationIndex,
    projectedIrp: projected.salesDistributionIndex,
    geoScore: isLocal ? 3 : whFo && destFo ? 1 : 0,
  };
}

function pickBestAndRunnerUp(scored) {
  const viable = scored.filter((item) => item?.effectiveCostPerUnit != null);
  if (!viable.length) return { best: null, runnerUp: null, cheapestCoeff: null };

  const byEffective = [...viable].sort(
    (a, b) => a.effectiveCostPerUnit - b.effectiveCostPerUnit || a.warehouseCoeff - b.warehouseCoeff
  );
  const cheapestCoeff = [...viable].sort((a, b) => a.warehouseCoeff - b.warehouseCoeff)[0];
  return {
    best: byEffective[0],
    runnerUp: byEffective[1] || null,
    cheapestCoeff,
  };
}

function buildActionForRegion(region, analysis, profile, monthlyOrders) {
  const { best, runnerUp, cheapestCoeff } = analysis;
  if (!best) return null;

  const demandQty = Math.round(region.qty || 0);
  const savingsVsRunner =
    runnerUp?.effectiveCostPerUnit != null
      ? runnerUp.effectiveCostPerUnit - best.effectiveCostPerUnit
      : 0;
  const savingsVsCheapRemote =
    cheapestCoeff && !cheapestCoeff.isLocal && best.isLocal
      ? cheapestCoeff.effectiveCostPerUnit - best.effectiveCostPerUnit
      : 0;

  let verdict = 'recommend';
  let reason = '';

  if (best.isLocal) {
    if (best.warehouseCoeff >= 2 && runnerUp && !runnerUp.isLocal && savingsVsRunner < 8) {
      verdict = 'index_first';
      reason = `Склад «${best.warehouseName}» локальный, но коэфф. ${best.warehouseCoeff.toFixed(2)} высокий. Разница с дешёвым нелокальным складом ~${roundRub(Math.abs(savingsVsRunner)) || 0} ₽/ед. — выгоднее наращивать локальные остатки на текущем складе, чем везти на дорогой.`;
    } else {
      verdict = 'recommend';
      reason = `Локальный склад для «${region.label}»: коэфф. ${best.warehouseCoeff.toFixed(2)}, с учётом ИЛ/ИРП ~${roundRub(best.effectiveCostPerUnit)} ₽/ед. Покрытие спроса снизит ИЛ до ×${best.projectedIl.toFixed(2)}.`;
    }
  } else if (best.warehouseCoeff <= 1.35) {
    verdict = 'index_first';
    reason = `Низкий коэфф. ${best.warehouseCoeff.toFixed(2)}, но заказы из «${region.label}» нелокальные — ИЛ ×${best.projectedIl.toFixed(2)} и ИРП добавляют ~${roundRub(best.irpSurcharge)} ₽/ед. Лучше отвезти часть товара на региональный склад.`;
  } else {
    verdict = 'avoid_expensive';
    reason = `Коэфф. ${best.warehouseCoeff.toFixed(2)} без локальности — двойной удар: дорогая логистика и высокие ИЛ/ИРП.`;
  }

  const monthlySavings = Math.max(0, savingsVsRunner) * demandQty;

  return {
    id: `${region.key || region.label}-${best.warehouseName}`,
    type: verdict === 'index_first' ? 'index' : 'supply',
    priority: region.sharePct || 0,
    regionLabel: region.label,
    foName: region.foName,
    sharePct: region.sharePct,
    demandQty,
    monthlyOrders,
    warehouseName: best.warehouseName,
    warehouseCoeff: best.warehouseCoeff,
    isLocal: best.isLocal,
    costPerUnit: roundRub(best.effectiveCostPerUnit),
    altWarehouseName: runnerUp?.warehouseName || cheapestCoeff?.warehouseName || null,
    altCostPerUnit: roundRub(runnerUp?.effectiveCostPerUnit ?? cheapestCoeff?.effectiveCostPerUnit),
    savingsPerUnit: roundRub(Math.max(0, savingsVsRunner)),
    savingsMonthly: roundRub(monthlySavings),
    projectedIl: roundPct(best.projectedIl, 2),
    projectedIrp: roundPct((best.projectedIrp ?? 0) * 100, 2),
    ilMultiplier: roundPct(best.ilMultiplier, 2),
    irpPct: roundPct(best.irpPct, 2),
    baseForwardPerUnit: roundRub(best.baseForwardPerUnit),
    irpSurchargePerUnit: roundRub(best.irpSurcharge),
    isSynthetic: best.isSynthetic,
    verdict,
    reason,
  };
}

function buildIndexTips({ localizationIndex, salesDistributionIndex, avgLocalizationSharePct, profile, monthlyOrders, actions }) {
  const tips = [];
  const il = localizationIndex;
  const irp = salesDistributionIndex;
  const price = profile.priceRub;
  const forwardAtMedian = profile.currentWarehouseCoeff * 46;

  if (il > 1.05) {
    const ilPenalty = forwardAtMedian * (il - 1);
    tips.push({
      id: 'il-high',
      kind: 'il',
      title: `ИЛ ×${il.toFixed(2)} — литровая логистика дороже на ~${roundRub(ilPenalty)} ₽/ед.`,
      body:
        avgLocalizationSharePct != null
          ? `Сейчас ~${roundPct(avgLocalizationSharePct)}% локальных заказов. Раскладка по регионам спроса может снизить ИЛ к ×1.0–1.1.`
          : 'Раскладывайте остатки ближе к регионам заказов — WB снижает ИЛ при росте доли локальных отгрузок.',
      impactPerUnit: roundRub(ilPenalty),
    });
  }

  if (irp > 0.015) {
    const irpCost = price * irp;
    tips.push({
      id: 'irp-high',
      kind: 'irp',
      title: `ИРП ${(irp * 100).toFixed(2)}% ≈ ${roundRub(irpCost)} ₽/ед. с цены`,
      body: 'ИРП растёт при низкой локализации. Часто дешевле отвезти товар на региональный склад со средним коэфф., чем платить ИРП с каждой продажи.',
      impactPerUnit: roundRub(irpCost),
    });
  }

  const localActions = actions.filter((a) => a.isLocal && a.verdict === 'recommend');
  if (localActions.length) {
    const top = localActions[0];
    tips.push({
      id: 'top-supply',
      kind: 'supply',
      title: `Приоритет: ${top.regionLabel} → ${top.warehouseName}`,
      body: top.reason,
      impactPerUnit: top.savingsPerUnit,
      demandQty: top.demandQty,
    });
  }

  const indexFirst = actions.filter((a) => a.verdict === 'index_first');
  for (const action of indexFirst.slice(0, 2)) {
    tips.push({
      id: `index-${action.id}`,
      kind: 'balance',
      title: `${action.regionLabel}: не гонитесь за коэфф. склада`,
      body: action.reason,
      impactPerUnit: action.savingsPerUnit,
    });
  }

  const totalIndexCost = forwardAtMedian * Math.max(0, il - 1) + price * irp;
  const targetIl = Math.max(1, il - 0.12);
  const targetIrp = Math.max(0, irp - 0.004);
  const targetCost = forwardAtMedian * Math.max(0, targetIl - 1) + price * targetIrp;

  return {
    localizationIndex: il,
    salesDistributionIndex: irp,
    avgLocalizationSharePct,
    indexCostPerUnit: roundRub(totalIndexCost),
    targetIl: roundPct(targetIl, 2),
    targetIrpPct: roundPct(targetIrp * 100, 2),
    targetSavingsPerUnit: roundRub(Math.max(0, totalIndexCost - targetCost)),
    targetSavingsMonthly: roundRub(Math.max(0, totalIndexCost - targetCost) * monthlyOrders),
    tips: tips.slice(0, 5),
  };
}

function buildSupplyPlan(actions, profile, indices) {
  const byWarehouse = new Map();

  for (const action of actions) {
    if (action.verdict === 'avoid_expensive') continue;
    const key = normalizeWarehouseKey(action.warehouseName);
    const hit =
      byWarehouse.get(key) ||
      {
        warehouseName: action.warehouseName,
        warehouseCoeff: action.warehouseCoeff,
        totalQty: 0,
        regions: [],
        costPerUnit: action.costPerUnit,
        baseForwardPerUnit: action.baseForwardPerUnit,
        ilMultiplier: action.ilMultiplier ?? indices.localizationIndex,
        irpPct: action.irpPct ?? indices.salesDistributionIndex * 100,
        projectedIl: action.projectedIl,
        projectedIrp: action.projectedIrp,
        irpSurchargePerUnit: action.irpSurchargePerUnit,
        isLocal: action.isLocal,
        isSynthetic: action.isSynthetic,
      };
    hit.totalQty += action.demandQty;
    hit.regions.push({
      label: action.regionLabel,
      qty: action.demandQty,
      sharePct: action.sharePct,
    });
    if (action.demandQty > (hit._topQty || 0)) {
      hit._topQty = action.demandQty;
      hit.costPerUnit = action.costPerUnit;
      hit.baseForwardPerUnit = action.baseForwardPerUnit;
      hit.ilMultiplier = action.ilMultiplier;
      hit.irpPct = action.irpPct;
      hit.projectedIl = action.projectedIl;
      hit.projectedIrp = action.projectedIrp;
      hit.irpSurchargePerUnit = action.irpSurchargePerUnit;
    }
    byWarehouse.set(key, hit);
  }

  const plan = [...byWarehouse.values()]
    .map((entry) => {
      let badge = 'balanced';
      if (entry.isLocal && entry.warehouseCoeff <= 1.6) badge = 'best';
      else if (entry.warehouseCoeff >= 2.2) badge = 'expensive';
      const { _topQty, ...row } = entry;
      return {
        ...row,
        badge,
        costPerUnit: row.costPerUnit || roundRub(profile.currentWarehouseCoeff * 50),
      };
    })
    .sort((a, b) => b.totalQty - a.totalQty);

  const totalQty = plan.reduce((sum, row) => sum + row.totalQty, 0);
  return plan.map((row) => ({
    ...row,
    sharePct: totalQty > 0 ? row.totalQty / totalQty : 0,
  }));
}

/**
 * Рекомендации по поставкам с учётом коэфф. складов, ИЛ и ИРП.
 */
export function buildRegionSupplyRecommendations({
  snapshot,
  rows = [],
  settings = {},
  meta = {},
  tariffCache = null,
}) {
  if (!snapshot?.totalQty) {
    return { indices: null, actions: [], supplyPlan: [], profile: null };
  }

  const profile = aggregateProductProfile(rows);
  const cargoType = resolveMatrixCargoType(rows);
  const { tariffList, byName, defaultTariff, resolveFo, tariffSource, tariffCacheDate, tariffCacheStale, tariffFromRows } =
    resolveTariffs(tariffCache, cargoType, rows, settings);

  const localizationIndex = normalizeLocalizationIndex(
    settings.localizationIndex ?? meta.localizationIndex ?? 1
  );
  const salesDistributionIndex = normalizeSalesDistributionIndex(
    settings.salesDistributionIndex ?? meta.salesDistributionIndex ?? 0
  );
  const indices = { localizationIndex, salesDistributionIndex };
  const monthlyOrders = Math.round(snapshot.totalQty || 0);

  const regions = (snapshot.byRegion || []).slice(0, 12);
  const actions = [];

  for (const region of regions) {
    if ((region.sharePct || 0) < 0.03 && regions.length > 5) continue;

    const candidates = warehouseCandidates(
      region,
      tariffList,
      byName,
      defaultTariff,
      resolveFo,
      settings,
      cargoType
    );
    const scored = candidates
      .map((tariff) => analyzeWarehouseForRegion(region, tariff, profile, settings, indices, resolveFo))
      .filter(Boolean);

    const analysis = pickBestAndRunnerUp(scored);
    const action = buildActionForRegion(region, analysis, profile, monthlyOrders);
    if (action) actions.push(action);
  }

  actions.sort((a, b) => b.priority - a.priority || b.demandQty - a.demandQty);

  const avgLocalizationSharePct = meta.avgLocalizationSharePct ?? null;
  const indexBlock = buildIndexTips({
    localizationIndex,
    salesDistributionIndex,
    avgLocalizationSharePct,
    profile,
    monthlyOrders,
    actions,
  });

  const supplyPlan = buildSupplyPlan(actions, profile, indices);

  const primaryTariff = profile.primaryWarehouse
    ? lookupWarehouseTariff(byName, profile.primaryWarehouse, defaultTariff)
    : defaultTariff;
  const currentCost = estimateFboLogisticsPerUnit(profile, primaryTariff || {}, settings, indices);

  return {
    profile,
    cargoType,
    cargoTypeLabel: cargoTypeLabel(cargoType),
    tariffSource,
    tariffCacheDate,
    tariffCacheStale,
    tariffFromRows,
    indices: indexBlock,
    actions: actions.slice(0, 8),
    supplyPlan: supplyPlan.slice(0, 6),
    currentWarehouse: profile.primaryWarehouse || primaryTariff?.warehouseName || null,
    currentWarehouseCoeff: primaryTariff?.warehouseCoeff ?? profile.currentWarehouseCoeff,
    currentCostPerUnit: roundRub(currentCost?.perUnit),
    hasTariffs: tariffList.length > 0,
  };
}

export function ktrLabelForShare(sharePct) {
  return ktrForLocalizationShare(sharePct);
}

export function krpLabelForShare(sharePct) {
  return krpForLocalizationShare(sharePct);
}
