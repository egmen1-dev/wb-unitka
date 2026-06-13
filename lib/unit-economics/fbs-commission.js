/**
 * Надбавка к комиссии FBS за среднее время доставки покупателю (часы от заказа).
 * Правила пользователя:
 * - 19–30 ч: +0,3 п.п. за каждый час
 * - 31–36 ч: +0,35 п.п. за каждый час
 * - 37+ ч: +0,45 п.п. за каждый час
 * (часы до 19 — без надбавки)
 */
export function calcFbsAvgDeliverySurcharge(avgDeliveryHours) {
  const hours = Number(avgDeliveryHours);
  if (!Number.isFinite(hours) || hours <= 18) return 0;

  const wholeHours = Math.floor(hours);
  let surcharge = 0;

  for (let hour = 19; hour <= wholeHours; hour += 1) {
    if (hour <= 30) surcharge += 0.003;
    else if (hour <= 36) surcharge += 0.0035;
    else surcharge += 0.0045;
  }

  return surcharge;
}

/** Комиссия FBS = FBO категория + 3,5% + надбавка за время доставки. */
export function calcFbsCategoryRate(fboCategoryRate, avgDeliveryHours, fbsCommissionMarkup = 0.035) {
  const base = Number(fboCategoryRate) + Number(fbsCommissionMarkup);
  return base + calcFbsAvgDeliverySurcharge(avgDeliveryHours);
}

/** Категорийная комиссия FBS: из API WB или fallback FBO+3,5%, плюс надбавка за время доставки. */
export function resolveFbsCategoryRate({
  fbsCategoryRate,
  fboCategoryRate,
  avgDeliveryHours,
  fbsCommissionMarkup = 0.035,
}) {
  const deliverySurcharge = calcFbsAvgDeliverySurcharge(avgDeliveryHours);
  const hasApiRate = fbsCategoryRate != null && fbsCategoryRate !== '';
  const minFbsBase = Number(fboCategoryRate) + Number(fbsCommissionMarkup);
  const apiBase = hasApiRate ? Number(fbsCategoryRate) : null;
  const base = hasApiRate ? Math.max(apiBase, minFbsBase) : minFbsBase;
  return {
    fbsCategoryRate: base + deliverySurcharge,
    fbsDeliverySurcharge: deliverySurcharge,
    fbsCategorySource: hasApiRate ? (apiBase >= minFbsBase ? 'api' : 'api_min_markup') : 'fallback',
  };
}
