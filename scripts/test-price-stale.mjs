/**
 * Price staleness + row patch helpers.
 * Run: node scripts/test-price-stale.mjs
 */
import {
  PRICES_MAX_AGE_MS,
  applyPriceUpdatesToRows,
  isPricesStale,
} from '../lib/wb-sync-cache.js';

let failed = 0;
function check(label, ok) {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}

const fresh = new Date().toISOString();
const stale = new Date(Date.now() - PRICES_MAX_AGE_MS - 60_000).toISOString();

check('fresh syncedAt is not stale', !isPricesStale(fresh));
check('old syncedAt is stale', isPricesStale(stale));
check('missing syncedAt is stale', isPricesStale(null));

const rows = [
  { nmId: 8030700646, vendorCode: '8030700646', salePrice: 32450, basePrice: 35000, ourPrice: 32450 },
  { nmId: 2, vendorCode: 'other', salePrice: 1000, basePrice: 1000, ourPrice: 1000 },
];

const patched = applyPriceUpdatesToRows(rows, {
  8030700646: { salePrice: 7000, basePrice: 7000, ourPrice: 7000 },
});

check(
  'patch updates sale price for nmId',
  patched[0].salePrice === 7000 && patched[0].ourPrice === 7000
);
check('patch leaves unmatched rows', patched[1].salePrice === 1000);
check('patch preserves vendorCode', patched[0].vendorCode === '8030700646');

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll price-stale checks passed');
