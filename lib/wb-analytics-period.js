/** Локальная дата YYYY-MM-DD (без сдвига UTC). */
export function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  next.setHours(12, 0, 0, 0);
  return next;
}

/** Периоды для Analytics v3: past строго ДО selected, без пересечения. */
export function buildAnalyticsPeriods(days, endDate = new Date()) {
  const end = addDays(endDate, 0);
  const selectedStart = addDays(end, -(days - 1));
  const pastEnd = addDays(selectedStart, -1);
  const pastStart = addDays(pastEnd, -(days - 1));

  return {
    selectedPeriod: {
      start: formatLocalDate(selectedStart),
      end: formatLocalDate(end),
    },
    pastPeriod: {
      start: formatLocalDate(pastStart),
      end: formatLocalDate(pastEnd),
    },
  };
}
