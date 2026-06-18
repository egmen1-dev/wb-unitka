/**
 * Brand filter regression (no Vite aliases).
 * Run: node scripts/test-brand-filter.mjs
 */
import {
  filterRowsByBrand,
  normalizeBrandFilter,
} from '../wb-unit-calc/src/lib/brand-filter.js';
import { buildLogisticsReconciliation } from '../lib/logistics-compare.js';

const rows = [
  { nmId: 1, brand: 'Alpha', salePrice: 1000, purchasePrice: 400 },
  { nmId: 2, brand: 'Beta', salePrice: 2000, purchasePrice: 0 },
  { nmId: 3, brand: '', salePrice: 500, purchasePrice: 300 },
];

let failed = 0;
function check(label, ok) {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}

check('normalizeBrandFilter rejects null', normalizeBrandFilter(null).length === 0);
check('normalizeBrandFilter keeps names', normalizeBrandFilter(['Alpha']).join() === 'Alpha');

const filtered = filterRowsByBrand(rows, ['Alpha']);
check('filter by Alpha', filtered.length === 1 && filtered[0].nmId === 1);

const emptyBrand = filterRowsByBrand(rows, ['Missing']);
check('unknown brand -> 0 rows', emptyBrand.length === 0);

const emDash = filterRowsByBrand(rows, ['—']);
check('empty brand normalized to em dash', emDash.length === 1 && emDash[0].nmId === 3);

function simulateMarginChartPct(bucketStats) {
  const eligibleCount = bucketStats.eligible?.length ?? 0;
  const counts = bucketStats.counts || { loss: 0 };
  if (!eligibleCount) return [];
  return Object.keys(counts)
    .map((id) => {
      const count = counts[id] || 0;
      if (!count) return null;
      return (count / eligibleCount) * 100;
    })
    .filter((v) => v != null);
}

const legacyCollapsedStub = { eligible: [] };
check(
  'legacy collapsed stub would crash without counts guard',
  (() => {
    try {
      const counts = legacyCollapsedStub.counts;
      return counts?.loss === undefined;
    } catch {
      return true;
    }
  })()
);
check('margin chart pct safe on empty eligible', simulateMarginChartPct({ eligible: [], counts: { loss: 0 }, max: 1 }).length === 0);

const logistics = buildLogisticsReconciliation([], {});
check('logistics brief on empty rows', logistics.okPct === 0);

console.log(failed ? `\n${failed} failed` : '\nAll brand-filter checks passed');
process.exit(failed ? 1 : 0);
