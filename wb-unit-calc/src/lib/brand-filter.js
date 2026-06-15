export function normalizeBrandName(brand) {
  const name = String(brand ?? '').trim();
  return name || '—';
}

export function collectBrandOptions(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const name = normalizeBrandName(row.brand);
    map.set(name, (map.get(name) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
    .map(([name, count]) => ({ name, count }));
}

export function rowMatchesBrandFilter(row, selectedBrands) {
  if (!selectedBrands?.length) return true;
  return selectedBrands.includes(normalizeBrandName(row.brand));
}

export function filterRowsByBrand(rows, selectedBrands) {
  if (!selectedBrands?.length) return rows || [];
  return (rows || []).filter((row) => rowMatchesBrandFilter(row, selectedBrands));
}
