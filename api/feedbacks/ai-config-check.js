import { getDeployMeta } from '../../lib/deploy-meta.js';
import { readYandexConfig } from '../../lib/yandex-gpt.js';

function envPresent(name) {
  return Boolean(process.env[name]?.trim());
}

export function getAiConfigStatus() {
  return {
    yandexConfigured: Boolean(readYandexConfig()),
    openaiConfigured: envPresent('OPENAI_API_KEY'),
    envPresent: {
      YANDEX_GPT_API_KEY: envPresent('YANDEX_GPT_API_KEY'),
      YANDEX_CLOUD_API_KEY: envPresent('YANDEX_CLOUD_API_KEY'),
      YANDEX_FOLDER_ID: envPresent('YANDEX_FOLDER_ID'),
      YANDEX_GPT_MODEL: envPresent('YANDEX_GPT_MODEL'),
      OPENAI_API_KEY: envPresent('OPENAI_API_KEY'),
    },
    ...getDeployMeta(),
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
