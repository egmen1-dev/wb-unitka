/**
 * Purchase override must reach the calculator (margin not blank when закуп set).
 * Run: node scripts/test-purchase-override.mjs
 */
import { rowToCalculatorInput } from '../lib/unit-economics/calc-input.js';
import { calculateUnitEconomicsRow } from '../lib/unit-economics/calculator.js';

const baseRow = {
  vendorCode: '8030700646-fixture',
  purchasePrice: null,
  salePrice: 7000,
  fbsCategoryRate: 0.242,
  lengthCm: 50.5,
  widthCm: 30,
  heightCm: 6.7,
  fbsCoeff: 2.2,
};

let failed = 0;
function check(label, ok) {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}

const overridePrice = 4348;
const input = rowToCalculatorInput(baseRow, overridePrice);
check('rowToCalculatorInput keeps purchase override', input.purchasePrice === overridePrice);

const calc = calculateUnitEconomicsRow(input, { includeAcquiring: false, includeAdvertising: false });
check('margin FBS computed with purchase override', calc.marginFbs != null && calc.profitFbs != null);
check('purchasePrice on calc row', calc.purchasePrice === overridePrice);

const noLogisticsFbo = calculateUnitEconomicsRow(
  { ...input, lengthCm: 0, widthCm: 0, heightCm: 0 },
  { includeAcquiring: false, includeAdvertising: false }
);
check(
  'FBS margin still computed when FBO logistics unavailable',
  noLogisticsFbo.logisticsFbo == null && noLogisticsFbo.marginFbs != null
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll purchase override checks passed');
