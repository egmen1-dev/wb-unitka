/** Диапазоны: фиксированный тариф ₽ за товар до 1 л (не ₽/л × объём). */
export const SUB_LITER_TIERS = [
  { max: 0.2, rate: 23 },
  { max: 0.4, rate: 26 },
  { max: 0.6, rate: 29 },
  { max: 0.8, rate: 30 },
  { max: 1.0, rate: 32 },
];

/** Литраж для отображения (минимум 1 л) — только для товаров > 1 л. */
export function billingLiters(volumeLiters) {
  if (volumeLiters == null || volumeLiters <= 0) return null;
  if (volumeLiters <= 1) return volumeLiters;
  return Math.ceil(volumeLiters - 1e-9);
}

/** Фиксированный тариф по диапазону объёма (≤ 1 л). Например 0,13 л → 23₽, не 0,13×23. */
export function subLiterTierFlatRub(volumeLiters) {
  if (volumeLiters == null || volumeLiters <= 0) return null;
  for (const tier of SUB_LITER_TIERS) {
    if (volumeLiters <= tier.max + 1e-9) return tier.rate;
  }
  return null;
}

/** ₽/л для обратной логистики ≤ 1 л (объём × ставка). */
export function subLiterTariffPerLiter(volumeLiters) {
  return subLiterTierFlatRub(volumeLiters);
}

/** @deprecated Используйте subLiterTierFlatRub */
export function subLiterTariffRub(volumeLiters) {
  return subLiterTierFlatRub(volumeLiters);
}

export function isOverOneLiter(volumeLiters) {
  return volumeLiters != null && volumeLiters > 1;
}

/**
 * Доставка до покупателя:
 * > 1 л: (46 + 14 × (V − 1)) × коэфф. склада
 * ≤ 1 л: фикс. тариф диапазона × коэфф. склада (23–32₽, не × объём)
 */
export function calcWbForwardDelivery(volumeLiters, firstLiter, extraLiter, coeff = 1) {
  if (volumeLiters == null || volumeLiters <= 0) return null;

  const k = Number(coeff) || 1;

  if (isOverOneLiter(volumeLiters)) {
    const first = Number(firstLiter) || 0;
    const extra = Number(extraLiter) || 0;
    return (first + (volumeLiters - 1) * extra) * k;
  }

  const flat = subLiterTierFlatRub(volumeLiters);
  if (flat == null) return null;
  return flat * k;
}

/**
 * Обратная логистика (без коэфф. склада):
 * > 1 л: 46 + 14 × (V − 1)
 * ≤ 1 л: объём × тариф ₽/л диапазона
 */
export function calcWbReturnDelivery(volumeLiters, firstLiter, extraLiter) {
  if (volumeLiters == null || volumeLiters <= 0) return null;

  if (isOverOneLiter(volumeLiters)) {
    const first = Number(firstLiter) || 0;
    const extra = Number(extraLiter) || 0;
    return first + (volumeLiters - 1) * extra;
  }

  const rate = subLiterTariffPerLiter(volumeLiters);
  if (rate == null) return null;
  return volumeLiters * rate;
}

/** @deprecated Используйте calcWbForwardDelivery */
export function calcWbBaseDelivery(volumeLiters, firstLiter, extraLiter, coeff = 1) {
  return calcWbForwardDelivery(volumeLiters, firstLiter, extraLiter, coeff);
}

/**
 * Логистика на 1 проданную единицу.
 * С % выкупа — как в отчёте: (прямая + обратная × невыкуп) / выкуп.
 */
export function calcWbLogisticsPerUnit({
  forwardDelivery,
  returnDelivery,
  baseDelivery,
  buyoutRate = 0.9,
  returnMarkup = 0.0454,
  useBuyoutWeighted = false,
}) {
  const forward = forwardDelivery ?? baseDelivery;
  if (forward == null) return null;

  const ret = returnDelivery ?? forward;

  if (!useBuyoutWeighted) {
    return forward * (1 + returnMarkup);
  }

  return calcWbLogisticsReportAligned({
    forwardDelivery: forward,
    returnDelivery: ret,
    buyoutRate,
    returnMarkup,
  });
}

/** Как в отчёте реализации: (прямая + обратная × доля невыкупа) / % выкупа. */
export function calcWbLogisticsReportAligned({
  forwardDelivery,
  returnDelivery,
  buyoutRate = 0.9,
  returnMarkup = 0.0454,
}) {
  const forward = forwardDelivery;
  if (forward == null) return null;

  const ret = returnDelivery ?? forward;
  const buyout = Math.min(0.99, Math.max(0.01, buyoutRate));
  const returnLeg = ret * (1 - buyout) * (1 + returnMarkup);
  return (forward + returnLeg) / buyout;
}
