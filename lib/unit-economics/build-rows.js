import seedPurchases from '../../wb-unit-economics-sheet/data/seed-purchases.json' with { type: 'json' };
import seedCommissions from '../../wb-unit-economics-sheet/data/seed-commissions.json' with { type: 'json' };
import { lookupSupplierPrice } from '../supplier-price-list.js';
import { calculateUnitEconomicsRow } from './calculator.js';
import { mergeUnitSettings } from './settings.js';
import { lookupSeedRecord, vendorLookupKeys } from './vendor-key.js';

function resolvePurchase(vendorCode, purchaseOverrides = {}, supplierIndex = null) {
  if (!vendorCode) return null;

  for (const key of vendorLookupKeys(vendorCode)) {
    if (purchaseOverrides[key] != null && purchaseOverrides[key] !== '') {
      return Number(purchaseOverrides[key]);
    }
  }

  const supplierPrice = lookupSupplierPrice(vendorCode, supplierIndex);
  if (supplierPrice != null) return supplierPrice;

  const seeded = lookupSeedRecord(seedPurchases, vendorCode);
  if (seeded != null) return Number(seeded);
  return null;
}

/** Комиссия: приоритет WB API по категории (subjectId), seed — только запасной вариант. */
function resolveCommission(vendorCode, product) {
  const seeded = lookupSeedRecord(seedCommissions, vendorCode);
  return {
    fboCategoryRate: product.fboCommission ?? seeded?.fboCategory ?? 0.245,
    fbsCategoryRate: product.fbsCommission ?? seeded?.fbsCategory ?? 0.28,
  };
}

export function buildUnitRows(
  snapshot,
  { purchaseOverrides = {}, settings = {}, settingsFromSnapshot = true, supplierIndex = null } = {}
) {
  const mergedSettings = mergeUnitSettings(settings);

  if (settingsFromSnapshot && snapshot?.boxTariffs) {
    const t = snapshot.boxTariffs;
    // Базовые 46/14 ₽ не перезаписываем тарифом случайного склада — только хранение из WB.
    mergedSettings.storageBasePerLiter = t.storageBasePerLiter ?? mergedSettings.storageBasePerLiter;
    mergedSettings.storageAdditionalPerLiter = t.storageAdditionalPerLiter ?? mergedSettings.storageAdditionalPerLiter;
    mergedSettings.storageCoeff = t.storageCoeff ?? mergedSettings.storageCoeff;
  }

  if (settingsFromSnapshot && snapshot?.globalAcquiringRate > 0) {
    mergedSettings.acquiringRate = snapshot.globalAcquiringRate;
  }

  if (settingsFromSnapshot && snapshot?.globalAdvertisingDrr > 0 && !mergedSettings.advertisingDrr) {
    mergedSettings.advertisingDrr = snapshot.globalAdvertisingDrr;
  }

  if (settingsFromSnapshot && snapshot?.sellerAvgDeliveryHours > 0) {
    mergedSettings.fbsAvgDeliveryHours = snapshot.sellerAvgDeliveryHours;
  }

  if (
    settingsFromSnapshot &&
    mergedSettings.autoSyncLogisticsIndices !== false &&
    snapshot?.localizationIndex != null
  ) {
    mergedSettings.localizationIndex = snapshot.localizationIndex;
    mergedSettings.salesDistributionIndex = snapshot.salesDistributionIndex ?? 0;
  }

  const rows = (snapshot?.products || []).map((product) => {
    const { fboCategoryRate, fbsCategoryRate } = resolveCommission(product.vendorCode, product);
    const purchasePrice = resolvePurchase(product.vendorCode, purchaseOverrides, supplierIndex);

    return calculateUnitEconomicsRow(
      {
        nmId: product.nmId,
        vendorCode: product.vendorCode,
        brand: product.brand,
        title: product.title,
        subjectId: product.subjectId,
        subjectName: product.subjectName,
        stockFbo: product.stockFbo ?? 0,
        stockFbs: product.stockFbs ?? 0,
        fboWarehouseName: product.fboWarehouseName,
        fbsWarehouseName: product.fbsWarehouseName,
        supplierStock: product.supplierStock ?? null,
        orders7d: product.orders7d ?? 0,
        purchasePrice,
        salePrice: product.salePrice,
        basePrice: product.basePrice,
        ourPrice: product.ourPrice,
        lengthCm: product.lengthCm,
        widthCm: product.widthCm,
        heightCm: product.heightCm,
        fboCategoryRate,
        fbsCategoryRate,
        fboCommission: product.fboCommission,
        fbsCommission: product.fbsCommission,
        buyoutRate: product.buyoutRate,
        buyoutRateFbs: product.buyoutRateFbs,
        buyoutRateFbo: product.buyoutRateFbo,
        acquiringRate: product.acquiringRate,
        actualAcquiringRub: product.actualAcquiringRub,
        retailPricePerUnit: product.retailPricePerUnit,
        actualLogisticsRub: product.actualLogisticsRub,
        actualLogisticsRubFbs: product.actualLogisticsRubFbs,
        actualLogisticsRubFbo: product.actualLogisticsRubFbo,
        actualLogisticsRubAll: product.actualLogisticsRubAll,
        actualForwardLogisticsRub: product.actualForwardLogisticsRub,
        actualReturnLogisticsRub: product.actualReturnLogisticsRub,
        actualForwardLogisticsRubFbs: product.actualForwardLogisticsRubFbs,
        actualReturnLogisticsRubFbs: product.actualReturnLogisticsRubFbs,
        reportForwardLogistics: product.reportForwardLogistics,
        reportReturnLogistics: product.reportReturnLogistics,
        reportOtherLogistics: product.reportOtherLogistics,
        reportForwardLogisticsFbs: product.reportForwardLogisticsFbs,
        reportReturnLogisticsFbs: product.reportReturnLogisticsFbs,
        reportSales: product.reportSales,
        reportSalesFbs: product.reportSalesFbs,
        reportSalesFbo: product.reportSalesFbo,
        reportReturns: product.reportReturns,
        reportRetailSum: product.reportRetailSum,
        reportRetailReturnSum: product.reportRetailReturnSum,
        reportForPayNet: product.reportForPayNet,
        reportCommissionRub: product.reportCommissionRub,
        reportAcquiringRub: product.reportAcquiringRub,
        reportLogisticsRub: product.reportLogisticsRub,
        reportStorageRub: product.reportStorageRub,
        reportAcceptanceRub: product.reportAcceptanceRub,
        reportProcessingRub: product.reportProcessingRub,
        reportPenaltyRub: product.reportPenaltyRub,
        reportDeductionRub: product.reportDeductionRub,
        reportAdditionalPaymentRub: product.reportAdditionalPaymentRub,
        actualStorageRub: product.actualStorageRub,
        actualAcceptanceRub: product.actualAcceptanceRub,
        actualProcessingRub: product.actualProcessingRub,
        adSpend: product.adSpend,
        advertisingDrr: product.advertisingDrr,
        adOrders: product.adOrders,
        fbsAvgDeliveryHours: product.fbsAvgDeliveryHours,
        packagingCost: product.packagingCost,
        warehouseCoeff: product.warehouseCoeff,
        storageBasePerLiter: product.storageBasePerLiter,
        storageAdditionalPerLiter: product.storageAdditionalPerLiter,
        storageCoeff: product.storageCoeff,
        fbsCoeff: product.fbsCoeff,
      },
      mergedSettings
    );
  });

  rows.sort((a, b) => String(a.vendorCode).localeCompare(String(b.vendorCode), 'ru'));

  const withPurchase = rows.filter((row) => row.purchasePrice != null && row.purchasePrice > 0).length;

  return {
    syncedAt: snapshot?.syncedAt || new Date().toISOString(),
    realizationPeriod: snapshot?.realizationPeriod,
    realizationError: snapshot?.realizationError,
    realizationFinanceWarning: snapshot?.realizationFinanceWarning,
    realizationVendorSales: snapshot?.realizationVendorSales || null,
    realizationSource: snapshot?.realizationSource,
    realizationRowCount: snapshot?.realizationRowCount ?? 0,
    realizationSkuWithSales: snapshot?.realizationSkuWithSales ?? 0,
    realizationTotalSales: snapshot?.realizationTotalSales ?? 0,
    realizationCatalogNmWithSales: snapshot?.realizationCatalogNmWithSales ?? 0,
    realizationCatalogVendorWithSales: snapshot?.realizationCatalogVendorWithSales ?? 0,
    realizationCatalogNmInReport: snapshot?.realizationCatalogNmInReport ?? 0,
    realizationCatalogVendorInReport: snapshot?.realizationCatalogVendorInReport ?? 0,
    realizationCatalogMismatch: snapshot?.realizationCatalogMismatch ?? false,
    catalogPricesOverlapPct: snapshot?.catalogPricesOverlapPct ?? null,
    realizationLoaded: snapshot?.realizationLoaded ?? snapshot?.syncMode !== 'bootstrap',
    globalAcquiringRate: snapshot?.globalAcquiringRate,
    globalAdvertisingDrr: snapshot?.globalAdvertisingDrr,
    totalAdSpend: snapshot?.totalAdSpend,
    advertPeriod: snapshot?.advertPeriod,
    advertError: snapshot?.advertError,
    advertCampaigns: snapshot?.advertCampaigns,
    advertCampaignsTotal: snapshot?.advertCampaignsTotal,
    advertCampaignsFetched: snapshot?.advertCampaignsFetched,
    advertSynced: snapshot?.advertSynced === true,
    advertByNmId: snapshot?.advertByNmId || null,
    advertByVendor: snapshot?.advertByVendor || null,
    sellerAvgDeliveryHours: snapshot?.sellerAvgDeliveryHours,
    localizationIndex: snapshot?.localizationIndex ?? null,
    salesDistributionIndex: snapshot?.salesDistributionIndex ?? null,
    localizationIndexSource: snapshot?.localizationIndexSource ?? null,
    salesDistributionIndexSource: snapshot?.salesDistributionIndexSource ?? null,
    logisticsIndicesComputedAt: snapshot?.logisticsIndicesComputedAt ?? null,
    logisticsIndicesPeriodDays: snapshot?.logisticsIndicesPeriodDays ?? null,
    logisticsIndicesOrderCount: snapshot?.logisticsIndicesOrderCount ?? 0,
    logisticsIndicesSkuCount: snapshot?.logisticsIndicesSkuCount ?? 0,
    logisticsIndicesError: snapshot?.logisticsIndicesError ?? null,
    avgLocalizationSharePct: snapshot?.avgLocalizationSharePct ?? null,
    deliveryPeriod: snapshot?.deliveryPeriod,
    deliveryError: snapshot?.deliveryError,
    ordersPeriod: snapshot?.ordersPeriod,
    ordersTotal: snapshot?.ordersTotal,
    ordersWithData: snapshot?.ordersWithData,
    ordersError: snapshot?.ordersError,
    tariffsWarehouseCount: snapshot?.tariffsWarehouseCount,
    tariffsDefaultWarehouse: snapshot?.tariffsDefaultWarehouse,
    fbsShipmentWarehouse: snapshot?.fbsShipmentWarehouse,
    fbsShipmentSource: snapshot?.fbsShipmentSource,
    fbsShipmentOrders: snapshot?.fbsShipmentOrders,
    fbsShipmentTotal: snapshot?.fbsShipmentTotal,
    fbsShipmentError: snapshot?.fbsShipmentError,
    total: rows.length,
    withPurchase,
    rows,
    tariffCache: snapshot?.tariffCache || null,
  };
}
