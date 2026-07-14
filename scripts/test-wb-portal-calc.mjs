/**
 * Unit economics regression (article 8030700646 @ 7000₽).
 * Run: npm run test:unit-calc
 */
import { calculateUnitEconomicsRow } from '../lib/unit-economics/calculator.js';
import { calcWbLogisticsReportAligned } from '../lib/wb-logistics.js';
import { compareLogisticsToActual, actualStatsFromRow } from '../lib/logistics-compare.js';
import { mergeUnitSettings } from '../lib/unit-economics/settings.js';
import {
  buildDraftScenarioInput,
  draftScenarioSettings,
} from '../wb-unit-calc/src/lib/recalc-rows-cache.js';

const ARTICLE = {
  nmId: 8030700646,
  vendorCode: '8030700646-fixture',
  salePrice: 7000,
  basePrice: 7000,
  ourPrice: 7000,
  purchasePrice: 4348,
  fboCategoryRate: 0.242,
  fbsCategoryRate: 0.242,
  fbsAvgDeliveryHours: 29,
  lengthCm: 50.5,
  widthCm: 30,
  heightCm: 6.7,
  warehouseCoeff: 2.2,
  fbsCoeff: 2.2,
  stockFbs: 1,
  packagingCost: 165,
  buyoutRateFbs: 0.87,
  actualLogisticsRubFbs: 410,
  reportSalesFbs: 12,
  reportForwardLogisticsFbs: 3600,
  reportReturnLogisticsFbs: 720,
};

const baseSettings = mergeUnitSettings({
  fbsAvgDeliveryHours: 48,
  includeAcquiring: false,
  includeAdvertising: false,
  includeAcceptance: false,
  includeProcessing: false,
  defectRate: 0,
  includeVat: false,
  taxBaseMode: 'revenue',
  taxRate: 0.06,
  useBuyoutWeightedLogistics: true,
  preferActualRates: false,
  buyoutRate: 0.9,
});

function near(a, b, tol = 2) {
  return Math.abs(a - b) <= tol;
}

let failed = 0;
function check(label, ok) {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}

const row = calculateUnitEconomicsRow(ARTICLE, baseSettings);

console.log('8030700646 @ 7000₽ — УСН 6% + НДС 5% с цены\n');

check(
  'комиссия FBS = база 24.2% + 1.8 п.п. при 48ч (не +11.1)',
  near(row.fbsCategoryRate, 0.26, 0.001) && near(row.fbsCommissionRub, 7000 * 0.26, 5)
);
check(
  'в комиссии используются 48ч настроек',
  row.fbsAvgDeliveryHours === 48 && row.fbsAvgDeliveryHoursReport === 29
);
check(
  'логистика FBS с выкупом 87% выше прямой доставки',
  row.logisticsFbs > row.fbsBaseDelivery && near(row.buyoutRateFbs, 0.87, 0.001)
);

const forward = row.fbsForwardForLogistics ?? row.fbsBaseDelivery;
const expectedLog = calcWbLogisticsReportAligned({
  forwardDelivery: forward,
  returnDelivery: row.returnDeliveryFbs,
  buyoutRate: 0.87,
  returnMarkup: baseSettings.returnLogisticsMarkup,
});
check('логистика = формула отчёта (прямая+обратная)/выкуп', near(row.logisticsFbs, expectedLog, 5));

check('налог УСН 6% + НДС 5% с цены', near(row.taxRub, 7000 * 0.06 + (7000 * 0.05) / 1.05, 2));
check('НДС 5/105', near(row.vatRub, (7000 * 0.05) / 1.05, 2));

const withActual = calculateUnitEconomicsRow(ARTICLE, {
  ...baseSettings,
  preferActualRates: true,
});
check(
  'preferActual: логистика из отчёта',
  withActual.logisticsFbsSource === 'actual' && near(withActual.logisticsFbs, 410, 1)
);

const cmp = compareLogisticsToActual(
  row,
  actualStatsFromRow({
    ...ARTICLE,
    logisticsFbs: row.logisticsFbs,
    fbsBaseDelivery: row.fbsBaseDelivery,
    fbsForwardForLogistics: row.fbsForwardForLogistics,
    returnDeliveryFbs: row.returnDeliveryFbs,
    buyoutRateFbs: row.buyoutRateFbs,
  }),
  baseSettings
);
check(
  'сверка расчёт vs факт логистики',
  cmp != null && ['ok', 'low', 'high'].includes(cmp.match)
);

console.log('\nBreakdown:', {
  profitFbs: Math.round(row.profitFbs),
  fbsCommissionRub: Math.round(row.fbsCommissionRub),
  logisticsFbs: Math.round(row.logisticsFbs),
  taxRub: Math.round(row.taxRub),
  buyoutRateFbs: row.buyoutRateFbs,
  fbsAvgDeliveryHours: row.fbsAvgDeliveryHours,
  fbsAvgDeliveryHoursReport: row.fbsAvgDeliveryHoursReport,
  logisticsCompare: cmp?.match,
});

const noPurchase = calculateUnitEconomicsRow({ ...ARTICLE, purchasePrice: 0 }, baseSettings);
check('без закупки прибыль не считается', noPurchase.profitFbs == null);

const highPriceInput = {
  ...ARTICLE,
  salePrice: 32450,
  basePrice: 45000,
  ourPrice: 35000,
};
const draftPrice = 7000;
const draftSettings = draftScenarioSettings({
  ...baseSettings,
  preferActualRates: true,
  salesDistributionIndex: 0.02,
  includeAcquiring: true,
});
const pureDraft = calculateUnitEconomicsRow(
  { ...ARTICLE, salePrice: draftPrice, basePrice: draftPrice, ourPrice: draftPrice },
  draftSettings
);
const fixedDraft = calculateUnitEconomicsRow(
  buildDraftScenarioInput(highPriceInput, draftPrice),
  draftSettings
);
const buggyDraft = calculateUnitEconomicsRow(
  { ...highPriceInput, salePrice: draftPrice },
  { ...baseSettings, preferActualRates: false, salesDistributionIndex: 0.02, includeAcquiring: true }
);
check(
  'черновик 7000 при продаже 32450 = расчёт чисто по 7000',
  near(fixedDraft.profitFbs, pureDraft.profitFbs, 2) &&
    near(fixedDraft.fbsCommissionRub, draftPrice * pureDraft.fbsTotalRate, 5)
);
check(
  'старый баг: basePrice/ourPrice завышали ИРП и эквайринг черновика',
  fixedDraft.profitFbs > buggyDraft.profitFbs &&
    near(fixedDraft.logisticsIrpSurcharge ?? fixedDraft.fbsForwardForLogistics - fixedDraft.fbsBaseDelivery, 140, 5)
);

const fbsOnlyLogistics = calculateUnitEconomicsRow(
  {
    salePrice: 1000,
    purchasePrice: 400,
    actualLogisticsRubFbs: 410,
    fboCategoryRate: 0.25,
    fbsCategoryRate: 0.25,
  },
  { ...baseSettings, preferActualRates: true }
);
check(
  'FBS маржа без FBO логистики (нет габаритов)',
  fbsOnlyLogistics.logisticsFbo == null &&
    fbsOnlyLogistics.logisticsFbs === 410 &&
    fbsOnlyLogistics.marginFbs != null &&
    fbsOnlyLogistics.profitFbs != null
);

const ARTICLE_77112 = {
  vendorCode: '77112',
  subjectName: 'Сучкорезы',
  salePrice: 5000,
  basePrice: 5000,
  ourPrice: 5000,
  purchasePrice: 406,
  fboCategoryRate: 0.32,
  // kgvpMarketplace = ставка слайдера на 30 ч (как на скрине WB 35.50%)
  fbsCategoryRate: 0.355,
  fbsAvgDeliveryHours: 29,
  lengthCm: 35,
  widthCm: 12,
  heightCm: 6,
  warehouseCoeff: 2.2,
  fbsCoeff: 2.2,
  stockFbs: 1,
  buyoutRateFbs: 0.95,
  commissionActualPct: 0.28,
};

const wbPortalSettings = mergeUnitSettings({
  preferActualRates: true,
  includeAcquiring: false,
  includeAdvertising: false,
  includeAcceptance: false,
  includeProcessing: false,
  defectRate: 0,
  includeVat: false,
  taxRate: 0.11,
  useBuyoutWeightedLogistics: false,
  includeLogisticsIndices: false,
});

const row77112 = calculateUnitEconomicsRow(ARTICLE_77112, wbPortalSettings);

console.log('\n77112 @ 5000₽ — шкала WB 30ч=35.5% … 72ч=39.7%\n');

check(
  '48ч: 35.5% + 1.8 п.п. = 37.3% (не 46%)',
  near(row77112.fbsCategoryRate, 0.373, 0.0005) && near(row77112.fbsCommissionRub, 5000 * 0.373, 2)
);
check(
  'факт из отчёта не подменяет тарифную комиссию',
  row77112.fbsCategorySource !== 'actual' && row77112.commissionActualPct === 0.28
);
check(
  '48ч из настроек, не 29ч timeToReady из кабинета',
  row77112.fbsAvgDeliveryHours === 48 && row77112.fbsAvgDeliveryHoursReport === 29
);
check(
  'премия при 48ч = 1.8 п.п. (не 11.1)',
  near(row77112.fbsDeliverySurcharge, 0.018, 0.0005)
);

const row30 = calculateUnitEconomicsRow(ARTICLE_77112, {
  ...wbPortalSettings,
  fbsAvgDeliveryHours: 30,
});
const row72 = calculateUnitEconomicsRow(ARTICLE_77112, {
  ...wbPortalSettings,
  fbsAvgDeliveryHours: 72,
});
const row31 = calculateUnitEconomicsRow(ARTICLE_77112, {
  ...wbPortalSettings,
  fbsAvgDeliveryHours: 31,
});
check('30ч = база 35.50%', near(row30.fbsCategoryRate, 0.355, 0.0005));
check('72ч = 39.70% (база + 4.2 п.п.)', near(row72.fbsCategoryRate, 0.397, 0.0005));
check(
  'каждый час: 31ч = 30ч + 0.1 п.п. (не корзина 30/48/72)',
  near(row31.fbsCategoryRate, 0.356, 0.0005)
);

// Опрыскиватель / категория ~35% — регресс «не 46.1%»
const SPRAYER = {
  vendorCode: '8060700041',
  salePrice: 22450,
  basePrice: 22450,
  ourPrice: 22450,
  purchasePrice: 10000,
  fboCategoryRate: 0.32,
  fbsCategoryRate: 0.35,
  stockFbs: 1,
};
const sprayer = calculateUnitEconomicsRow(SPRAYER, {
  ...wbPortalSettings,
  fbsAvgDeliveryHours: 48,
});
check(
  '8060700041 @ 48ч: ~36.8% (не 46.1% / 10349₽)',
  near(sprayer.fbsCategoryRate, 0.368, 0.0005) &&
    near(sprayer.fbsCommissionRub, 22450 * 0.368, 5) &&
    sprayer.fbsCommissionRub < 9000
);

// Пылесос строительный: rate30 = kgvpMarketplace 34.5%
const VACUUM = {
  vendorCode: 'pilesos-kolner',
  subjectName: 'Пылесосы строительные',
  salePrice: 7000,
  basePrice: 7000,
  ourPrice: 7000,
  purchasePrice: 3490,
  fboCategoryRate: 0.31,
  fbsCategoryRate: 0.345,
  stockFbs: 1,
};
const vacuum = calculateUnitEconomicsRow(VACUUM, {
  ...wbPortalSettings,
  fbsAvgDeliveryHours: 48,
});
check(
  'пылесос @ 7000 / 3490: комиссия 36.3% при 48ч',
  near(vacuum.fbsCategoryRate, 0.363, 0.0005) && near(vacuum.fbsCommissionRub, 7000 * 0.363, 3)
);

console.log('Breakdown 77112:', {
  fbsCommissionRub: Math.round(row77112.fbsCommissionRub),
  fbsCategoryRate: row77112.fbsCategoryRate,
  logisticsFbs: Math.round(row77112.logisticsFbs),
  taxRub: Math.round(row77112.taxRub),
  profitFbs: Math.round(row77112.profitFbs),
  marginFbs: row77112.marginFbs,
});
console.log('Sprayer 48ч:', {
  rate: sprayer.fbsCategoryRate,
  commission: Math.round(sprayer.fbsCommissionRub),
});
console.log('Vacuum 48ч:', {
  rate: vacuum.fbsCategoryRate,
  commission: Math.round(vacuum.fbsCommissionRub),
  profit: Math.round(vacuum.profitFbs),
});

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
