import { getDeployMeta } from '../../lib/deploy-meta.js';

export function getVersionPayload() {
  return {
    ...getDeployMeta(),
    builtAt: new Date().toISOString(),
    service: 'wb-feedbacks',
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Используйте GET' });
  }

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.status(200).json(getVersionPayload());
}
