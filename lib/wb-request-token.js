/** Нормализация JWT WB: trim и снятие префикса Bearer. */
export function normalizeWbToken(token) {
  return String(token || '')
    .trim()
    .replace(/^Bearer\s+/i, '');
}

/** Токен из запроса API unit-calc / feedbacks. Env — только если клиент не прислал Authorization. */
export function readWbRequestToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const hadAuthHeader = Boolean(String(header).trim());

  if (hadAuthHeader) {
    const fromHeader = normalizeWbToken(header);
    if (fromHeader) return fromHeader;
  }

  const bodyToken = normalizeWbToken(req.body?.token);
  if (bodyToken) return bodyToken;

  if (!hadAuthHeader && req.body?.token == null) {
    return process.env.WB_API_TOKEN?.trim() || null;
  }

  return null;
}
