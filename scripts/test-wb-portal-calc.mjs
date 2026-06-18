/**
 * Regression: WB profit calculator vs our unit economics (article 8030700646 @ 7000₽).
 * Run: node scripts/test-wb-portal-calc.mjs
 */
import { calculateUnitEconomicsRow } from '../lib/unit-economics/calculator.js';
import { mergeUnitSettings } from '../lib/unit-economics/settings.js';

/** Snapshot from WB seller portal screenshot (2026-06). */
const WB_EXPECTED = {
  salePrice: 7000,
  purchasePrice: 4348,
  otherExpenses: 165,
  commissionRub: 2471,
  commissionPct: 0.353,
  logisticsRub: 372.97,
  wbExpensesRub: 2843.97,
  forPayRub: 4156.03,
  taxRub: -21.42,
  profitRub: -335.55,
};

/**
 * Fixture tuned to WB logistics 372.97₽ (≈10.1 л × coeff 2.2, склад «Белая дача МП»).
 * kgvpSupplier ≈ 24.2% + 48ч доставка ≈ 11.1% = 35.3%.
 */
const ARTICLE_8030700646 = {
  nmId: 8030700646,
  vendorCode: '8030700646-fixture',
  salePrice: WB_EXPECTED.salePrice,
  basePrice: WB_EXPECTED.salePrice,
  ourPrice: WB_EXPECTED.salePrice,
  purchasePrice: WB_EXPECTED.purchasePrice,
  fboCategoryRate: 0.242,
  fbsCategoryRate: 0.242,
  fbsAvgDeliveryHours: 48,
  lengthCm: 50.5,
  widthCm: 30,
  heightCm: 6.7,
  warehouseCoeff: 2.2,
  fbsCoeff: 2.2,
  stockFbs: 1,
  packagingCost: WB_EXPECTED.otherExpenses,
  buyoutRate: 1,
  buyoutRateFbs: 1,
};

const settings = mergeUnitSettings({
  includeAcquiring: false,
  includeAdvertising: false,
  includeAcceptance: false,
  includeProcessing: false,
  defectRate: 0,
  includeVat: false,
  taxBaseMode: 'wb_portal',
  taxRate: 0.06,
  useBuyoutWeightedLogistics: true,
});

const row = calculateUnitEconomicsRow(ARTICLE_8030700646, settings);

function near(a, b, tol = 2) {
  return Math.abs(a - b) <= tol;
}

const checks = [
  ['commission ₽', row.fbsCommissionRub, WB_EXPECTED.commissionRub, 15],
  ['commission %', row.fbsCategoryRate, WB_EXPECTED.commissionPct, 0.01],
  ['logistics FBS ₽', row.logisticsFbs, WB_EXPECTED.logisticsRub, 20],
  ['tax ₽', row.taxRub, WB_EXPECTED.taxRub, 3],
  ['profit FBS ₽', row.profitFbs, WB_EXPECTED.profitRub, 40],
];

let failed = 0;
console.log('Article 8030700646 @ 7000₽ — compare with WB portal\n');
for (const [label, actual, expected, tol] of checks) {
  const ok = actual != null && near(actual, expected, tol);
  if (!ok) failed += 1;
  console.log(
    `${ok ? '✓' : '✗'} ${label}: ours ${actual?.toFixed?.(2) ?? actual} vs WB ${expected} (±${tol})`
  );
}

console.log('\nBreakdown:');
console.log({
  profitFbs: row.profitFbs,
  fbsCommissionRub: row.fbsCommissionRub,
  fbsCategoryRate: row.fbsCategoryRate,
  logisticsFbs: row.logisticsFbs,
  taxRub: row.taxRub,
  packagingCost: row.packagingCost,
  volumeLiters: row.volumeLiters,
});

// Inflated display (~+1847): wrong purchase (~2165 vs 4348₽) + tiny volume (51₽ log)
// + tax from sale price instead of profit + missing full WB commission stack.
const inflated = calculateUnitEconomicsRow(
  {
    ...ARTICLE_8030700646,
    fboCategoryRate: 0.245,
    fbsCategoryRate: 0.245,
    lengthCm: 13,
    widthCm: 5,
    heightCm: 2,
    purchasePrice: 0,
    packagingCost: 0,
  },
  mergeUnitSettings({ includeVat: false, taxBaseMode: 'revenue' })
);
console.log('\nInflated (old bugs: no purchase, low comm/log): profitFbs ≈', Math.round(inflated.profitFbs));

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
