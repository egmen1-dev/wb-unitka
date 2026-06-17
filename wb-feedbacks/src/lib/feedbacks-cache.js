const COUNT_TTL_MS = 5 * 60_000;
const SCOPE_TTL_MS = 90_000;

let countCache = null;
let scopeCheckCache = null;
let rateLimitUntil = 0;

/** Drop expired or corrupt rate-limit locks on boot / refresh. */
export function clearStaleFeedbacksCacheOnBoot() {
  if (rateLimitUntil > 0 && Date.now() >= rateLimitUntil) {
    rateLimitUntil = 0;
  }
  if (rateLimitUntil > Date.now() + 120_000) {
    rateLimitUntil = 0;
  }
}

export function getCachedUnansweredCount() {
  if (!countCache) return null;
  if (Date.now() - countCache.at > COUNT_TTL_MS) return null;
  return countCache.value;
}

export function setCachedUnansweredCount(value) {
  countCache = { value: Number(value) || 0, at: Date.now() };
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
