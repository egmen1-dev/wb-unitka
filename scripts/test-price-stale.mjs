/**
 * Sync cache helpers: realization staleness + delta price row patches.
 * Run: node scripts/test-price-stale.mjs
 */
import {
  REALIZATION_MAX_AGE_MS,
  applyPriceUpdatesToRows,
  buildPriceUpdatesForItems,
  filterDeltaPriceUpdates,
  isPriceDataStale,
  isPriceSyncedAtNewer,
  isRealizationStale,
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
  patched.rows[0].salePrice === 7000 && patched.rows[0].ourPrice === 7000
);
check('patch leaves unmatched rows', patched.rows[1].salePrice === 1000);
check('patch preserves vendorCode', patched.rows[0].vendorCode === '8030700646');
check(
  'patch resets retailPricePerUnit to new sale',
  patched.rows[0].retailPricePerUnit === 7000
);
check('delta stats: one updated', patched.updated === 1);
check('delta stats: one missing (no API price)', patched.missing === 1);

const samePricePatch = applyPriceUpdatesToRows(rows, {
  2: { salePrice: 1000, basePrice: 1000, ourPrice: 1000 },
});
check('unchanged row not rewritten', samePricePatch.updated === 0 && samePricePatch.unchanged === 1);

const vendorPatch = applyPriceUpdatesToRows(
  [{ nmId: 999, vendorCode: '8030700646', salePrice: 32450, basePrice: 35000, ourPrice: 32450 }],
  { 'v:8030700646': { salePrice: 7000, basePrice: 7000, ourPrice: 7000 } }
);
check('vendorCode key patches row with wrong nmId', vendorPatch.rows[0].salePrice === 7000);

const localFresh = new Date().toISOString();
const cloudOld = new Date(Date.now() - 3600_000).toISOString();
check('local pricesSyncedAt newer than cloud', isPriceSyncedAtNewer(localFresh, cloudOld));
check('cloud pricesSyncedAt not newer when equal', !isPriceSyncedAtNewer(cloudOld, cloudOld));

const cloudRows = [
  { nmId: 8030700646, vendorCode: '8030700646', salePrice: 32450, basePrice: 35000, ourPrice: 32450 },
];
const localRows = [
  {
    nmId: 8030700646,
    vendorCode: '8030700646',
    salePrice: 7000,
    basePrice: 7000,
    ourPrice: 7000,
    retailPricePerUnit: 7000,
  },
];
const merged = mergeWorkspaceRowsPreservingLocalPrices(cloudRows, localRows, localFresh, cloudOld);
check(
  'cloud pull keeps fresher local sale price',
  merged[0].salePrice === 7000 && merged[0].retailPricePerUnit === 7000
);
check(
  'cloud pull uses cloud when local prices older',
  mergeWorkspaceRowsPreservingLocalPrices(cloudRows, localRows, cloudOld, localFresh)[0].salePrice === 32450
);

check('missing pricesSyncedAt is stale', isPriceDataStale(null));
check('fresh pricesSyncedAt is not stale', !isPriceDataStale(localFresh));

const bulkRows = Array.from({ length: 100 }, (_, i) => ({
  nmId: 100000 + i,
  vendorCode: `art-${i}`,
  salePrice: 5000 + i,
  basePrice: 5000 + i,
  ourPrice: 5000 + i,
}));

const pricesByNmId = new Map();
for (let i = 0; i < 100; i += 1) {
  const nmId = 100000 + i;
  const salePrice = i < 5 ? 7000 + i : 5000 + i;
  pricesByNmId.set(nmId, {
    nmID: nmId,
    vendorCode: `art-${i}`,
    sizes: [{ price: salePrice, discountedPrice: salePrice }],
  });
}

const { priceUpdates } = buildPriceUpdatesForItems(bulkRows, pricesByNmId);
const delta = filterDeltaPriceUpdates(bulkRows, priceUpdates);
const bulkPatched = applyPriceUpdatesToRows(bulkRows, delta.priceUpdates);

check('100 rows: only 5 prices changed in API', delta.updated === 5);
check('100 rows: 95 unchanged', delta.unchanged === 95);
check('100 rows: stale row 0 salePrice becomes 7000', bulkPatched.rows[0].salePrice === 7000);
check('100 rows: unchanged row 50 keeps salePrice', bulkPatched.rows[50].salePrice === 5050);
check('100 rows: apply updates only 5 rows', bulkPatched.updated === 5);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll sync-cache checks passed');
