import { readYandexConfig } from '../../lib/yandex-gpt.js';

export function getAiConfigStatus() {
  return {
    yandexConfigured: Boolean(readYandexConfig()),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Используйте GET или POST' });
  }

  return res.status(200).json(getAiConfigStatus());
}
