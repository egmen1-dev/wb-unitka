import { resolveBuyerGender } from './infer-buyer-gender.js';
import { withWbApiToken } from './wb-official-api.js';

const FEEDBACKS_API = 'https://feedbacks-api.wildberries.ru';
const MIN_INTERVAL_MS = 1800;
const MAX_RETRIES = 6;
export const FEEDBACKS_PAGE_SIZE = 100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sellerKey(token) {
  const t = String(token || '')
    .trim()
    .replace(/^Bearer\s+/i, '');
  return t.slice(-24) || 'default';
}

/** Per-seller queue: ~3 req/s, burst handled by min interval. */
const throttleBySeller = new Map();

async function waitTurn(token) {
  const key = sellerKey(token);
  let state = throttleBySeller.get(key);
  if (!state) {
    state = { chain: Promise.resolve(), lastAt: 0 };
    throttleBySeller.set(key, state);
  }

  const ticket = state.chain.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, MIN_INTERVAL_MS - (now - state.lastAt));
    if (waitMs > 0) await sleep(waitMs);
    state.lastAt = Date.now();
  });

  state.chain = ticket.catch(() => {});
  await ticket;
}

function rawFeedbacksFetch(token, path, { method = 'GET', body = null, query = null } = {}) {
  const authToken = (token || '').trim();
  const url = new URL(path, FEEDBACKS_API);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  return fetch(url, {
    method,
    headers: {
      Authorization: authToken,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export class WbFeedbacksRateLimitError extends Error {
  constructor(message, { status = 429, retryAfterSec = 0, detail = '' } = {}) {
    super(message);
    this.name = 'WbFeedbacksRateLimitError';
    this.code = 'RATE_LIMIT';
    this.status = status;
    this.retryAfterSec = retryAfterSec;
    this.detail = detail;
  }
}

/** Centralized fetch: throttle per seller + retry 429/461 with backoff / Retry-After. */
export async function feedbacksApiRequest(token, path, options = {}) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    await waitTurn(token);
    const response = await rawFeedbacksFetch(token, path, options);

    if (response.ok) return response;

    const retryable = response.status === 429 || response.status === 461 || response.status === 503;
    if (retryable && attempt < MAX_RETRIES - 1) {
      const retryAfterSec = Number(response.headers.get('Retry-After')) || 0;
      const waitMs =
        retryAfterSec > 0
          ? retryAfterSec * 1000
          : Math.min(30_000, Math.max(1500, 1000 * 2 ** attempt));
      await sleep(waitMs);
      continue;
    }

    if (response.status === 429 || response.status === 461) {
      const text = await response.text().catch(() => '');
      const retryAfterSec = Number(response.headers.get('Retry-After')) || Math.max(3, 2 ** attempt);
      throw new WbFeedbacksRateLimitError(
        `Слишком много запросов к WB, подождите ${retryAfterSec} сек`,
        { status: response.status, retryAfterSec, detail: text.slice(0, 200) }
      );
    }

    return response;
  }

  throw new WbFeedbacksRateLimitError('Слишком много запросов к WB, подождите несколько секунд', {
    retryAfterSec: 5,
  });
}

async function readFeedbacksJson(response, path) {
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`WB feedbacks ${response.status} ${path}: ${text.slice(0, 200)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`WB feedbacks ${path}: неверный JSON`);
  }
}

function unwrapData(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.error) {
    const detail = payload.errorText || payload.message || payload.title || '';
    throw new Error(detail || 'Ошибка WB feedbacks API');
  }
  if (payload.data != null) return payload.data;
  if (Array.isArray(payload.feedbacks)) return payload;
  return payload;
}

/** Нормализованный отзыв для UI и промпта. */
function normalizeFeedbackBables(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item.trim() : String(item?.name || item?.text || '').trim()))
      .filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function serializeFeedback(fb) {
  if (!fb) return null;
  const details = fb.productDetails || {};
  const userName = fb.userName || '';
  const genderInfo = resolveBuyerGender({
    userName,
    sex: fb.sex,
    gender: fb.gender,
    buyerSex: fb.buyerSex,
    buyerGender: fb.buyerGender,
  });
  return {
    id: fb.id,
    rating: Number(fb.productValuation) || 0,
    text: String(fb.text || '').trim(),
    pros: String(fb.pros || '').trim(),
    cons: String(fb.cons || '').trim(),
    nmId: Number(details.nmId) || null,
    article: String(details.supplierArticle || '').trim(),
    productName: String(details.productName || '').trim(),
    brandName: String(details.brandName || '').trim(),
    createdDate: fb.createdDate || null,
    userName,
    buyerGender: genderInfo.gender,
    buyerGenderSource: genderInfo.source,
    buyerGenderLabel: genderInfo.label,
    matchingSize: fb.matchingSize || null,
    bables: normalizeFeedbackBables(fb.bables ?? fb.bablesList ?? fb.productBables ?? fb.tags),
    productValuation: Number(fb.productValuation) || 0,
    wasViewed: Boolean(fb.wasViewed),
    answer: fb.answer?.text ? String(fb.answer.text).trim() : null,
    isAnswered: Boolean(fb.answer?.text),
  };
}

/** GET /api/v1/feedbacks/count-unanswered */
export async function countUnansweredFeedbacks(token) {
  return withWbApiToken(token, async () => {
    const response = await feedbacksApiRequest(token, '/api/v1/feedbacks/count-unanswered');
    const payload = await readFeedbacksJson(response, '/api/v1/feedbacks/count-unanswered');
    const data = unwrapData(payload);
    return {
      countUnanswered: Number(data?.countUnanswered) || 0,
      countUnansweredToday: Number(data?.countUnansweredToday) || 0,
    };
  });
}

/** GET /api/v1/feedbacks?isAnswered=false */
export async function fetchUnansweredFeedbacks(
  token,
  { take = FEEDBACKS_PAGE_SIZE, skip = 0, order = 'dateDesc' } = {}
) {
  return withWbApiToken(token, async () => {
    const pageSize = Math.min(FEEDBACKS_PAGE_SIZE, Math.max(1, Number(take) || FEEDBACKS_PAGE_SIZE));
    const response = await feedbacksApiRequest(token, '/api/v1/feedbacks', {
      query: {
        isAnswered: false,
        take: pageSize,
        skip: Math.max(0, Number(skip) || 0),
        order,
      },
    });
    const payload = await readFeedbacksJson(response, '/api/v1/feedbacks');
    const data = unwrapData(payload);
    const feedbacks = (data?.feedbacks || []).map(serializeFeedback).filter((fb) => fb?.id);
    return {
      feedbacks,
      countUnanswered: Number(data?.countUnanswered) || feedbacks.length,
      countArchive: Number(data?.countArchive) || 0,
      skip: Math.max(0, Number(skip) || 0),
      take: pageSize,
      hasMore: feedbacks.length >= pageSize,
    };
  });
}

/** POST /api/v1/feedbacks/answer */
export async function postFeedbackAnswer(token, feedbackId, text, { skipVerify = false } = {}) {
  const id = String(feedbackId || '').trim();
  const answerText = String(text || '').trim();
  if (!id) throw new Error('Не указан id отзыва');
  if (answerText.length < 2 || answerText.length > 1000) {
    throw new Error('Ответ должен быть от 2 до 1000 символов');
  }

  return withWbApiToken(token, async () => {
    const response = await feedbacksApiRequest(token, '/api/v1/feedbacks/answer', {
      method: 'POST',
      body: { id, text: answerText },
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`WB answer ${response.status}: ${errText.slice(0, 200)}`);
    }
    if (skipVerify) {
      return { verified: null, isAnswered: true, answerText };
    }
    await sleep(1000);
    return verifyFeedbackAnswered(token, id, answerText);
  });
}

/** GET /api/v1/feedback — один отзыв по id. */
export async function fetchFeedbackById(token, feedbackId) {
  const id = String(feedbackId || '').trim();
  if (!id) throw new Error('Не указан id отзыва');

  return withWbApiToken(token, async () => {
    const response = await feedbacksApiRequest(token, '/api/v1/feedback', {
      query: { id },
    });
    const payload = await readFeedbacksJson(response, '/api/v1/feedback');
    const fb = unwrapData(payload);
    return serializeFeedback(fb);
  });
}

/** GET /api/v1/feedback — проверка, что ответ сохранился. */
export async function verifyFeedbackAnswered(token, feedbackId, expectedText = '') {
  const feedback = await fetchFeedbackById(token, feedbackId);
  const answerText = String(feedback?.answer || '').trim();
  const verified = Boolean(answerText);
  const textMatches = expectedText
    ? answerText.slice(0, 120) === String(expectedText).trim().slice(0, 120)
    : verified;
  return {
    verified: verified && textMatches,
    isAnswered: verified,
    answerText,
    feedback,
  };
}
