/**
 * Sync cache helpers: realization staleness + price row patches.
 * Run: node scripts/test-price-stale.mjs
 */
import {
  REALIZATION_MAX_AGE_MS,
  applyPriceUpdatesToRows,
  isPriceDataStale,
  isPriceSyncedAtNewer,
  isRealizationStale,
  isSalePriceLikelyStale,
  mergeWorkspaceRowsPreservingLocalPrices,
  resolveRealizationSyncedAt,
  shouldSkipRealizationFetch,
} from '../lib/wb-sync-cache.js';

let failed = 0;
function check(label, ok) {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}

const fresh = new Date().toISOString();
const stale = new Date(Date.now() - REALIZATION_MAX_AGE_MS - 60_000).toISOString();

check('fresh realizationSyncedAt is not stale', !isRealizationStale(fresh));
check('old realizationSyncedAt is stale', isRealizationStale(stale));
check('missing realizationSyncedAt is stale', isRealizationStale(null));

const cacheWithSnapshot = {
  realizationSnapshot: { byNmId: {}, byVendorCode: {} },
  realizationSyncedAt: fresh,
};
check(
  'skip realization when cache is fresh',
  shouldSkipRealizationFetch({ mode: 'quick', wbCache: cacheWithSnapshot, fallbackSyncedAt: null })
);
check(
  'full sync always fetches realization',
  !shouldSkipRealizationFetch({ mode: 'full', wbCache: cacheWithSnapshot, fallbackSyncedAt: null })
);
check(
  'resolveRealizationSyncedAt falls back to syncedAt',
  resolveRealizationSyncedAt({ realizationSnapshot: {} }, fresh) === fresh
);

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
check(
  'patch resets retailPricePerUnit to new sale',
  patched[0].retailPricePerUnit === 7000
);

const localFresh = new Date().toISOString();
const cloudOld = new Date(Date.now() - 3600_000).toISOString();
check('local pricesSyncedAt newer than cloud', isPriceSyncedAtNewer(localFresh, cloudOld));
check('cloud pricesSyncedAt not newer when equal', !isPriceSyncedAtNewer(cloudOld, cloudOld));

const cloudRows = [
  { nmId: 8030700646, vendorCode: '8030700646', salePrice: 32450, basePrice: 35000, ourPrice: 32450 },
];
const localRows = [
  { nmId: 8030700646, vendorCode: '8030700646', salePrice: 7000, basePrice: 7000, ourPrice: 7000, retailPricePerUnit: 7000 },
];
const merged = mergeWorkspaceRowsPreservingLocalPrices(
  cloudRows,
  localRows,
  localFresh,
  cloudOld
);
check(
  'cloud pull keeps fresher local sale price',
  merged[0].salePrice === 7000 && merged[0].retailPricePerUnit === 7000
);
check(
  'cloud pull uses cloud when local prices older',
  mergeWorkspaceRowsPreservingLocalPrices(cloudRows, localRows, cloudOld, localFresh)[0].salePrice === 32450
);

check(
  'stale sale warning when draft differs from sale',
  isSalePriceLikelyStale({ salePrice: 32450, draftSalePrice: 7000 })
);
check(
  'no stale warning when prices close',
  !isSalePriceLikelyStale({ salePrice: 7000, draftSalePrice: 7100 })
);

check('missing pricesSyncedAt is stale', isPriceDataStale(null));
check('fresh pricesSyncedAt is not stale', !isPriceDataStale(localFresh));

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll sync-cache checks passed');
