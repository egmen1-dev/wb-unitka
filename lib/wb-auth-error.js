export const WB_SELLER_TOKEN_URL = 'https://seller.wildberries.ru/supplier-settings/access-to-api';

export const WB_TOKEN_WITHDRAWN_MESSAGE =
  'Токен WB отозван. Создайте новый в личном кабинете → Данные → вставьте токен';

export const WB_TOKEN_UNAUTHORIZED_MESSAGE = 'Токен WB недействителен или истёк';

/** Разбор ответа WB API по HTTP-статусу и телу. */
export function parseWbAuthError(status, detail = '') {
  const text = String(detail || '').toLowerCase();
  if (status === 401 && text.includes('withdrawn')) {
    return { kind: 'withdrawn', message: WB_TOKEN_WITHDRAWN_MESSAGE, code: 'WB_TOKEN_WITHDRAWN' };
  }
  if (status === 401 || (status === 403 && /unauthorized|withdrawn/i.test(text))) {
    const kind = text.includes('withdrawn') ? 'withdrawn' : 'unauthorized';
    return {
      kind,
      message: kind === 'withdrawn' ? WB_TOKEN_WITHDRAWN_MESSAGE : WB_TOKEN_UNAUTHORIZED_MESSAGE,
      code: kind === 'withdrawn' ? 'WB_TOKEN_WITHDRAWN' : 'WB_TOKEN_UNAUTHORIZED',
    };
  }
  return null;
}

/** Разбор текста ошибки (из sync/FBS или сырой WB API). */
export function parseWbAuthErrorFromMessage(message = '') {
  const text = String(message || '');
  const lower = text.toLowerCase();
  if (!text) return null;

  if ((/401/.test(text) || lower.includes('unauthorized')) && lower.includes('withdrawn')) {
    return { kind: 'withdrawn', message: WB_TOKEN_WITHDRAWN_MESSAGE, code: 'WB_TOKEN_WITHDRAWN' };
  }
  if (/401|403/.test(text) && /unauthorized|withdrawn|недействител|истёк/i.test(text)) {
    return lower.includes('withdrawn')
      ? { kind: 'withdrawn', message: WB_TOKEN_WITHDRAWN_MESSAGE, code: 'WB_TOKEN_WITHDRAWN' }
      : { kind: 'unauthorized', message: WB_TOKEN_UNAUTHORIZED_MESSAGE, code: 'WB_TOKEN_UNAUTHORIZED' };
  }
  return null;
}

export function isWbTokenWithdrawnError(message) {
  return parseWbAuthErrorFromMessage(message)?.kind === 'withdrawn';
}

export function isWbTokenAuthError(message) {
  return Boolean(parseWbAuthErrorFromMessage(message));
}
