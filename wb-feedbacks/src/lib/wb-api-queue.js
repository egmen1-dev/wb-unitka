import { fetchWithTimeout, readJsonResponse } from './http';
import {
  clearFeedbacksRateLimit,
  getFeedbacksRateLimitSecondsLeft,
  isFeedbacksRateLimited,
  setFeedbacksRateLimited,
} from './feedbacks-cache';

/** Minimum gap between WB feedbacks API calls from this tab. */
const MIN_GAP_MS = 500;
const MAX_AUTO_RETRIES = 3;

let chain = Promise.resolve();
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCooldownAndGap() {
  const now = Date.now();
  const gapWait = Math.max(0, MIN_GAP_MS - (now - lastRequestAt));
  const rateWait = isFeedbacksRateLimited() ? getFeedbacksRateLimitSecondsLeft() * 1000 : 0;
  const waitMs = Math.max(gapWait, rateWait);
  if (waitMs > 0) await sleep(waitMs);
  lastRequestAt = Date.now();
}

/** Serialize WB feedbacks API calls from one browser tab. */
export function enqueueWbApi(task) {
  const run = chain.then(() => task());
  chain = run.catch(() => {});
  return run;
}

/**
 * Fetch a feedbacks API route with client-side queue, cooldown respect, and auto-retry on 429.
 * @returns {{ response: Response, payload: object }}
 */
export async function fetchFeedbacksApi(url, options, { maxRetries = MAX_AUTO_RETRIES, timeoutMs } = {}) {
  return enqueueWbApi(async () => {
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      await waitForCooldownAndGap();

      const response = await fetchWithTimeout(url, options, timeoutMs);
      const { data: payload } = await readJsonResponse(response);

      if (response.status === 429 || payload?.code === 'RATE_LIMIT') {
        const sec = Number(payload?.retryAfterSec) || 5;
        setFeedbacksRateLimited(sec);
        lastError = Object.assign(new Error(payload?.error || `Подождите ${sec} сек`), {
          code: 'RATE_LIMIT',
          retryAfterSec: sec,
          payload,
          status: response.status,
        });
        if (attempt < maxRetries) {
          await sleep(sec * 1000);
          clearFeedbacksRateLimit();
          continue;
        }
        throw lastError;
      }

      clearFeedbacksRateLimit();
      return { response, payload };
    }

    throw lastError || new Error('Не удалось выполнить запрос к WB');
  });
}

export function isRateLimitError(err) {
  return err?.code === 'RATE_LIMIT' || err?.status === 429 || err?.payload?.code === 'RATE_LIMIT';
}
