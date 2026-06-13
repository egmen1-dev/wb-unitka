import {
  extractDimensions,
  extractFbsStockForCard,
  extractPriceFromGoods,
  fetchAllPrices,
  fetchBoxTariffs,
  fetchCommissionTariffs,
  fetchContentCardsByNmIds,
  fetchContentCardsByVendorCodes,
  fetchContentCardsChunk,
  fetchContentCardsUpdatedSince,
  fetchFboStocksDetailed,
  fetchStocksForWarehouse,
  fetchWarehouses,
  fetchWbOffices,
  hasOfficialWbApi,
  withWbApiToken,
} from '../../lib/wb-official-api.js';
import { fetchNmOrders7d } from '../../lib/wb-sales-funnel.js';
import { fetchNmAdvertStats, serializeAdvertLookup } from '../../lib/wb-advert-stats.js';
import {
  computeRealizationCatalogOverlap,
  fetchNmRealizationStats,
  lookupRealizationStat,
  patchCatalogNmIdsFromReport,
  resolveReportNmId,
  restoreRealizationResult,
  serializeRealizationResult,
  serializeRealizationVendorSales,
} from '../../lib/wb-realization-stats.js';
import {
  fetchFbsAssemblyOrderStats,
  resolvePrimaryFbsShipmentContext,
} from '../../lib/wb-fbs-warehouse-stats.js';
import {
  lookupFbsTariff,
  lookupWarehouseTariff,
  pickPrimaryFboWarehouse,
  resolveOfficeName,
  resolveSellerOfficeId,
} from '../../lib/wb-warehouse-tariffs.js';
import {
  cardToCachedProduct,
  collectAllSkus,
  findMissingNmIds,
  mergeProductCache,
  minutesSince,
  shouldFetchFullCatalog,
  slimProductsForCache,
} from '../../lib/wb-sync-cache.js';
import {
  hydrateTariffCache,
  serializeTariffCache,
} from '../../lib/wb-tariff-cache.js';

async function resolveTariffs(wbCache) {
  const hydrated = hydrateTariffCache(wbCache?.tariffCache);
  if (hydrated) {
    return { ...hydrated, tariffCache: wbCache.tariffCache };
  }

  const commissionsBySubject = await fetchCommissionTariffs();
  await sleep(600);
  const boxTariffs = await fetchBoxTariffs();
  const tariffCache = serializeTariffCache(commissionsBySubject, boxTariffs);
  return { commissionsBySubject, boxTariffs, tariffCache };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveProductTariffs({
  fboStockDetail,
  fbsSellerWarehouse,
  fbsOfficeNameOverride,
  wbOfficesById,
  tariffByName,
  defaultTariff,
}) {
  const fboPrimary = pickPrimaryFboWarehouse(fboStockDetail);
  const fboTariff = lookupWarehouseTariff(tariffByName, fboPrimary?.name, defaultTariff);

  const fbsOfficeName =
    fbsOfficeNameOverride ||
    resolveOfficeName(wbOfficesById, resolveSellerOfficeId(fbsSellerWarehouse));
  const fbsTariff = lookupFbsTariff({
    tariffByName,
    defaultTariff,
    officeName: fbsOfficeName,
    sellerWarehouseName: fbsSellerWarehouse?.name,
  });

  // Тариф 46/14 ₽ — из настроек (как в таблице). Со склада WB — только коэффициент и хранение.
  return {
    fboWarehouseName: fboPrimary?.name || '',
    fbsWarehouseName: fbsOfficeName || fbsSellerWarehouse?.name || '',
    warehouseCoeff: fboTariff.warehouseCoeff,
    storageBasePerLiter: fboTariff.storageBasePerLiter,
    storageAdditionalPerLiter: fboTariff.storageAdditionalPerLiter,
    storageCoeff: fboTariff.storageCoeff,
    fbsCoeff: fbsTariff.fbsCoeff,
  };
}

function cardForFbsStock(staticInfo) {
  return {
    sizes: [{ skus: staticInfo.skus || [] }],
  };
}

function catalogPricesOverlap(catalog, pricesByNmId) {
  const ids = (catalog || []).map((p) => Number(p.nmId)).filter(Boolean);
  if (!ids.length) return 0;
  const matched = ids.filter((id) => pricesByNmId.has(id)).length;
  return matched / ids.length;
}

/** Подтягивает карточки из Prices/отчёта, если кэш не совпадает с текущим кабинетом. */
async function reconcileCatalogWithSeller(mergedCache, pricesByNmId, realization, { mode, realizationOnly }) {
  const cardToProduct = (card) => cardToCachedProduct(card, extractDimensions);
  let cache = mergedCache || [];
  let cardsAdded = 0;

  const pricesOverlap = catalogPricesOverlap(cache, pricesByNmId);
  const reportOverlap = computeRealizationCatalogOverlap(
    cache.map((p) => ({ nmId: p.nmId, vendorCode: p.vendorCode })),
    realization
  );

  const needsReconcile =
    realizationOnly ||
    pricesOverlap < 0.85 ||
    ((realization.totalSales ?? 0) > 0 &&
      reportOverlap.catalogNmWithSales === 0 &&
      reportOverlap.catalogVendorWithSales === 0);

  if (!needsReconcile) {
    return { cache, cardsAdded, pricesOverlap, reportOverlap };
  }

  cache = cache.filter((p) => pricesByNmId.has(Number(p.nmId)));

  const missingFromPrices = findMissingNmIds(pricesByNmId, cache);
  const soldNmIds = [...(realization.byNmId || new Map()).entries()]
    .filter(([, stat]) => stat.sales > 0)
    .map(([id]) => Number(id))
    .filter((id) => id && !cache.some((p) => Number(p.nmId) === id));

  const maxFetch = mode === 'full' ? 2000 : realizationOnly ? 500 : 300;
  const nmIdsToFetch = [...new Set([...missingFromPrices, ...soldNmIds])].slice(0, maxFetch);

  if (nmIdsToFetch.length) {
    const cards = await fetchContentCardsByNmIds(nmIdsToFetch, { concurrency: 8 });
    cardsAdded = cards.length;
    if (cards.length) {
      cache = mergeProductCache(cache, cards, cardToProduct);
    }
  }

  cache = patchCatalogNmIdsFromReport(cache, realization);
  let reportOverlapAfter = computeRealizationCatalogOverlap(
    cache.map((p) => ({ nmId: p.nmId, vendorCode: p.vendorCode })),
    realization
  );

  if (
    (realization.totalSales ?? 0) > 0 &&
    reportOverlapAfter.catalogVendorWithSales === 0 &&
    reportOverlapAfter.catalogNmWithSales === 0 &&
    mode === 'full'
  ) {
    const vendorsToFix = cache
      .map((p) => String(p.vendorCode || '').trim())
      .filter(Boolean)
      .slice(0, mode === 'full' ? 120 : 60);
    if (vendorsToFix.length) {
      const vendorCards = await fetchContentCardsByVendorCodes(vendorsToFix, { concurrency: 6 });
      cardsAdded += vendorCards.length;
      if (vendorCards.length) {
        cache = mergeProductCache(cache, vendorCards, cardToProduct);
        cache = patchCatalogNmIdsFromReport(cache, realization);
      }
    }
    reportOverlapAfter = computeRealizationCatalogOverlap(
      cache.map((p) => ({ nmId: p.nmId, vendorCode: p.vendorCode })),
      realization
    );
  }

  return {
    cache,
    cardsAdded,
    pricesOverlap: catalogPricesOverlap(cache, pricesByNmId),
    reportOverlap: reportOverlapAfter,
  };
}

function buildProduct(staticInfo, dims, ctx) {
  const resolvedNmId = resolveReportNmId(ctx.realization, staticInfo.nmId, staticInfo.vendorCode);
  const nmId = resolvedNmId || Number(staticInfo.nmId) || 0;
  const goods = ctx.pricesByNmId.get(nmId) ?? ctx.pricesByNmId.get(staticInfo.nmId);
  const { price: ourPrice, oldPrice } = extractPriceFromGoods(goods);
  const basePrice = oldPrice || ourPrice;
  const salePrice = ourPrice || oldPrice;
  const fboStockDetail = ctx.fboStocksDetailed.get(nmId) || { total: 0, warehouses: [] };
  const commission = ctx.commissionsBySubject.get(staticInfo.subjectId) || {
    fboCategory: 0.245,
    fbsCategory: 0.28,
  };
  const actual = lookupRealizationStat(ctx.realization, nmId, staticInfo.vendorCode);
  const advert = ctx.advertStats.byNmId.get(nmId) || ctx.advertStats.byNmId.get(Number(staticInfo.nmId)) || {};
  const deliveryHours =
    ctx.deliveryStats.byNmId.get(nmId) ?? ctx.deliveryStats.sellerAvgDeliveryHours ?? null;

  const fbsStock = ctx.skipFbsStockFetch
    ? { stock: staticInfo.stockFbs ?? 0, sellerWarehouse: ctx.primarySellerWarehouse || null }
    : extractFbsStockForCard(cardForFbsStock(staticInfo), ctx.fbsStocksBySellerWarehouse);

  const sellerWarehouseForFbs =
    ctx.primaryFbsShipment?.sellerWarehouse ||
    fbsStock.sellerWarehouse ||
    ctx.primarySellerWarehouse ||
    null;

  const warehouseTariffs = resolveProductTariffs({
    fboStockDetail,
    fbsSellerWarehouse: sellerWarehouseForFbs,
    fbsOfficeNameOverride: ctx.primaryFbsShipment?.officeName || '',
    wbOfficesById: ctx.wbOffices.byId,
    tariffByName: ctx.tariffByName,
    defaultTariff: ctx.defaultTariff,
  });

  return {
    nmId,
    vendorCode: staticInfo.vendorCode,
    brand: staticInfo.brand,
    title: staticInfo.title,
    subjectId: staticInfo.subjectId,
    subjectName: staticInfo.subjectName || commission.subjectName || '',
    skus: staticInfo.skus || [],
    stockFbo: fboStockDetail.total ?? staticInfo.stockFbo ?? 0,
    stockFbs: fbsStock.stock ?? staticInfo.stockFbs ?? 0,
    fboWarehouseName: warehouseTariffs.fboWarehouseName,
    fbsWarehouseName: warehouseTariffs.fbsWarehouseName,
    orders7d: ctx.ordersResult.byNmId.get(nmId) ?? 0,
    salePrice,
    basePrice,
    ourPrice: ourPrice || salePrice,
    fboCommission: commission.fboCategory,
    fbsCommission: commission.fbsCategory,
    commissionActualPct: actual.avgCommissionPct ?? null,
    buyoutRate: actual.buyoutRateFbs ?? actual.buyoutRate,
    buyoutRateFbs: actual.buyoutRateFbs,
    buyoutRateFbo: actual.buyoutRateFbo,
    acquiringRate: actual.acquiringRate,
    actualAcquiringRub: actual.avgAcquiringRub,
    retailPricePerUnit: actual.retailPricePerUnit,
    actualLogisticsRub: actual.avgLogisticsRubFbs ?? actual.avgLogisticsRub,
    actualLogisticsRubFbs: actual.avgLogisticsRubFbs,
    actualLogisticsRubFbo: actual.avgLogisticsRubFbo,
    actualLogisticsRubAll: actual.avgLogisticsRub,
    actualForwardLogisticsRub: actual.avgForwardLogisticsRub,
    actualReturnLogisticsRub: actual.avgReturnLogisticsRub,
    actualForwardLogisticsRubFbs: actual.avgForwardLogisticsRubFbs,
    actualReturnLogisticsRubFbs: actual.avgReturnLogisticsRubFbs,
    reportForwardLogistics: actual.forwardLogisticsSum,
    reportReturnLogistics: actual.returnLogisticsSum,
    reportOtherLogistics: actual.otherLogisticsSum,
    reportForwardLogisticsFbs: actual.forwardLogisticsSumFbs,
    reportReturnLogisticsFbs: actual.returnLogisticsSumFbs,
    reportSalesFbs: actual.salesFbs,
    reportSalesFbo: actual.salesFbo,
    actualStorageRub: actual.avgStorageRub,
    actualAcceptanceRub: actual.avgAcceptanceRub,
    actualProcessingRub: actual.avgProcessingRub,
    reportSales: actual.sales,
    reportReturns: actual.returns,
    reportRetailSum: actual.retailSum,
    reportRetailReturnSum: actual.retailReturnSum,
    reportForPayNet: actual.forPayNet,
    reportCommissionRub: actual.commissionRubSum,
    reportAcquiringRub: actual.acquiringFeeSum,
    reportLogisticsRub: actual.deliveryRubSum,
    reportStorageRub: actual.storageFeeSum,
    reportAcceptanceRub: actual.acceptanceSum,
    reportProcessingRub: actual.processingSum,
    reportPenaltyRub: actual.penaltySum,
    reportDeductionRub: actual.deductionSum,
    reportAdditionalPaymentRub: actual.additionalPaymentSum,
    adSpend: advert.adSpend ?? null,
    advertisingDrr: advert.advertisingDrr ?? null,
    adOrders: advert.adOrders ?? 0,
    fbsAvgDeliveryHours: deliveryHours,
    warehouseCoeff: warehouseTariffs.warehouseCoeff,
    storageBasePerLiter: warehouseTariffs.storageBasePerLiter,
    storageAdditionalPerLiter: warehouseTariffs.storageAdditionalPerLiter,
    storageCoeff: warehouseTariffs.storageCoeff,
    fbsCoeff: warehouseTariffs.fbsCoeff,
    ...dims,
  };
}

/** Пошаговая загрузка каталога карточек (без таймаута на 600+ SKU). */
async function fetchCatalogChunkPhase(token, wbCache, catalogCursor, catalogMaxPages = 3) {
  return withWbApiToken(token, async () => {
    let mergedCache = wbCache?.products || [];
    let cursor = catalogCursor || null;

    for (let page = 0; page < catalogMaxPages; page += 1) {
      const chunk = await fetchContentCardsChunk(cursor);
      if (chunk.cards.length) {
        mergedCache = mergeProductCache(mergedCache, chunk.cards, (card) =>
          cardToCachedProduct(card, extractDimensions)
        );
      }
      cursor = chunk.nextCursor;
      if (chunk.done) break;
      await sleep(350);
    }

    const now = new Date().toISOString();
    const catalogDone = !cursor;

    return {
      phase: 'catalog',
      syncedAt: now,
      syncMode: 'full',
      catalogNextCursor: cursor,
      catalogDone,
      catalogLoaded: mergedCache.length,
      fullCatalogAt: catalogDone ? now : wbCache?.fullCatalogAt || null,
      cardsSyncedAt: now,
      productCache: mergedCache,
      products: [],
    };
  });
}

/**
 * @param {string} token
 * @param {{ mode?: 'quick'|'full'|'bootstrap', phase?: 'catalog'|'data'|'realization', wbCache?: object, catalogCursor?: object, catalogMaxPages?: number, skipRealization?: boolean, realizationOnly?: boolean }} options
 */
export async function fetchWbCatalogSnapshot(token, options = {}) {
  if (!hasOfficialWbApi(token)) {
    throw new Error('Укажите WB API токен');
  }

  const mode = options.mode === 'full' ? 'full' : options.mode === 'bootstrap' ? 'bootstrap' : 'quick';
  const phase =
    options.phase === 'catalog' ? 'catalog' : options.phase === 'realization' ? 'realization' : 'data';
  const wbCache = options.wbCache || null;
  const realizationOnly = phase === 'realization' || options.realizationOnly === true;
  const skipRealization = options.skipRealization === true;

  if (phase === 'catalog') {
    return fetchCatalogChunkPhase(
      token,
      wbCache,
      options.catalogCursor || null,
      options.catalogMaxPages ?? 5
    );
  }

  const cardsFresh = minutesSince(wbCache?.cardsSyncedAt) < 20;
  const isBootstrap = mode === 'bootstrap';

  const profile = {
    ordersPages: isBootstrap || realizationOnly ? 0 : 1,
    realizationPages:
      isBootstrap || skipRealization
        ? 0
        : mode === 'full'
          ? 8
          : 4,
    deliveryPages: 0,
    includeAdvert: !isBootstrap && !realizationOnly,
    advertMaxCampaignChunks: mode === 'full' ? undefined : 2,
    fbsWarehouses: isBootstrap || realizationOnly ? 'skip' : 'primary',
    cardDeltaPages: cardsFresh || isBootstrap || realizationOnly ? 0 : 1,
    maxMissingCards: cardsFresh || isBootstrap || realizationOnly ? 0 : mode === 'full' ? 200 : 50,
  };

  const emptyRealization = {
    byNmId: new Map(),
    byVendorCode: new Map(),
    globalAcquiringRate: null,
    period: null,
    error: null,
    rowCount: 0,
    salesRows: 0,
    skuWithSales: 0,
    totalSales: 0,
    source: null,
  };
  const emptyOrders = {
    byNmId: new Map(),
    period: null,
    totalOrders: 0,
    withOrders: 0,
    error: null,
  };
  const emptyFbsShipment = {
    officeCounts: new Map(),
    sellerWarehouseCounts: new Map(),
    totalOrders: 0,
    periodDays: 30,
    error: null,
  };

  return withWbApiToken(token, async () => {
    const { commissionsBySubject, boxTariffs, tariffCache } = await resolveTariffs(wbCache);

    const [
      pricesByNmId,
      sellerWarehouses,
      wbOffices,
      fboStocksDetailed,
      ordersResult,
      realization,
      fbsShipmentStats,
    ] = await Promise.all([
      fetchAllPrices(),
      fetchWarehouses().catch(() => []),
      fetchWbOffices().catch(() => ({ list: [], byId: new Map() })),
      isBootstrap
        ? Promise.resolve(new Map())
        : fetchFboStocksDetailed().catch(() => new Map()),
      isBootstrap || profile.ordersPages <= 0
        ? Promise.resolve(emptyOrders)
        : fetchNmOrders7d(token, { days: 7, maxPages: profile.ordersPages }).catch((err) => ({
            byNmId: new Map(),
            period: null,
            totalOrders: 0,
            withOrders: 0,
            error: err.message || 'Не удалось загрузить заказы (нужен токен Analytics)',
          })),
      profile.realizationPages > 0
        ? fetchNmRealizationStats(token, { days: 30, maxPages: profile.realizationPages }).catch((err) => ({
            ...emptyRealization,
            error: err.message || 'Не удалось загрузить отчёт реализации (Finance / Statistics API)',
          }))
        : skipRealization && wbCache?.realizationSnapshot
          ? Promise.resolve(restoreRealizationResult(wbCache.realizationSnapshot))
          : Promise.resolve(emptyRealization),
      isBootstrap
        ? Promise.resolve(emptyFbsShipment)
        : fetchFbsAssemblyOrderStats(token, { days: 30 }).catch((err) => ({
            officeCounts: new Map(),
            sellerWarehouseCounts: new Map(),
            totalOrders: 0,
            periodDays: 30,
            error: err.message || 'Нет доступа к сборочным заданиям FBS',
          })),
    ]);

    let mergedCache = wbCache?.products || [];
    let cardsDeltaCount = 0;
    let catalogPricesOverlapPct = null;

    if (!mergedCache.length) {
      throw new Error('Нет кэша каталога. Сначала дождитесь загрузки карточек WB.');
    }

    const reconciled = await reconcileCatalogWithSeller(mergedCache, pricesByNmId, realization, {
      mode,
      realizationOnly,
    });
    mergedCache = reconciled.cache;
    cardsDeltaCount += reconciled.cardsAdded;
    catalogPricesOverlapPct = reconciled.pricesOverlap;
    mergedCache = patchCatalogNmIdsFromReport(mergedCache, realization);

    if (!cardsFresh && !realizationOnly) {
      const cardsSyncedAt = wbCache?.cardsSyncedAt || wbCache?.fullCatalogAt;
      const missingNmIds = findMissingNmIds(pricesByNmId, mergedCache);

      const [deltaCards, missingCards] = await Promise.all([
        cardsSyncedAt && profile.cardDeltaPages > 0
          ? fetchContentCardsUpdatedSince(cardsSyncedAt, { maxPages: profile.cardDeltaPages }).catch(
              () => []
            )
          : Promise.resolve([]),
        missingNmIds.length && profile.maxMissingCards > 0
          ? fetchContentCardsByNmIds(
              missingNmIds.slice(0, mode === 'full' ? 200 : realizationOnly ? 100 : 50)
            ).catch(() => [])
          : Promise.resolve([]),
      ]);

      const deltaMerged = [...deltaCards, ...missingCards];
      cardsDeltaCount = deltaMerged.length;
      if (deltaMerged.length) {
        mergedCache = mergeProductCache(mergedCache, deltaMerged, (card) =>
          cardToCachedProduct(card, extractDimensions)
        );
      }
    }

    const staticItems = mergedCache.map((product) => ({
      staticInfo: product,
      dims: {
        lengthCm: product.lengthCm,
        widthCm: product.widthCm,
        heightCm: product.heightCm,
        weightKg: product.weightKg,
      },
    }));

    const defaultTariff = boxTariffs.defaultTariff || boxTariffs;
    const tariffByName = boxTariffs.byName || new Map();
    const primarySellerWarehouse =
      sellerWarehouses.find((w) => w.id && !w.isDeleting) || sellerWarehouses[0];
    const primaryFbsShipment = resolvePrimaryFbsShipmentContext({
      sellerWarehouses,
      wbOfficesById: wbOffices.byId,
      shipmentStats: fbsShipmentStats,
    });

    const emptyAdvert = {
      byNmId: new Map(),
      globalAdvertisingDrr: null,
      totalAdSpend: 0,
      error: null,
    };

    const salesRevenueByNm = new Map();
    for (const [nmId, stat] of realization.byNmId || []) {
      const sales = Number(stat.sales) || 0;
      const retail = Number(stat.retailPricePerUnit) || 0;
      if (sales > 0 && retail > 0) {
        salesRevenueByNm.set(nmId, retail * sales);
      }
    }

    const deliveryResult = { byNmId: new Map(), sellerAvgDeliveryHours: null, period: null, error: null };
    const advertStats = profile.includeAdvert
      ? await fetchNmAdvertStats(token, {
          days: 30,
          salesRevenueByNm,
          maxCampaignChunks: profile.advertMaxCampaignChunks,
        }).catch((err) => ({
          ...emptyAdvert,
          error: err.message || 'Не удалось загрузить статистику рекламы',
        }))
      : emptyAdvert;
    let fbsStocksBySellerWarehouse = [];
    if (profile.fbsWarehouses !== 'skip') {
      const fbsWarehouse =
        primaryFbsShipment?.sellerWarehouse ||
        sellerWarehouses.find((w) => w.id && !w.isDeleting) ||
        sellerWarehouses[0];
      const skus = mergedCache.flatMap((p) => p.skus || []).filter(Boolean);
      if (fbsWarehouse?.id && skus.length) {
        const stocks = await fetchStocksForWarehouse(fbsWarehouse.id, skus).catch(() => new Map());
        fbsStocksBySellerWarehouse = [{ warehouse: fbsWarehouse, stocks }];
      }
    }

    const productCtx = {
      pricesByNmId,
      fboStocksDetailed,
      ordersResult,
      realization,
      deliveryStats: deliveryResult,
      advertStats,
      fbsStocksBySellerWarehouse,
      sellerWarehouses,
      commissionsBySubject,
      wbOffices,
      tariffByName,
      defaultTariff,
      primarySellerWarehouse,
      primaryFbsShipment,
      skipFbsStockFetch: profile.fbsWarehouses === 'skip',
    };

    const products = staticItems
      .map(({ staticInfo, dims }) => buildProduct(staticInfo, dims, productCtx))
      .filter((p) => p.salePrice > 0);

    const realizationOverlap = computeRealizationCatalogOverlap(products, realization);
    const advertLookup = serializeAdvertLookup(advertStats.byNmId, products);
    const now = new Date().toISOString();

    return {
      phase: realizationOnly ? 'realization' : 'data',
      syncedAt: now,
      syncMode: isBootstrap ? 'bootstrap' : mode === 'full' ? 'full' : 'quick',
      realizationLoaded: !isBootstrap,
      realizationSnapshot: isBootstrap ? null : serializeRealizationResult(realization),
      fullCatalogAt: wbCache?.fullCatalogAt || now,
      cardsSyncedAt: now,
      cardsDeltaCount,
      productCache: slimProductsForCache(products),
      boxTariffs,
      globalAcquiringRate: realization.globalAcquiringRate,
      globalAdvertisingDrr: advertStats.globalAdvertisingDrr,
      totalAdSpend: advertStats.totalAdSpend,
      advertPeriod: advertStats.period,
      advertCampaigns: advertStats.campaigns,
      advertError: advertStats.error || null,
      advertByNmId: advertLookup.byNmId,
      advertByVendor: advertLookup.byVendor,
      realizationPeriod: realization.period,
      realizationError: realization.error || null,
      realizationFinanceWarning: realization.financeWarning || null,
      realizationVendorSales: serializeRealizationVendorSales(realization.byVendorCode),
      realizationSource: realization.source || null,
      realizationRowCount: realization.rowCount ?? 0,
      realizationSkuWithSales: realization.skuWithSales ?? 0,
      realizationTotalSales: realization.totalSales ?? 0,
      realizationCatalogNmWithSales: realizationOverlap.catalogNmWithSales,
      realizationCatalogVendorWithSales: realizationOverlap.catalogVendorWithSales,
      realizationCatalogNmInReport: realizationOverlap.catalogNmInReport,
      realizationCatalogVendorInReport: realizationOverlap.catalogVendorInReport,
      realizationCatalogMismatch:
        (realization.totalSales ?? 0) > 0 &&
        realizationOverlap.catalogNmWithSales === 0 &&
        realizationOverlap.catalogVendorWithSales === 0 &&
        realizationOverlap.catalogVendorInReport === 0 &&
        realizationOverlap.catalogNmInReport === 0,
      catalogPricesOverlapPct,
      deliveryPeriod: deliveryResult.period,
      sellerAvgDeliveryHours: deliveryResult.sellerAvgDeliveryHours,
      deliveryError: deliveryResult.error,
      ordersPeriod: ordersResult.period,
      ordersTotal: ordersResult.totalOrders,
      ordersWithData: ordersResult.withOrders,
      ordersError: ordersResult.error || null,
      tariffsWarehouseCount: tariffByName.size,
      tariffsDefaultWarehouse: defaultTariff?.warehouseName || boxTariffs.warehouseName || '',
      fbsShipmentWarehouse: primaryFbsShipment.officeName || '',
      fbsShipmentSource: primaryFbsShipment.source,
      fbsShipmentOrders: primaryFbsShipment.orderCount,
      fbsShipmentTotal: fbsShipmentStats.totalOrders,
      fbsShipmentError: fbsShipmentStats.error || null,
      tariffCache,
      products,
    };
  });
}
