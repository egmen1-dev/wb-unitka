import {
  createWorkspace,
  loadWorkspace,
  normalizeTeamCode,
  saveWorkspace,
} from '../../lib/unit-calc-workspace.js';

const ALLOWED_ORIGINS = new Set([
  'https://wb-unitka.vercel.app',
  'http://127.0.0.1:5174',
  'http://localhost:5174',
]);

function readBody(req) {
  return req.body || {};
}

function applyCors(req, res) {
  const origin = req.headers?.origin || req.headers?.Origin || '';
  if (ALLOWED_ORIGINS.has(origin) || /^https:\/\/wb-unitka[-a-z0-9]*\.vercel\.app$/i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    if (req.method === 'GET') {
      const team = normalizeTeamCode(req.query?.team);

      if (!team) {
        return res.status(400).json({
          error: 'Укажите код команды',
          needsTeam: true,
        });
      }

      const workspace = await loadWorkspace(team);
      if (!workspace) {
        return res.status(404).json({
          error: 'Команда не найдена. Создайте новую или проверьте код.',
          teamCode: team,
        });
      }

      return res.status(200).json(workspace);
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      if (body.action === 'create') {
        const created = await createWorkspace({
          name: body.name,
          payload: body.payload || {},
        });
        return res.status(201).json({
          ...created,
          shareUrl: `https://wb-unitka.vercel.app/?team=${created.teamCode}`,
        });
      }
      return res.status(400).json({ error: 'Неизвестное действие' });
    }

    if (req.method === 'PUT') {
      const body = readBody(req);
      const team = normalizeTeamCode(body.team);

      if (!team) {
        return res.status(400).json({ error: 'Укажите код команды' });
      }

      const result = await saveWorkspace(team, body.payload || {});
      return res.status(200).json({ ok: true, ...result });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    const message = error.message || 'Ошибка сервера';
    if (/Postgres|подключения/i.test(message)) {
      return res.status(503).json({
        error: 'Облачное хранилище недоступно. Подключите Postgres к проекту wb-unitka в Vercel.',
      });
    }

    console.error('[unit-calc/workspace]', error);
    return res.status(500).json({ error: message });
  }
}
