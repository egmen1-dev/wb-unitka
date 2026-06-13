import { MARGIN_LOW_THRESHOLD } from './format.js';
import {
  DEFAULT_SCHEME,
  primaryCommissionRub,
  primaryLogistics,
  primaryMargin,
  primaryProfit,
  resolveScheme,
} from '@lib/unit-scheme.js';

export const MARGIN_BUCKETS = [
  { id: 'loss', label: 'Убыточные', hint: 'маржа < 0', min: -Infinity, max: 0, color: '#be123c' },
  {
    id: 'critical',
    label: 'Критично',
    hint: '0–5%',
    min: 0,
    max: MARGIN_LOW_THRESHOLD,
    color: '#f43f5e',
  },
  { id: 'low', label: 'Низкая', hint: '5–15%', min: MARGIN_LOW_THRESHOLD, max: 0.15, color: '#fb923c' },
  { id: 'mid', label: 'Норма', hint: '15–30%', min: 0.15, max: 0.3, color: '#34d399' },
  { id: 'high', label: 'Хорошая', hint: '> 30%', min: 0.3, max: Infinity, color: '#059669' },
];

export function isRowWithMarginData(row, scheme = DEFAULT_SCHEME) {
  return row.salePrice > 0 && row.purchasePrice > 0 && primaryMargin(row, scheme) != null;
}

export function marginBucketFor(row, scheme = DEFAULT_SCHEME) {
  const margin = primaryMargin(row, scheme);
  if (margin == null) return null;
  return MARGIN_BUCKETS.find((b) => margin >= b.min && margin < b.max) || null;
}

export function rowMatchesMarginFilter(row, filterId, scheme = DEFAULT_SCHEME) {
  if (!filterId) return true;
  if (filterId === 'attention') {
    return isRowWithMarginData(row, scheme) && primaryMargin(row, scheme) < MARGIN_LOW_THRESHOLD;
  }
  const bucket = marginBucketFor(row, scheme);
  return bucket?.id === filterId;
}

export function buildMarginBucketStats(rows, scheme = DEFAULT_SCHEME) {
  const eligible = rows.filter((row) => isRowWithMarginData(row, scheme));
  const counts = Object.fromEntries(MARGIN_BUCKETS.map((b) => [b.id, 0]));

  for (const row of eligible) {
    const bucket = marginBucketFor(row, scheme);
    if (bucket) counts[bucket.id] += 1;
  }

  const max = Math.max(1, ...Object.values(counts));
  return { eligible, counts, max };
}

export function diagnoseRow(row, settings = {}) {
  const scheme = resolveScheme(settings);
  const tips = [];
  const sale = row.salePrice || 0;
  const margin = primaryMargin(row, scheme);
  const profit = primaryProfit(row, scheme);
  const logistics = primaryLogistics(row, scheme);
  const commission = primaryCommissionRub(row, scheme);

  if (!row.purchasePrice) {
    tips.push('Указать закупку');
  } else if (sale > 0 && row.purchasePrice / sale > 0.55) {
    tips.push('Снизить закупку или поднять цену');
  }

  if (sale > 0 && logistics / sale > 0.22) tips.push(`Дорогая логистика ${scheme.toUpperCase()}`);
  if (sale > 0 && commission / sale > 0.28) tips.push('Высокая комиссия');
  if (row.advertisingRub > 0 && profit < row.advertisingRub) tips.push('Реклама съедает прибыль');
  if (margin != null && margin < 0) tips.push('Убыточная позиция');
  else if (margin != null && margin < MARGIN_LOW_THRESHOLD) tips.push('Маржа ниже 5%');

  return tips.slice(0, 2).join(' · ') || 'Проверить цену и расходы';
}

export function topRiskRows(rows, limit = 8, scheme = DEFAULT_SCHEME) {
  return rows
    .filter((row) => isRowWithMarginData(row, scheme))
    .filter((row) => primaryMargin(row, scheme) < MARGIN_LOW_THRESHOLD)
    .sort(
      (a, b) =>
        primaryMargin(a, scheme) - primaryMargin(b, scheme) ||
        primaryProfit(a, scheme) - primaryProfit(b, scheme)
    )
    .slice(0, limit);
}
