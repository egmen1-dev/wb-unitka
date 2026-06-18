import { AUTO_REPLY_INTERVAL_MS, AUTO_REPLY_MAX_PER_HOUR, isDraftSafeForAutoSend } from '@lib/feedback-auto-reply.js';
import { DRAFT_FETCH_TIMEOUT_MS, fetchWithTimeout, readJsonResponse } from './http';
import {
  getFeedbacksReadRateLimitSecondsLeft,
  isFeedbacksReadRateLimited,
} from './feedbacks-cache';
import { fetchFeedbacksApi, isRateLimitError } from './wb-api-queue';

export { AUTO_REPLY_INTERVAL_MS, AUTO_REPLY_MAX_PER_HOUR, isDraftSafeForAutoSend };
const HOUR_MS = 3_600_000;
const LOG_MAX = 50;
const POST_REFRESH_DELAY_MS = 15_000;
const ERROR_RETRY_MS = 30_000;
const MIN_SCHEDULE_MS = 3_000;

const STORAGE_ENABLED = 'wb-feedbacks:auto-reply:enabled';
const STORAGE_LOG = 'wb-feedbacks:auto-reply:log';
const STORAGE_TIMESTAMPS = 'wb-feedbacks:auto-reply:timestamps';

const DEBUG = import.meta.env.DEV;

function log(...args) {
  if (DEBUG) console.log('[auto-reply]', ...args);
}

function logWarn(...args) {
  if (DEBUG) console.warn('[auto-reply]', ...args);
  else console.warn('[auto-reply]', ...args);
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode
  }
}

export function loadAutoReplyEnabled() {
  try {
    return localStorage.getItem(STORAGE_ENABLED) === '1';
  } catch {
    return false;
  }
}

export function saveAutoReplyEnabled(enabled) {
  try {
    if (enabled) localStorage.setItem(STORAGE_ENABLED, '1');
    else localStorage.removeItem(STORAGE_ENABLED);
  } catch {
    // private mode
  }
}

function getTimestamps() {
  return pruneTimestamps(readJson(STORAGE_TIMESTAMPS, []));
}

function setTimestamps(ts) {
  writeJson(STORAGE_TIMESTAMPS, pruneTimestamps(ts));
}

function pruneTimestamps(ts) {
  const hourAgo = Date.now() - HOUR_MS;
  return (Array.isArray(ts) ? ts : []).filter((t) => Number(t) > hourAgo);
}

export function getSentThisHour() {
  return getTimestamps().length;
}

export function getAutoReplyLog() {
  return readJson(STORAGE_LOG, []);
}

function appendLog(entry) {
  const logEntries = [entry, ...getAutoReplyLog()].slice(0, LOG_MAX);
  writeJson(STORAGE_LOG, logEntries);
  return logEntries;
}

function recordSentTimestamp() {
  const ts = [...getTimestamps(), Date.now()];
  setTimestamps(ts);
  return ts.length;
}

export function getMsUntilNextSlot() {
  const ts = getTimestamps();
  if (ts.length >= AUTO_REPLY_MAX_PER_HOUR) {
    const oldest = Math.min(...ts);
    return Math.max(0, oldest + HOUR_MS - Date.now());
  }
  const last = ts[ts.length - 1] || 0;
  if (!last) return 0;
  return Math.max(0, AUTO_REPLY_INTERVAL_MS - (Date.now() - last));
}

export function formatMinutes(ms) {
  const min = Math.ceil(ms / 60_000);
  return min <= 0 ? 0 : min;
}

function pickNextFeedback(feedbacks, skippedIds) {
  return (feedbacks || []).find((fb) => fb?.id && !fb.isAnswered && !skippedIds.has(fb.id));
}

async function requestDraft(token, feedback, { regenerate = false } = {}) {
  const variationSeed = Date.now() + Math.floor(Math.random() * 10_000);
  const response = await fetchWithTimeout(
    '/api/feedbacks/feedback-draft',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        feedback,
        catalogRows: [],
        regenerate,
        variationSeed,
        autoReply: true,
      }),
    },
    DRAFT_FETCH_TIMEOUT_MS
  );
  const { data: payload } = await readJsonResponse(response);
  if (!response.ok) {
    const err = new Error(payload?.error || 'Не удалось сгенерировать ответ');
    err.payload = payload;
    err.status = response.status;
    throw err;
  }
  return payload;
}

async function postAnswer(token, feedbackId, text) {
  const { response, payload } = await fetchFeedbacksApi(
    '/api/feedbacks/feedbacks',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: 'answer',
        feedbackId,
        text,
        skipVerify: true,
      }),
    },
    { kind: 'write', maxRetries: 5 }
  );
  if (!response.ok) {
    const err = new Error(payload?.error || 'Не удалось отправить ответ');
    err.status = response.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function fetchUnanswered(token, take = 20) {
  const { response, payload } = await fetchFeedbacksApi(
    '/api/feedbacks/feedbacks',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: 'list', take, skip: 0 }),
    },
    { kind: 'read' }
  );
  if (!response.ok) throw new Error(payload?.error || 'Не удалось загрузить отзывы');
  return {
    feedbacks: payload.feedbacks || [],
    countUnanswered: payload.countUnanswered ?? payload.feedbacks?.length ?? 0,
    hasMore: payload.hasMore ?? false,
  };
}

/**
 * @param {{
 *   token: string,
 *   getFeedbacks?: () => Array,
 *   onState?: (state: object) => void,
 *   onAfterSend?: (feedbackId: string) => void | Promise<void>,
 *   onFeedbacksLoaded?: (data: { feedbacks: Array, countUnanswered: number, hasMore: boolean }) => void,
 * }} options
 */
export function createAutoReplyScheduler({
  token,
  getFeedbacks,
  onState,
  onAfterSend,
  onFeedbacksLoaded,
}) {
  let enabled = false;
  let running = false;
  let posting = false;
  let timer = null;
  let stopped = false;
  const skippedIds = new Set();
  let lastPhase = 'idle';
  let lastStatus = '';

  function formatDraftError(err) {
    const parts = [err?.message, err?.payload?.hint, err?.payload?.error].filter(Boolean);
    return parts.length ? parts.join(' — ') : 'Ошибка генерации';
  }

  function emit(patch = {}) {
    if (patch.phase !== undefined) lastPhase = patch.phase;
    if (patch.status !== undefined) lastStatus = patch.status;
    onState?.({
      enabled,
      running,
      posting,
      sentThisHour: getSentThisHour(),
      nextInMs: getMsUntilNextSlot(),
      log: getAutoReplyLog(),
      phase: lastPhase,
      status: lastStatus,
      ...patch,
    });
  }

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleNext(delayMs, status = 'ожидание') {
    clearTimer();
    if (!enabled || stopped) return;
    const wait =
      delayMs != null
        ? Math.max(MIN_SCHEDULE_MS, delayMs)
        : Math.max(MIN_SCHEDULE_MS, getMsUntilNextSlot());
    timer = setTimeout(() => {
      runCycle().catch((err) => logWarn('cycle error', err));
    }, wait);
    emit({ nextInMs: wait, status, phase: 'idle' });
  }

  async function loadFeedbacksList() {
    if (isFeedbacksReadRateLimited()) {
      const rateWait = getFeedbacksReadRateLimitSecondsLeft() * 1000;
      emit({
        phase: 'idle',
        status: `в очереди · лимит чтения WB ${Math.ceil(rateWait / 1000)} сек`,
      });
      scheduleNext(rateWait, `в очереди · ${Math.ceil(rateWait / 1000)} сек`);
      return null;
    }

    log('fetching unanswered reviews');
    const list = await fetchUnanswered(token);
    onFeedbacksLoaded?.(list);
    return list.feedbacks || [];
  }

  async function generateSafeDraft(feedback) {
    try {
      let payload = await requestDraft(token, feedback, { regenerate: false });
      let check = isDraftSafeForAutoSend(payload);
      if (check.ok) return { payload, retried: false };

      log('draft unsafe, regenerating', check.reason);
      payload = await requestDraft(token, feedback, { regenerate: true });
      check = isDraftSafeForAutoSend(payload);
      if (check.ok) return { payload, retried: true };

      return { payload, retried: true, skipReason: check.reason };
    } catch (err) {
      return {
        error: formatDraftError(err),
        payload: err.payload,
        status: err.status,
      };
    }
  }

  async function runCycle({ immediate = false } = {}) {
    if (!enabled || stopped) return;

    if (running) {
      scheduleNext();
      return;
    }

    if (!immediate) {
      const waitMs = getMsUntilNextSlot();
      if (waitMs > 0) {
        emit({ phase: 'idle', status: `ожидание · ${formatMinutes(waitMs)} мин` });
        scheduleNext(waitMs);
        return;
      }
    }

    if (getSentThisHour() >= AUTO_REPLY_MAX_PER_HOUR) {
      const waitMs = getMsUntilNextSlot();
      emit({ phase: 'idle', status: `лимит ${AUTO_REPLY_MAX_PER_HOUR}/час` });
      scheduleNext(waitMs);
      return;
    }

    running = true;
    let currentFeedback = null;
    emit({ status: 'обработка', phase: 'processing', running: true });

    try {
      let feedbacks = (getFeedbacks?.() || []).filter((fb) => fb?.id && !fb.isAnswered);

      if (!feedbacks.length) {
        const fetched = await loadFeedbacksList();
        if (fetched === null) return;
        feedbacks = fetched;
      }

      let feedback = pickNextFeedback(feedbacks, skippedIds);

      if (!feedback && skippedIds.size > 0) {
        log('all cached reviews skipped — refetching');
        skippedIds.clear();
        const fetched = await loadFeedbacksList();
        if (fetched === null) return;
        feedbacks = fetched;
        feedback = pickNextFeedback(feedbacks, skippedIds);
      }

      if (!feedback) {
        emit({ status: 'нет отзывов', phase: 'idle' });
        scheduleNext(AUTO_REPLY_INTERVAL_MS);
        return;
      }

      currentFeedback = feedback;
      emit({
        status: `генерация · ${feedback.productName || feedback.id}`,
        phase: 'generating',
        currentFeedbackId: feedback.id,
      });

      const draftResult = await generateSafeDraft(feedback);

      if (draftResult.error) {
        const isRate =
          draftResult.status === 429 || draftResult.payload?.code === 'RATE_LIMIT';
        appendLog({
          at: new Date().toISOString(),
          feedbackId: feedback.id,
          productName: feedback.productName || '',
          rating: feedback.rating,
          status: isRate ? 'в очереди' : 'ошибка',
          reason: `Черновик: ${draftResult.error}`,
        });
        emit({
          status: isRate ? `в очереди · ${draftResult.error}` : `ошибка · ${draftResult.error}`,
          phase: isRate ? 'idle' : 'error',
          lastResult: { at: new Date().toISOString(), feedbackId: feedback.id, ok: false, reason: draftResult.error },
        });
        const retryAfterSec = Number(draftResult.payload?.retryAfterSec) || 0;
        scheduleNext(
          isRate && retryAfterSec > 0 ? retryAfterSec * 1000 : ERROR_RETRY_MS,
          isRate ? `в очереди · ${retryAfterSec || Math.ceil(ERROR_RETRY_MS / 1000)} сек` : undefined
        );
        return;
      }

      const { payload, retried, skipReason } = draftResult;
      const check = isDraftSafeForAutoSend(payload);

      if (!check.ok) {
        skippedIds.add(feedback.id);
        const reason = skipReason || check.reason;
        appendLog({
          at: new Date().toISOString(),
          feedbackId: feedback.id,
          productName: feedback.productName || '',
          rating: feedback.rating,
          status: 'пропущен',
          reason,
          retried,
        });
        emit({
          status: `пропуск · ${reason}`,
          phase: 'idle',
          lastResult: { at: new Date().toISOString(), feedbackId: feedback.id, ok: false, reason },
        });
        scheduleNext(MIN_SCHEDULE_MS);
        return;
      }

      posting = true;
      emit({
        status: `отправка · ${feedback.productName || feedback.id}`,
        phase: 'sending',
        posting: true,
        currentFeedbackId: feedback.id,
      });

      log('posting answer', feedback.id);
      await postAnswer(token, feedback.id, payload.draft.trim());

      const sentThisHour = recordSentTimestamp();
      const lastResult = {
        at: new Date().toISOString(),
        feedbackId: feedback.id,
        ok: true,
        productName: feedback.productName || '',
      };
      appendLog({
        at: lastResult.at,
        feedbackId: feedback.id,
        productName: feedback.productName || '',
        rating: feedback.rating,
        status: 'отправлен',
        preview: payload.draft.trim().slice(0, 120),
        provider: payload.provider,
        retried,
      });

      posting = false;
      emit({
        status: 'отправлен',
        phase: 'sent',
        sentThisHour,
        posting: false,
        lastResult,
      });
      setTimeout(() => {
        onAfterSend?.(feedback.id);
      }, POST_REFRESH_DELAY_MS);
      scheduleNext(AUTO_REPLY_INTERVAL_MS);
    } catch (err) {
      posting = false;
      const reason = [err.message, err.payload?.hint].filter(Boolean).join(' — ') || 'Ошибка';
      const isRate = isRateLimitError(err);
      const fb = currentFeedback;
      appendLog({
        at: new Date().toISOString(),
        feedbackId: fb?.id || null,
        productName: fb?.productName || '',
        rating: fb?.rating ?? null,
        status: isRate ? 'в очереди' : 'ошибка',
        reason,
      });
      emit({
        status: isRate ? `в очереди · ${reason}` : `ошибка · ${reason}`,
        phase: isRate ? 'idle' : 'error',
        posting: false,
        lastResult: {
          at: new Date().toISOString(),
          feedbackId: fb?.id || null,
          ok: false,
          reason,
        },
      });

      const retryAfterSec =
        Number(err.payload?.retryAfterSec) ||
        (isRateLimitError(err) ? Number(err.retryAfterSec) : 0) ||
        0;
      const backoff = retryAfterSec > 0 ? retryAfterSec * 1000 : isRate ? ERROR_RETRY_MS : ERROR_RETRY_MS;
      scheduleNext(backoff, isRate ? `в очереди · ${Math.ceil(backoff / 1000)} сек` : undefined);
    } finally {
      running = false;
      emit({ running: false, posting: false });
    }
  }

  return {
    start() {
      stopped = false;
      enabled = true;
      saveAutoReplyEnabled(true);
      skippedIds.clear();
      log('started');
      emit({ status: 'запущен', phase: 'idle' });
      runCycle({ immediate: true }).catch((err) => logWarn('start cycle error', err));
    },
    stop() {
      enabled = false;
      stopped = true;
      saveAutoReplyEnabled(false);
      clearTimer();
      log('stopped');
      emit({ status: 'остановлен', phase: 'idle', posting: false });
    },
    refresh() {
      emit();
    },
    destroy() {
      stopped = true;
      enabled = false;
      clearTimer();
    },
    isEnabled: () => enabled,
    isPosting: () => posting,
  };
}
