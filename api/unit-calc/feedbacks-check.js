import { probeWbFeedbacksTokenScopes, WB_FEEDBACKS_TOKEN_SCOPES } from '../../lib/wb-token-scopes.js';
import { WbFeedbacksRateLimitError } from '../../lib/wb-feedbacks.js';

function readToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const fromHeader = String(header).replace(/^Bearer\s+/i, '').trim();
  if (fromHeader) return fromHeader;
  if (req.body?.token) return String(req.body.token).trim();
  return process.env.WB_API_TOKEN?.trim() || null;
}

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

  try {
    const result = await probeWbFeedbacksTokenScopes(token);
    return res.status(200).json({
      action: 'check',
      ...result,
      categories: WB_FEEDBACKS_TOKEN_SCOPES,
    });
  } catch (error) {
    console.error('[unit-calc/feedbacks-check]', error);

    if (error instanceof WbFeedbacksRateLimitError || error?.code === 'RATE_LIMIT') {
      const retryAfterSec = error.retryAfterSec || 5;
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: error.message || `Слишком много запросов к WB, подождите ${retryAfterSec} сек`,
        code: 'RATE_LIMIT',
        retryAfterSec,
      });
    }

    return res.status(500).json({
      error: error.message || 'Не удалось проверить категории токена',
    });
  }
}
