/** Нормализует артикул к строке только из цифр для сопоставления WB ↔ поставщик. */
export function articleDigitKey(article) {
  const raw = String(article ?? '').trim();
  if (!raw) return '';

  let normalized = raw;
  if (/^\d+\.0$/.test(normalized)) {
    normalized = normalized.slice(0, -2);
  }

  return normalized.replace(/\D/g, '');
}

/** Чисто числовой артикул WB (61768, 61768.0). Для ST-60W / POST-60W — false. */
export function isNumericVendorArticle(article) {
  const raw = String(article ?? '').trim();
  if (!raw) return false;

  const withoutZeroSuffix = /^\d+\.0$/.test(raw) ? raw.slice(0, -2) : raw;
  return /^\d+$/.test(withoutZeroSuffix);
}

/** Цифровой ключ для отчёта WB — только у числовых артикулов (не ST-60W → «60»). */
export function realizationDigitKey(article) {
  if (!isNumericVendorArticle(article)) return '';
  return articleDigitKey(article);
}

export function articlesMatchByDigits(a, b) {
  if (!isNumericVendorArticle(a) || !isNumericVendorArticle(b)) return false;
  const left = articleDigitKey(a);
  const right = articleDigitKey(b);
  return Boolean(left && right && left === right);
}
