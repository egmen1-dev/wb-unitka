export function fmtMoney(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value);
}

export function fmtPct(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export function fmtNum(value, digits = 0) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export const MARGIN_LOW_THRESHOLD = 0.05;

export function profitClass(value) {
  if (value == null) return 'text-slate-400';
  if (value > 0) return 'text-emerald-700 font-medium';
  if (value < 0) return 'text-rose-700 font-medium';
  return 'text-slate-600';
}

/** Маржа < 5% — красная подсветка ячейки в таблице. */
export function marginClass(value) {
  if (value == null || Number.isNaN(value)) return 'text-slate-400';
  if (value < MARGIN_LOW_THRESHOLD) {
    return 'bg-rose-50 text-rose-800 font-semibold ring-1 ring-inset ring-rose-200';
  }
  if (value >= 0.15) return 'text-emerald-700 font-medium';
  return 'text-slate-700';
}