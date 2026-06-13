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

export function articlesMatchByDigits(a, b) {
  const left = articleDigitKey(a);
  const right = articleDigitKey(b);
  return Boolean(left && right && left === right);
}
