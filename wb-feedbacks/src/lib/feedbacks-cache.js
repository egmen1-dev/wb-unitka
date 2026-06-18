const STORAGE_KEY = 'wb-feedbacks:reviews-cache';
const SCOPE_CHECK_STORAGE_KEY = 'wb-feedbacks:scope-check';
const COUNT_TTL_MS = 5 * 60_000;
const REVIEWS_TTL_MS = 10 * 60_000;

let countCache = null;
let readRateLimitUntil = 0;
let writeRateLimitUntil = 0;

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

function clearRateLimitSlot(slot) {
  if (slot === 'read') readRateLimitUntil = 0;
  else if (slot === 'write') writeRateLimitUntil = 0;
  else {
    readRateLimitUntil = 0;
    writeRateLimitUntil = 0;
  }
}

function isSlotRateLimited(until) {
  if (until > 0 && Date.now() >= until) return false;
  return until > 0 && Date.now() < until;
}

function secondsLeft(until) {
  const left = Math.ceil((until - Date.now()) / 1000);
  return left > 0 ? left : 0;
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

export function isFeedbacksReadRateLimited() {
  if (readRateLimitUntil > 0 && Date.now() >= readRateLimitUntil) {
    readRateLimitUntil = 0;
    return false;
  }
  return isSlotRateLimited(readRateLimitUntil);
}

export function isFeedbacksWriteRateLimited() {
  if (writeRateLimitUntil > 0 && Date.now() >= writeRateLimitUntil) {
    writeRateLimitUntil = 0;
    return false;
  }
  return isSlotRateLimited(writeRateLimitUntil);
}

/** Either read or write slot is cooling down (for UI countdown). */
export function isFeedbacksRateLimited() {
  return isFeedbacksReadRateLimited() || isFeedbacksWriteRateLimited();
}

export function getFeedbacksReadRateLimitSecondsLeft() {
  return secondsLeft(readRateLimitUntil);
}

export function getFeedbacksWriteRateLimitSecondsLeft() {
  return secondsLeft(writeRateLimitUntil);
}

export function getFeedbacksRateLimitSecondsLeft() {
  return Math.max(
    getFeedbacksReadRateLimitSecondsLeft(),
    getFeedbacksWriteRateLimitSecondsLeft()
  );
}

export function setFeedbacksReadRateLimited(retryAfterSec = 5) {
  const sec = Math.min(60, Math.max(1, Number(retryAfterSec) || 5));
  readRateLimitUntil = Date.now() + sec * 1000;
}

export function setFeedbacksWriteRateLimited(retryAfterSec = 5) {
  const sec = Math.min(60, Math.max(1, Number(retryAfterSec) || 5));
  writeRateLimitUntil = Date.now() + sec * 1000;
}

/** @param {'read'|'write'} [kind='read'] */
export function setFeedbacksRateLimited(retryAfterSec = 5, { kind = 'read' } = {}) {
  if (kind === 'write') setFeedbacksWriteRateLimited(retryAfterSec);
  else setFeedbacksReadRateLimited(retryAfterSec);
}

/** @param {'read'|'write'} [kind] — omit to clear both slots */
export function clearFeedbacksRateLimit(kind) {
  clearRateLimitSlot(kind);
}

function readScopeCheckEntry() {
  try {
    const raw = localStorage.getItem(SCOPE_CHECK_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Cached scope check for token — no TTL, invalidated only when token changes. */
export function getCachedScopeCheck(token) {
  const fp = tokenFingerprint(token);
  if (!fp) return null;

  const entry = readScopeCheckEntry();
  if (!entry || entry.tokenHash !== fp || !entry.result) return null;
  return entry.result;
}

export function setCachedScopeCheck(token, result) {
  const fp = tokenFingerprint(token);
  if (!fp || !result) return;

  try {
    localStorage.setItem(
      SCOPE_CHECK_STORAGE_KEY,
      JSON.stringify({
        tokenHash: fp,
        result,
        checkedAt: Date.now(),
      })
    );
  } catch {
    // private mode / quota
  }
}

export { REVIEWS_TTL_MS };
