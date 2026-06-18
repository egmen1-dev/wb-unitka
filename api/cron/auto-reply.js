import autoReplyBatch from '../feedbacks/auto-reply-batch.js';

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const auth = req.headers.authorization || req.headers.Authorization || '';
    const token = String(auth).replace(/^Bearer\s+/i, '').trim();
    if (token !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (!process.env.WB_API_TOKEN?.trim()) {
    return res.status(200).json({
      ok: false,
      skipped: true,
      reason: 'WB_API_TOKEN не задан — серверный cron отключён',
    });
  }

  return autoReplyBatch(req, res);
}
