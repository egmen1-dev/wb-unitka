const STORAGE_KEY = 'wb-feedbacks:reviews-cache';
const COUNT_TTL_MS = 5 * 60_000;
const REVIEWS_TTL_MS = 10 * 60_000;
const SCOPE_TTL_MS = 90_000;

let countCache = null;
let scopeCheckCache = null;
let rateLimitUntil = 0;

function tokenFingerprint(token) {
  const s = String(token || '').trim();
  if (!s) return '';
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

function readStorageEntry() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Drop expired or corrupt rate-limit locks and stale localStorage on boot / refresh. */
export function clearStaleFeedbacksCacheOnBoot() {
  clearFeedbacksRateLimit();

  const entry = readStorageEntry();
  if (!entry) return;
  if (!entry.tokenHash || Date.now() - entry.fetchedAt > REVIEWS_TTL_MS) {
    clearFeedbacksListCache();
  }
}

export function getCachedUnansweredCount() {
  if (countCache) {
    if (Date.now() - countCache.at <= COUNT_TTL_MS) return countCache.value;
    countCache = null;
  }

  const entry = readStorageEntry();
  if (!entry || Date.now() - entry.fetchedAt > REVIEWS_TTL_MS) return null;
  return entry.countUnanswered ?? entry.feedbacks?.length ?? null;
}

export function setCachedUnansweredCount(value) {
  countCache = { value: Number(value) || 0, at: Date.now() };
}

export function getCachedFeedbacksList(token) {
  const fp = tokenFingerprint(token);
  if (!fp) return null;

  const entry = readStorageEntry();
  if (!entry || entry.tokenHash !== fp) return null;
  if (Date.now() - entry.fetchedAt > REVIEWS_TTL_MS) return null;
  return entry;
}

/** Last saved list for token — ignores TTL (429 / failed refresh fallback). */
export function getStaleCachedFeedbacksList(token) {
  const fp = tokenFingerprint(token);
  if (!fp) return null;

  const entry = readStorageEntry();
  if (!entry || entry.tokenHash !== fp) return null;
  if (!Array.isArray(entry.feedbacks) || entry.feedbacks.length === 0) return null;
  return entry;
}

export function setCachedFeedbacksList(token, { feedbacks, countUnanswered, hasMore }) {
  const fp = tokenFingerprint(token);
  if (!fp) return;

  const count = countUnanswered ?? feedbacks?.length ?? 0;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tokenHash: fp,
        feedbacks: feedbacks || [],
        countUnanswered: count,
        hasMore: Boolean(hasMore),
        fetchedAt: Date.now(),
      })
    );
  } catch {
    // private mode / quota
  }
  setCachedUnansweredCount(count);
}

export function clearFeedbacksListCache() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // private mode
  }
  countCache = null;
}

export function getFeedbacksCacheAgeMinutes(entry) {
  if (!entry?.fetchedAt) return null;
  return Math.floor((Date.now() - entry.fetchedAt) / 60_000);
}

export function formatCacheBadge(entry, { short = false } = {}) {
  if (short) return 'из кэша';
  const mins = getFeedbacksCacheAgeMinutes(entry);
  if (mins == null) return 'из кэша';
  if (mins < 1) return 'из кэша, обновлено менее минуты назад';
  return `из кэша, обновлено ${mins} мин назад`;
}

export function isFeedbacksRateLimited() {
  if (rateLimitUntil > 0 && Date.now() >= rateLimitUntil) {
    rateLimitUntil = 0;
    return false;
  }
  return rateLimitUntil > 0 && Date.now() < rateLimitUntil;
}

export function getFeedbacksRateLimitSecondsLeft() {
  const left = Math.ceil((rateLimitUntil - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

export function setFeedbacksRateLimited(retryAfterSec = 5) {
  const sec = Math.min(60, Math.max(1, Number(retryAfterSec) || 5));
  rateLimitUntil = Date.now() + sec * 1000;
}

export function clearFeedbacksRateLimit() {
  rateLimitUntil = 0;
}

export function getCachedScopeCheck() {
  if (!scopeCheckCache) return null;
  if (Date.now() - scopeCheckCache.at > SCOPE_TTL_MS) return null;
  return scopeCheckCache.value;
}

export function setCachedScopeCheck(result) {
  scopeCheckCache = { value: result, at: Date.now() };
}

export { REVIEWS_TTL_MS };
