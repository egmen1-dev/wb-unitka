/**
 * Комиссия FBS как в калькуляторе прибыли WB (слайдер «комиссия за доставку»).
 *
 * Портал показывает ОДИН итоговый % — он растёт с каждым часом доставки.
 * Скрины 30 ч → 35.50% и 72 ч → 39.70% — это только концы шкалы (min/max),
 * не дискретные «корзины» 30/48/72.
 *
 * Формула (линейная по часу H):
 *   rate(H) = rate30 + (rate72 − rate30) × (clamp(H, 30, 72) − 30) / (72 − 30)
 *
 * Из скринов: rate72 − rate30 = 4.2 п.п. ⇒ +0.1 п.п. за каждый час выше 30.
 * rate30 ≈ kgvpMarketplace из /api/v1/tariffs/commission (FBS, не kgvpSupplier/DBS).
 *
 * Нельзя: «кат. 35% + 11.1 п.п. при 48 ч» → ~46% (двойной учёт / устаревшая надбавка).
 */

export const FBS_COMMISSION_HOURS_MIN = 30;
export const FBS_COMMISSION_HOURS_MAX = 72;
/** (39.70 − 35.50) / (72 − 30) = 0.1 п.п. за час. */
export const FBS_COMMISSION_SPAN_PP = 0.042;
export const FBS_COMMISSION_PREMIUM_PER_HOUR =
  FBS_COMMISSION_SPAN_PP / (FBS_COMMISSION_HOURS_MAX - FBS_COMMISSION_HOURS_MIN);

/**
 * Часы для шкалы комиссии: целые часы, clamp в [30, 72].
 * (≤30 → как 30; ≥72 → как 72; 48 → ровно 48, не «ближайшая корзина».)
 */
export function clampFbsCommissionHours(avgDeliveryHours) {
  const hours = Number(avgDeliveryHours);
  if (!Number.isFinite(hours)) return FBS_COMMISSION_HOURS_MIN;
  const whole = Math.floor(hours);
  if (whole <= FBS_COMMISSION_HOURS_MIN) return FBS_COMMISSION_HOURS_MIN;
  if (whole >= FBS_COMMISSION_HOURS_MAX) return FBS_COMMISSION_HOURS_MAX;
  return whole;
}

/**
 * Премия к rate30 за час H (доля 0..1).
 * H=30 → 0; H=48 → 1.8 п.п.; H=72 → 4.2 п.п.
 */
export function calcFbsDeliveryHoursPremium(avgDeliveryHours) {
  const h = clampFbsCommissionHours(avgDeliveryHours);
  return (
    ((h - FBS_COMMISSION_HOURS_MIN) / (FBS_COMMISSION_HOURS_MAX - FBS_COMMISSION_HOURS_MIN)) *
    FBS_COMMISSION_SPAN_PP
  );
}

/** @deprecated алиас — старые тесты/импорты. */
export function calcFbsAvgDeliverySurcharge(avgDeliveryHours) {
  return calcFbsDeliveryHoursPremium(avgDeliveryHours);
}

/**
 * Итоговая ставка при часах H: rate30 + премия(H).
 * rate72 = rate30 + 4.2 п.п.
 */
export function calcFbsRateForHours(rateAt30h, avgDeliveryHours) {
  return Number(rateAt30h) + calcFbsDeliveryHoursPremium(avgDeliveryHours);
}

/** Fallback без API: FBO + 3,5% = rate30, далее по часу. */
export function calcFbsCategoryRate(fboCategoryRate, avgDeliveryHours, fbsCommissionMarkup = 0.035) {
  const rate30 = Number(fboCategoryRate) + Number(fbsCommissionMarkup);
  return calcFbsRateForHours(rate30, avgDeliveryHours);
}

/**
 * Итоговая комиссия FBS (доля 0..1).
 * fbsCategoryRate из синка = kgvpMarketplace (ставка на 30 ч).
 */
export function resolveFbsCategoryRate({
  fbsCategoryRate,
  fboCategoryRate,
  avgDeliveryHours,
  fbsCommissionMarkup = 0.035,
}) {
  const hasApiRate = fbsCategoryRate != null && fbsCategoryRate !== '';
  const rate30 = hasApiRate
    ? Number(fbsCategoryRate)
    : Number(fboCategoryRate) + Number(fbsCommissionMarkup);
  const deliverySurcharge = calcFbsDeliveryHoursPremium(avgDeliveryHours);
  return {
    fbsCategoryRate: rate30 + deliverySurcharge,
    fbsDeliverySurcharge: deliverySurcharge,
    fbsCategoryBaseRate: rate30,
    fbsCategorySource: hasApiRate ? 'api' : 'fallback',
  };
}
