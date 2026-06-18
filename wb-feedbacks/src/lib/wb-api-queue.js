import { fetchWithTimeout, readJsonResponse } from './http';
import {
  clearFeedbacksRateLimit,
  getFeedbacksReadRateLimitSecondsLeft,
  getFeedbacksWriteRateLimitSecondsLeft,
  isFeedbacksReadRateLimited,
  isFeedbacksWriteRateLimited,
  setFeedbacksRateLimited,
} from './feedbacks-cache';

/** Minimum gap between WB feedbacks API calls of the same kind. */
const MIN_GAP_MS = 1800;
const MAX_AUTO_RETRIES = 5;
/** Reject queued tasks that wait too long — prevents a stuck chain from freezing the panel. */
const QUEUE_WAIT_TIMEOUT_MS = 45_000;

let readChain = Promise.resolve();
let writeChain = Promise.resolve();
let lastReadAt = 0;
let lastWriteAt = 0;

/** Clear in-memory queue state on page load (rate limits cleared separately in feedbacks-cache). */
export function resetWbApiQueue() {
  readChain = Promise.resolve();
  writeChain = Promise.resolve();
  lastReadAt = 0;
  lastWriteAt = 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @returns {'read'|'write'} */
export function detectFeedbacksApiKind(url, options) {
  const body = options?.body;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.action === 'answer') return 'write';
    } catch {
      // ignore malformed body
    }
  }
  if (String(url || '').includes('feedbacks-check')) return 'read';
  return 'read';
}

async function waitForCooldownAndGap(kind) {
  const now = Date.now();
  const lastAt = kind === 'write' ? lastWriteAt : lastReadAt;
  const gapWait = Math.max(0, MIN_GAP_MS - (now - lastAt));
  const rateWait =
    kind === 'write'
      ? isFeedbacksWriteRateLimited()
        ? getFeedbacksWriteRateLimitSecondsLeft() * 1000
        : 0
      : isFeedbacksReadRateLimited()
        ? getFeedbacksReadRateLimitSecondsLeft() * 1000
        : 0;
  const waitMs = Math.max(gapWait, rateWait);
  if (waitMs > 0) await sleep(waitMs);
  if (kind === 'write') lastWriteAt = Date.now();
  else lastReadAt = Date.now();
}

function withQueueTimeout(task, label) {
  return Promise.race([
    task(),
    sleep(QUEUE_WAIT_TIMEOUT_MS).then(() => {
      throw new Error(
        `${label} не начался за ${Math.round(QUEUE_WAIT_TIMEOUT_MS / 1000)} сек — обновите страницу`
      );
    }),
  ]);
}

/** Serialize WB feedbacks API calls per kind (read vs write). */
export function enqueueWbApi(task, { kind = 'read' } = {}) {
  const label = kind === 'write' ? 'Запрос записи WB' : 'Запрос чтения WB';
  const run = (kind === 'write' ? writeChain : readChain).then(() =>
    withQueueTimeout(task, label)
  );
  if (kind === 'write') writeChain = run.catch(() => {});
  else readChain = run.catch(() => {});
  return run;
}

/**
 * Fetch a feedbacks API route with per-kind queue, cooldown, and auto-retry on 429.
 * @returns {{ response: Response, payload: object }}
 */
export async function fetchFeedbacksApi(
  url,
  options,
  { maxRetries = MAX_AUTO_RETRIES, timeoutMs, kind } = {}
) {
  const actionKind = kind || detectFeedbacksApiKind(url, options);

  return enqueueWbApi(async () => {
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      await waitForCooldownAndGap(actionKind);

      const response = await fetchWithTimeout(url, options, timeoutMs);
      const { data: payload } = await readJsonResponse(response);

      if (response.status === 429 || payload?.code === 'RATE_LIMIT') {
        const sec = Number(payload?.retryAfterSec) || 5;
        setFeedbacksRateLimited(sec, { kind: actionKind });
        lastError = Object.assign(new Error(payload?.error || `Подождите ${sec} сек`), {
          code: 'RATE_LIMIT',
          retryAfterSec: sec,
          payload,
          status: response.status,
          kind: actionKind,
        });
        if (attempt < maxRetries) {
          await sleep(sec * 1000);
          clearFeedbacksRateLimit(actionKind);
          continue;
        }
        throw lastError;
      }

      clearFeedbacksRateLimit(actionKind);
      return { response, payload };
    }

    throw lastError || new Error('Не удалось выполнить запрос к WB');
  }, { kind: actionKind });
}

export function isRateLimitError(err) {
  return err?.code === 'RATE_LIMIT' || err?.status === 429 || err?.payload?.code === 'RATE_LIMIT';
}
