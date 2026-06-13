const BRAND_ALIASES = {
  райзз: 'raizz',
  raizz: 'raizz',
};

const CANONICAL_BRAND_NAMES = {
  raizz: 'Райзз',
};

export function canonicalBrandKey(brand = '') {
  const normalized = brand.trim().toLowerCase();
  return BRAND_ALIASES[normalized] || normalized;
}

export function normalizeBrandName(brand = '') {
  const trimmed = brand.trim();
  if (!trimmed) return '';

  const key = canonicalBrandKey(trimmed);
  return CANONICAL_BRAND_NAMES[key] || trimmed;
}

export function brandsMatch(brandA, brandB) {
  if (!brandA || !brandB) return false;
  return canonicalBrandKey(brandA) === canonicalBrandKey(brandB);
}

export function buildBrandIndex(products = []) {
  const map = new Map();

  for (const product of products) {
    const rawName = product.brand?.trim();
    if (!rawName) continue;

    const key = canonicalBrandKey(rawName);
    if (!map.has(key)) {
      const name = normalizeBrandName(rawName);
      map.set(key, {
        name,
        slug: name,
        brandId: product.brandId || null,
        count: 0,
        categories: {},
      });
    }

    const brand = map.get(key);
    brand.count += 1;
    brand.categories[product.category] = (brand.categories[product.category] || 0) + 1;

    if (!brand.brandId && product.brandId) {
      brand.brandId = product.brandId;
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru')
  );
}
