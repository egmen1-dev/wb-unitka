/** Сопоставление артикула WB с ключами в seed-таблицах (102065 ↔ 102065.0). */
export function vendorLookupKeys(vendorCode) {
  const key = String(vendorCode || '').trim();
  if (!key) return [];

  const keys = [key];
  if (!key.includes('.')) keys.push(`${key}.0`);
  if (/\.0$/.test(key)) keys.push(key.replace(/\.0$/, ''));

  return [...new Set(keys)];
}

export function lookupSeedRecord(map, vendorCode) {
  if (!map || typeof map !== 'object') return null;
  for (const key of vendorLookupKeys(vendorCode)) {
    if (map[key] != null) return map[key];
  }
  return null;
}
