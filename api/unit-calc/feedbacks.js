import {
  countUnansweredFeedbacks,
  fetchFeedbackById,
  fetchUnansweredFeedbacks,
  postFeedbackAnswer,
} from '../../lib/wb-feedbacks.js';

function readToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const fromHeader = String(header).replace(/^Bearer\s+/i, '').trim();
  if (fromHeader) return fromHeader;
  if (req.body?.token) return String(req.body.token).trim();
  return process.env.WB_API_TOKEN?.trim() || null;
}

const FEEDBACKS_HINT =
  'Нужен токен с категорией «Вопросы и отзывы» (feedbacks-api.wildberries.ru).';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Используйте POST' });
  }

  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Укажите WB API токен в заголовке Authorization: Bearer …' });
  }

  const action = String(req.body?.action || 'list').trim();

  try {
    if (action === 'count') {
      const counts = await countUnansweredFeedbacks(token);
      return res.status(200).json({
        action: 'count',
        ...counts,
        tokenScope: 'Вопросы и отзывы',
      });
    }

    if (action === 'get') {
      const feedbackId = req.body?.feedbackId || req.body?.id;
      if (!feedbackId) {
        return res.status(400).json({ error: 'Укажите feedbackId' });
      }
      const feedback = await fetchFeedbackById(token, feedbackId);
      if (!feedback?.id) {
        return res.status(404).json({ error: 'Отзыв не найден' });
      }
      return res.status(200).json({
        action: 'get',
        feedback,
        tokenScope: 'Вопросы и отзывы',
      });
    }

    if (action === 'answer') {
      const feedbackId = req.body?.feedbackId || req.body?.id;
      const text = req.body?.text;
      if (!feedbackId) {
        return res.status(400).json({ error: 'Укажите feedbackId' });
      }
      if (!text?.trim()) {
        return res.status(400).json({ error: 'Укажите текст ответа' });
      }

      const result = await postFeedbackAnswer(token, feedbackId, text);
      return res.status(200).json({
        action: 'answer',
        feedbackId,
        ...result,
      });
    }

    const take = Number(req.body?.take) || 50;
    const skip = Number(req.body?.skip) || 0;
    const order = req.body?.order === 'dateAsc' ? 'dateAsc' : 'dateDesc';

    const [list, counts] = await Promise.all([
      fetchUnansweredFeedbacks(token, { take, skip, order }),
      countUnansweredFeedbacks(token).catch(() => ({ countUnanswered: 0, countUnansweredToday: 0 })),
    ]);

    return res.status(200).json({
      action: 'list',
      feedbacks: list.feedbacks,
      countUnanswered: counts.countUnanswered ?? list.countUnanswered,
      countUnansweredToday: counts.countUnansweredToday ?? 0,
      countArchive: list.countArchive,
      skip: list.skip,
      take: list.take,
      tokenScope: 'Вопросы и отзывы',
    });
  } catch (error) {
    console.error('[unit-calc/feedbacks]', error);
    const message = error.message || 'Ошибка WB feedbacks API';
    const status = /401|403/.test(message) ? 403 : 500;
    return res.status(status).json({
      error: message,
      hint: status === 403 ? FEEDBACKS_HINT : undefined,
    });
  }
}
