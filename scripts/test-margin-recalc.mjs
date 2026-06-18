/**
 * Margin must follow sale/draft price changes through recalc cache.
 * Run: node scripts/test-margin-recalc.mjs
 */
import { createRecalcRows } from '../wb-unit-calc/src/lib/recalc-rows-cache.js';
import { applyPriceUpdatesToRows } from '../lib/wb-sync-cache.js';
import { mergeUnitSettings } from '../lib/unit-economics/settings.js';
import {
  reconcileDraftOverridesAfterPricePatch,
  setProductOverride,
} from '../wb-unit-calc/src/lib/product-overrides.js';

let failed = 0;
function check(label, ok) {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}

const settings = mergeUnitSettings({ preferActualRates: true });
const recalc = createRecalcRows();

const baseRow = {
  nmId: 8030700646,
  vendorCode: '8030700646',
  salePrice: 32450,
  basePrice: 45000,
  ourPrice: 35000,
  purchasePrice: 4348,
  lengthCm: 50.5,
  widthCm: 30,
  heightCm: 6.7,
  fbsCommission: 0.242,
  retailPricePerUnit: 28000,
  actualLogisticsRubFbs: 410,
  reportSales: 10,
  fbsAvgDeliveryHours: 29,
  warehouseCoeff: 2.2,
  fbsCoeff: 2.2,
};

const before = recalc([baseRow], {}, settings, {})[0];
const patched = applyPriceUpdatesToRows([baseRow], {
  8030700646: { salePrice: 7000, basePrice: 7000, ourPrice: 7000 },
});
const after = recalc(patched, {}, settings, {})[0];

check(
  'sale price patch recalculates marginFbs',
  before.salePrice === 32450 &&
    after.salePrice === 7000 &&
    before.marginFbs != null &&
    after.marginFbs != null &&
    Math.abs(before.marginFbs - after.marginFbs) > 0.05
);
check(
  'price patch resets stale retailPricePerUnit',
  after.retailPricePerUnit === 7000
);

const noOverride = recalc(patched, {}, settings, {})[0];
check(
  'draft margin mirrors final margin without override',
  noOverride.draftMarginFbs != null &&
    Math.abs(noOverride.draftMarginFbs - noOverride.marginFbs) < 1e-9
);

const withDraft7000 = recalc(patched, {}, settings, {
  '8030700646': { draftSalePrice: '7000' },
})[0];
const withDraft5000 = recalc(patched, {}, settings, {
  '8030700646': { draftSalePrice: '5000' },
})[0];
check(
  'explicit draft change recalculates draftMarginFbs',
  withDraft7000.draftMarginFbs != null &&
    withDraft5000.draftMarginFbs != null &&
    Math.abs(withDraft7000.draftMarginFbs - withDraft5000.draftMarginFbs) > 0.05
);

let overrides = reconcileDraftOverridesAfterPricePatch(
  [baseRow],
  { 8030700646: { salePrice: 7000, basePrice: 7000, ourPrice: 7000 } },
  setProductOverride({}, '8030700646', 'draftSalePrice', '32450')
);
check(
  'draft override tied to old sale is cleared on price patch',
  !overrides['8030700646']?.draftSalePrice
);

overrides = reconcileDraftOverridesAfterPricePatch(
  [baseRow],
  { 8030700646: { salePrice: 7000, basePrice: 7000, ourPrice: 7000 } },
  setProductOverride({}, '8030700646', 'draftSalePrice', '5000')
);
check(
  'intentional draft scenario survives price patch',
  overrides['8030700646']?.draftSalePrice === '5000'
);

recalc.invalidate();
const cachedAgain = recalc(patched, {}, settings, {})[0];
check('cache invalidate keeps correct margin after price patch', cachedAgain.marginFbs === after.marginFbs);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll margin-recalc checks passed');
