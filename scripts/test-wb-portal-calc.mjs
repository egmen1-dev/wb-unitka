/**
 * Unit economics regression (article 8030700646 @ 7000₽).
 * Run: npm run test:unit-calc
 */
import { calculateUnitEconomicsRow } from '../lib/unit-economics/calculator.js';
import { calcWbLogisticsReportAligned } from '../lib/wb-logistics.js';
import { compareLogisticsToActual, actualStatsFromRow } from '../lib/logistics-compare.js';
import { mergeUnitSettings } from '../lib/unit-economics/settings.js';

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

console.log('8030700646 @ 7000₽ — settings: 48ч доставки, налог с цены, без НДС\n');

check(
  'комиссия FBS 35.3% (48ч из настроек, не 29ч из кабинета)',
  near(row.fbsCategoryRate, 0.353, 0.008) && near(row.fbsCommissionRub, 2471, 20)
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

check('налог 6% с цены без НДС', near(row.taxRub, 7000 * 0.06, 1));

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

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
