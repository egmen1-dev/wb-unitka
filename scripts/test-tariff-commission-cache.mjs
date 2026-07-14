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
import {
  resolveFbsCategoryRate,
  calcFbsDeliveryHoursPremium,
  calcFbsRateForHours,
  FBS_COMMISSION_SPAN_PP,
} from '../lib/unit-economics/fbs-commission.js';

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

const commissions = new Map([[42, { fboCategory: 0.32, fbsCategory: 0.355 }]]);
const box = {
  defaultTariff: { warehouseName: 'Коледино', warehouseCoeff: 1 },
  byName: new Map(),
  warehouses: [],
  logisticsFirstLiter: 46,
  logisticsAdditionalLiter: 14,
};
const serialized = serializeTariffCache(commissions, box);
const hydrated = hydrateTariffCache(serialized);
check('hydrate restores commission entry', hydrated?.commissionsBySubject.get(42)?.fbsCategory === 0.355);

check('span 30→72 = 4.2 п.п.', Math.abs(FBS_COMMISSION_SPAN_PP - 0.042) < 1e-9);
check('30ч premium = 0', Math.abs(calcFbsDeliveryHoursPremium(30)) < 1e-12);
check('48ч premium = 1.8 п.п.', Math.abs(calcFbsDeliveryHoursPremium(48) - 0.018) < 1e-9);
check('72ч premium = 4.2 п.п.', Math.abs(calcFbsDeliveryHoursPremium(72) - 0.042) < 1e-9);
check('47ч ≠ 48ч (почасовой, не корзина)', calcFbsDeliveryHoursPremium(47) < calcFbsDeliveryHoursPremium(48));
check(
  '35.5%@30ч → 39.7%@72ч',
  Math.abs(calcFbsRateForHours(0.355, 30) - 0.355) < 1e-9 &&
    Math.abs(calcFbsRateForHours(0.355, 72) - 0.397) < 1e-9
);

const fbs = resolveFbsCategoryRate({
  fbsCategoryRate: 0.355,
  fboCategoryRate: 0.32,
  avgDeliveryHours: 48,
});
check(
  'FBS = kgvpMarketplace(30ч) + lerp по часу (не +11.1)',
  fbs.fbsCategorySource === 'api' &&
    Math.abs(fbs.fbsCategoryBaseRate - 0.355) < 1e-9 &&
    Math.abs(fbs.fbsCategoryRate - 0.373) < 1e-9
);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nOK');
