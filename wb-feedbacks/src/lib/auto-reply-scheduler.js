import { AUTO_REPLY_INTERVAL_MS, AUTO_REPLY_MAX_PER_HOUR, isDraftSafeForAutoSend } from '@lib/feedback-auto-reply.js';
import { fetchWithTimeout, readJsonResponse } from './http';
import {
  getFeedbacksReadRateLimitSecondsLeft,
  isFeedbacksReadRateLimited,
} from './feedbacks-cache';
import { fetchFeedbacksApi, isRateLimitError } from './wb-api-queue';

export { AUTO_REPLY_INTERVAL_MS, AUTO_REPLY_MAX_PER_HOUR, isDraftSafeForAutoSend };
const HOUR_MS = 3_600_000;
const LOG_MAX = 50;
const POST_REFRESH_DELAY_MS = 15_000;

const STORAGE_ENABLED = 'wb-feedbacks:auto-reply:enabled';
const STORAGE_LOG = 'wb-feedbacks:auto-reply:log';
const STORAGE_TIMESTAMPS = 'wb-feedbacks:auto-reply:timestamps';

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
  const log = [entry, ...getAutoReplyLog()].slice(0, LOG_MAX);
  writeJson(STORAGE_LOG, log);
  return log;
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

async function requestDraft(token, feedback, { regenerate = false } = {}) {
  const variationSeed = Date.now() + Math.floor(Math.random() * 10_000);
  const response = await fetchWithTimeout('/api/feedbacks/feedback-draft', {
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
    }),
  });
  const { data: payload } = await readJsonResponse(response);
  if (!response.ok) {
    const err = new Error(payload?.error || 'Не удалось сгенерировать ответ');
    err.payload = payload;
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
  return payload.feedbacks || [];
}

/**
 * @param {{
 *   token: string,
 *   getFeedbacks?: () => Array,
 *   onState?: (state: object) => void,
 *   onAfterSend?: (feedbackId: string) => void | Promise<void>,
 * }} options
 */
export function createAutoReplyScheduler({ token, getFeedbacks, onState, onAfterSend }) {
  let enabled = false;
  let running = false;
  let posting = false;
  let timer = null;
  let stopped = false;
  const skippedIds = new Set();

  function emit(patch = {}) {
    onState?.({
      enabled,
      running,
      posting,
      sentThisHour: getSentThisHour(),
      nextInMs: getMsUntilNextSlot(),
      log: getAutoReplyLog(),
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
    const wait = Math.max(5_000, delayMs ?? getMsUntilNextSlot());
    timer = setTimeout(() => {
      runCycle().catch(() => {});
    }, wait);
    emit({ nextInMs: wait, status });
  }

  async function generateSafeDraft(feedback) {
    let payload = await requestDraft(token, feedback, { regenerate: false });
    let check = isDraftSafeForAutoSend(payload);
    if (check.ok) return { payload, retried: false };

    payload = await requestDraft(token, feedback, { regenerate: true });
    check = isDraftSafeForAutoSend(payload);
    if (check.ok) return { payload, retried: true };

    return { payload, retried: true, skipReason: check.reason };
  }

  async function runCycle() {
    if (!enabled || stopped || running) {
      scheduleNext();
      return;
    }

    const waitMs = getMsUntilNextSlot();
    if (waitMs > 0) {
      scheduleNext(waitMs);
      return;
    }

    if (getSentThisHour() >= AUTO_REPLY_MAX_PER_HOUR) {
      scheduleNext(getMsUntilNextSlot());
      return;
    }

    running = true;
    emit({ status: 'обработка', running: true });

    try {
      let feedbacks = getFeedbacks?.() || [];
      if (!feedbacks.length) {
        if (isFeedbacksReadRateLimited()) {
          const rateWait = getFeedbacksReadRateLimitSecondsLeft() * 1000;
          emit({
            status: `в очереди · лимит чтения WB ${Math.ceil(rateWait / 1000)} сек`,
          });
          scheduleNext(rateWait, `в очереди · ${Math.ceil(rateWait / 1000)} сек`);
          return;
        }
        feedbacks = await fetchUnanswered(token);
      }

      const feedback = feedbacks.find((fb) => fb?.id && !skippedIds.has(fb.id));
      if (!feedback) {
        emit({ status: 'нет отзывов' });
        scheduleNext(AUTO_REPLY_INTERVAL_MS);
        return;
      }

      emit({ status: `генерация · ${feedback.productName || feedback.id}` });

      const { payload, retried, skipReason } = await generateSafeDraft(feedback);
      const check = isDraftSafeForAutoSend(payload);

      if (!check.ok) {
        skippedIds.add(feedback.id);
        appendLog({
          at: new Date().toISOString(),
          feedbackId: feedback.id,
          productName: feedback.productName || '',
          rating: feedback.rating,
          status: 'пропущен',
          reason: skipReason || check.reason,
          retried,
        });
        emit({ status: `пропуск · ${skipReason || check.reason}` });
        scheduleNext(AUTO_REPLY_INTERVAL_MS);
        return;
      }

      posting = true;
      emit({ status: `отправка · ${feedback.productName || feedback.id}`, posting: true });

      await postAnswer(token, feedback.id, payload.draft.trim());

      const sentThisHour = recordSentTimestamp();
      appendLog({
        at: new Date().toISOString(),
        feedbackId: feedback.id,
        productName: feedback.productName || '',
        rating: feedback.rating,
        status: 'отправлен',
        preview: payload.draft.trim().slice(0, 120),
        provider: payload.provider,
        retried,
      });

      posting = false;
      emit({ status: 'отправлен', sentThisHour, posting: false });
      setTimeout(() => {
        onAfterSend?.(feedback.id);
      }, POST_REFRESH_DELAY_MS);
      scheduleNext(AUTO_REPLY_INTERVAL_MS);
    } catch (err) {
      posting = false;
      const reason = err.message || 'Ошибка';
      const isRate = isRateLimitError(err);
      appendLog({
        at: new Date().toISOString(),
        feedbackId: null,
        productName: '',
        rating: null,
        status: isRate ? 'в очереди' : 'ошибка',
        reason,
      });
      emit({
        status: isRate ? `в очереди · ${reason}` : `ошибка · ${reason}`,
        posting: false,
      });

      const retryAfterSec =
        Number(err.payload?.retryAfterSec) ||
        (isRateLimitError(err) ? Number(err.retryAfterSec) : 0) ||
        0;
      const backoff = retryAfterSec > 0 ? retryAfterSec * 1000 : AUTO_REPLY_INTERVAL_MS;
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
      emit({ status: 'запущен' });
      runCycle().catch(() => {});
    },
    stop() {
      enabled = false;
      stopped = true;
      saveAutoReplyEnabled(false);
      clearTimer();
      emit({ status: 'остановлен', posting: false });
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
