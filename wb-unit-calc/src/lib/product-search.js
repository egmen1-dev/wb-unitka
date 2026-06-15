function normalizeSearchText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function compactAlnum(value) {
  return normalizeSearchText(value).replace(/[^a-z0-9]/g, '');
}

function vendorVariants(vendorCode) {
  const raw = String(vendorCode ?? '').trim();
  if (!raw) return [];
  const base = raw.replace(/\.0$/, '');
  return [...new Set([raw, base, `${base}.0`].map(normalizeSearchText).filter(Boolean))];
}

function matchesVendorCode(query, vendorCode) {
  const needle = normalizeSearchText(query);
  const vendor = normalizeSearchText(vendorCode);
  if (!needle || !vendor) return false;

  if (vendor === needle || vendor.includes(needle)) return true;

  const variants = vendorVariants(vendorCode);
  if (variants.some((variant) => variant === needle || variant.includes(needle))) return true;

  const needleCompact = compactAlnum(query);
  const vendorCompact = compactAlnum(vendorCode);
  if (needleCompact.length >= 3 && vendorCompact) {
    if (vendorCompact === needleCompact) return true;
    if (vendorCompact.startsWith(needleCompact)) return true;
  }

  return false;
}

export function rowMatchesProductSearch(row, query) {
  const needle = normalizeSearchText(query);
  if (!needle) return true;

  if (matchesVendorCode(query, row.vendorCode)) return true;

  const nm = String(row.nmId ?? '');
  const digitsOnly = needle.replace(/\s/g, '');
  if (/^\d{3,}$/.test(digitsOnly) && nm.includes(digitsOnly)) return true;

  const title = normalizeSearchText(row.title);
  const brand = normalizeSearchText(row.brand);
  const subject = normalizeSearchText(row.subjectName);

  if (title.includes(needle) || brand.includes(needle) || subject.includes(needle)) return true;

  for (const sku of row.skus || []) {
    if (normalizeSearchText(sku).includes(needle)) return true;
  }

  return false;
}
