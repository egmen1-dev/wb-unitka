import { withWbApiToken } from './wb-official-api.js';
import { buildAnalyticsPeriods } from './wb-analytics-period.js';

const ANALYTICS_API = 'https://seller-analytics-api.wildberries.ru';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** { days, hours, mins } → часы (дробные). */
export function timeToReadyToHours(timeToReady) {
  if (!timeToReady || typeof timeToReady !== 'object') return null;
  const days = Number(timeToReady.days) || 0;
  const hours = Number(timeToReady.hours) || 0;
  const mins = Number(timeToReady.mins) || 0;
  const total = days * 24 + hours + mins / 60;
  return total > 0 ? total : null;
}

/** Среднее время доставки покупателю по nmId из воронки продаж WB. */
export async function fetchNmDeliveryHours(token, { days = 30, maxPages = 20 } = {}) {
  return withWbApiToken(token, async () => {
    const { selectedPeriod, pastPeriod } = buildAnalyticsPeriods(days);
    const byNmId = new Map();
    const limit = 1000;

    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * limit;
      let data;
      try {
        const response = await fetch(`${ANALYTICS_API}/api/analytics/v3/sales-funnel/products`, {
          method: 'POST',
          headers: {
            Authorization: token.trim(),
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            selectedPeriod,
            pastPeriod,
            nmIds: [],
            brandNames: [],
            subjectIds: [],
            tagIds: [],
            skipDeletedNm: true,
            orderBy: { field: 'orderCount', mode: 'desc' },
            limit,
            offset,
          }),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`WB analytics ${response.status}: ${text.slice(0, 200)}`);
        }
        data = await response.json();
      } catch (err) {
        if (page === 0) throw err;
        break;
      }

      const products = data?.data?.products || [];
      if (!products.length) break;

      for (const item of products) {
        const nmId = Number(item.product?.nmId || item.product?.nmID);
        const hours = timeToReadyToHours(item.statistic?.selected?.timeToReady);
        if (nmId && hours != null) {
          byNmId.set(nmId, hours);
        }
      }

      if (products.length < limit) break;
      await sleep(650);
    }

    const values = [...byNmId.values()];
    const sellerAvg =
      values.length > 0 ? values.reduce((sum, h) => sum + h, 0) / values.length : null;

    return {
      byNmId,
      sellerAvgDeliveryHours: sellerAvg,
      period: selectedPeriod,
    };
  });
}
