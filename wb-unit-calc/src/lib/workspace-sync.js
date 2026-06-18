/** Сравнение updatedAt облака (ISO / Postgres) без ложных расхождений. */
export function workspaceTimestampsEqual(a, b) {
  if (a == null || b == null || a === '' || b === '') return a === b;
  const msA = new Date(a).getTime();
  const msB = new Date(b).getTime();
  if (Number.isFinite(msA) && Number.isFinite(msB)) {
    return Math.abs(msA - msB) < 2000;
  }
  return String(a) === String(b);
}

export function formatWorkspaceUpdatedAt(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : String(value);
}
