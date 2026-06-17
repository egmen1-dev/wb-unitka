import { withWbApiToken } from './wb-official-api.js';

const FEEDBACKS_API = 'https://feedbacks-api.wildberries.ru';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function feedbacksFetch(token, path, { method = 'GET', body = null, query = null } = {}) {
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
  if (payload?.error) {
    throw new Error(payload.errorText || 'Ошибка WB feedbacks API');
  }
  return payload?.data ?? payload;
}

/** Нормализованный отзыв для UI и промпта. */
export function serializeFeedback(fb) {
  if (!fb) return null;
  const details = fb.productDetails || {};
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
    userName: fb.userName || '',
    matchingSize: fb.matchingSize || null,
    wasViewed: Boolean(fb.wasViewed),
    answer: fb.answer?.text ? String(fb.answer.text).trim() : null,
    isAnswered: Boolean(fb.answer?.text),
  };
}

/** GET /api/v1/feedbacks/count-unanswered */
export async function countUnansweredFeedbacks(token) {
  return withWbApiToken(token, async () => {
    const response = await feedbacksFetch(token, '/api/v1/feedbacks/count-unanswered');
    const payload = await readFeedbacksJson(response, '/api/v1/feedbacks/count-unanswered');
    const data = unwrapData(payload);
    return {
      countUnanswered: Number(data?.countUnanswered) || 0,
      countUnansweredToday: Number(data?.countUnansweredToday) || 0,
    };
  });
}

/** GET /api/v1/feedbacks?isAnswered=false */
export async function fetchUnansweredFeedbacks(token, { take = 50, skip = 0, order = 'dateDesc' } = {}) {
  return withWbApiToken(token, async () => {
    const response = await feedbacksFetch(token, '/api/v1/feedbacks', {
      query: {
        isAnswered: false,
        take: Math.min(100, Math.max(1, take)),
        skip: Math.max(0, skip),
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
      skip,
      take,
    };
  });
}

/** POST /api/v1/feedbacks/answer */
export async function postFeedbackAnswer(token, feedbackId, text) {
  const id = String(feedbackId || '').trim();
  const answerText = String(text || '').trim();
  if (!id) throw new Error('Не указан id отзыва');
  if (answerText.length < 2 || answerText.length > 1000) {
    throw new Error('Ответ должен быть от 2 до 1000 символов');
  }

  return withWbApiToken(token, async () => {
    const response = await feedbacksFetch(token, '/api/v1/feedbacks/answer', {
      method: 'POST',
      body: { id, text: answerText },
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`WB answer ${response.status}: ${errText.slice(0, 200)}`);
    }
    await sleep(400);
    return verifyFeedbackAnswered(token, id, answerText);
  });
}

/** GET /api/v1/feedback — проверка, что ответ сохранился. */
export async function verifyFeedbackAnswered(token, feedbackId, expectedText = '') {
  return withWbApiToken(token, async () => {
    const response = await feedbacksFetch(token, '/api/v1/feedback', {
      query: { id: String(feedbackId) },
    });
    const payload = await readFeedbacksJson(response, '/api/v1/feedback');
    const fb = unwrapData(payload);
    const answerText = String(fb?.answer?.text || '').trim();
    const verified = Boolean(answerText);
    const textMatches = expectedText
      ? answerText.slice(0, 120) === String(expectedText).trim().slice(0, 120)
      : verified;
    return {
      verified: verified && textMatches,
      isAnswered: verified,
      answerText,
      feedback: serializeFeedback(fb),
    };
  });
}
