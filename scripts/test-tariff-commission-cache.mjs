/**
 * Tariff cache helpers for commission refresh.
 * Run: node scripts/test-tariff-commission-cache.mjs
 */
import {
  WB_COMMISSION_CACHE_TTL_MS,
  WB_TARIFF_CACHE_TTL_MS,
  isCommissionCacheFresh,
  isTariffCacheFresh,
  serializeTariffCache,
  hydrateTariffCache,
} from '../lib/wb-tariff-cache.js';
import { resolveFbsCategoryRate, calcFbsAvgDeliverySurcharge } from '../lib/unit-economics/fbs-commission.js';

let failed = 0;
function check(label, ok) {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}

check('commission TTL shorter than box TTL', WB_COMMISSION_CACHE_TTL_MS < WB_TARIFF_CACHE_TTL_MS);
check('commission TTL is 30 min', WB_COMMISSION_CACHE_TTL_MS === 30 * 60 * 1000);

const fresh = { cachedAt: new Date().toISOString(), commissionEntries: [], boxByNameEntries: [] };
check('fresh cache is fresh', isTariffCacheFresh(fresh) && isCommissionCacheFresh(fresh));

const old = {
  cachedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  commissionEntries: [[1, { fboCategory: 0.2, fbsCategory: 0.25 }]],
  boxByNameEntries: [],
};
check('2h cache: box still fresh, commissions stale', isTariffCacheFresh(old) && !isCommissionCacheFresh(old));

const commissions = new Map([[42, { fboCategory: 0.203, fbsCategory: 0.238 }]]);
const box = {
  defaultTariff: { warehouseName: 'Коледино', warehouseCoeff: 1 },
  byName: new Map(),
  warehouses: [],
  logisticsFirstLiter: 46,
  logisticsAdditionalLiter: 14,
};
const serialized = serializeTariffCache(commissions, box);
const hydrated = hydrateTariffCache(serialized);
check('hydrate restores commission entry', hydrated?.commissionsBySubject.get(42)?.fbsCategory === 0.238);

const surcharge48 = calcFbsAvgDeliverySurcharge(48);
check('48h delivery surcharge ≈ 11.1 п.п.', Math.abs(surcharge48 - 0.111) < 0.0005);

const fbs = resolveFbsCategoryRate({
  fbsCategoryRate: 0.238,
  fboCategoryRate: 0.203,
  avgDeliveryHours: 48,
});
check(
  'FBS = kgvpSupplier + 48h surcharge (не +3.5%)',
  fbs.fbsCategorySource === 'api' && Math.abs(fbs.fbsCategoryRate - (0.238 + surcharge48)) < 1e-9
);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nOK');
