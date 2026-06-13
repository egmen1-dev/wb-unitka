import { withWbApiToken } from './wb-official-api.js';
import { buildAnalyticsPeriods } from './wb-analytics-period.js';

const ANALYTICS_API = 'https://seller-analytics-api.wildberries.ru';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Заказы за N дней по nmId — воронка продаж v3 (Analytics). */
export async function fetchNmOrders7d(token, { days = 7, maxPages = 15 } = {}) {
  return withWbApiToken(token, async () => {
    const { selectedPeriod, pastPeriod } = buildAnalyticsPeriods(days);
    const byNmId = new Map();
    const limit = 1000;
    let lastError = null;

    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * limit;
      let data;

      try {
        const response = await fetch(`${ANALYTICS_API}/api/analytics/v3/sales-funnel/products`, {
          method: 'POST',
          headers: {
            Authorization: (token || '').trim(),
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
            skipDeletedNm: false,
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
        lastError = err.message || 'Не удалось загрузить заказы';
        if (page === 0) throw err;
        break;
      }

      const products = data?.data?.products || [];
      if (!products.length) break;

      for (const item of products) {
        const nmId = Number(item.product?.nmId || item.product?.nmID);
        if (!nmId) continue;
        const orders = Number(item.statistic?.selected?.orderCount ?? 0);
        byNmId.set(nmId, orders);
      }

      if (products.length < limit) break;
      await sleep(650);
    }

    let totalOrders = 0;
    for (const count of byNmId.values()) totalOrders += count;

    return {
      byNmId,
      period: selectedPeriod,
      days,
      totalOrders,
      withOrders: [...byNmId.values()].filter((n) => n > 0).length,
      error: lastError,
    };
  });
}
