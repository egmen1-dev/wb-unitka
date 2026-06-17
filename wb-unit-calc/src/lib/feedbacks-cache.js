const COUNT_TTL_MS = 60_000;
const SCOPE_TTL_MS = 90_000;
const SCOPE_LIST_GUARD_MS = 2_000;

let countCache = null;
let scopeCheckCache = null;
let scopeCheckAt = 0;

export function getCachedUnansweredCount() {
  if (!countCache) return null;
  if (Date.now() - countCache.at > COUNT_TTL_MS) return null;
  return countCache.value;
}

export function setCachedUnansweredCount(value) {
  countCache = { value: Number(value) || 0, at: Date.now() };
}

export function getCachedScopeCheck() {
  if (!scopeCheckCache) return null;
  if (Date.now() - scopeCheckCache.at > SCOPE_TTL_MS) return null;
  return scopeCheckCache.value;
}

export function setCachedScopeCheck(result) {
  scopeCheckCache = { value: result, at: Date.now() };
  scopeCheckAt = Date.now();
}

export function markScopeCheckStarted() {
  scopeCheckAt = Date.now();
}

export function shouldDeferListAfterScopeCheck() {
  return Date.now() - scopeCheckAt < SCOPE_LIST_GUARD_MS;
}
