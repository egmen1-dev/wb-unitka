export const WB_SELLER_TOKEN_URL = 'https://seller.wildberries.ru/supplier-settings/access-to-api';

export const WB_TOKEN_WITHDRAWN_MESSAGE =
  'Токен WB отозван. Создайте новый в личном кабинете → Данные → вставьте токен';

export const WB_TOKEN_UNAUTHORIZED_MESSAGE = 'Токен WB недействителен или истёк';

export const WB_TOKEN_TARIFFS_SCOPE_MESSAGE =
  'Токен отозван ИЛИ не подходит для тарифов — проверьте категорию «Цены и скидки» / «Тарифы» в личном кабинете WB';

export const WB_TOKEN_SCOPE_MESSAGE =
  'Нет доступа к этому API — проверьте категории токена в личном кабинете WB';

function isTariffsPath(path = '') {
  return /tariffs|commission/i.test(String(path || ''));
}

/** Разбор ответа WB API по HTTP-статусу и телу. */
export function parseWbAuthError(status, detail = '', { path = '' } = {}) {
  const text = String(detail || '').toLowerCase();
  const tariffs = isTariffsPath(path);

  if (status === 403) {
    return {
      kind: 'scope',
      message: tariffs ? WB_TOKEN_TARIFFS_SCOPE_MESSAGE : WB_TOKEN_SCOPE_MESSAGE,
      code: 'WB_TOKEN_SCOPE',
      path: path || undefined,
    };
  }

  if (status === 401 && text.includes('withdrawn')) {
    return {
      kind: 'withdrawn',
      message: tariffs ? WB_TOKEN_TARIFFS_SCOPE_MESSAGE : WB_TOKEN_WITHDRAWN_MESSAGE,
      code: 'WB_TOKEN_WITHDRAWN',
      path: path || undefined,
    };
  }

  if (status === 401 || (status === 403 && /unauthorized|withdrawn/i.test(text))) {
    const kind = text.includes('withdrawn') ? 'withdrawn' : 'unauthorized';
    const message =
      kind === 'withdrawn'
        ? tariffs
          ? WB_TOKEN_TARIFFS_SCOPE_MESSAGE
          : WB_TOKEN_WITHDRAWN_MESSAGE
        : WB_TOKEN_UNAUTHORIZED_MESSAGE;
    return {
      kind,
      message,
      code: kind === 'withdrawn' ? 'WB_TOKEN_WITHDRAWN' : 'WB_TOKEN_UNAUTHORIZED',
      path: path || undefined,
    };
  }

  return null;
}

/** Разбор текста ошибки (из sync/FBS или сырой WB API). */
export function parseWbAuthErrorFromMessage(message = '') {
  const text = String(message || '');
  const lower = text.toLowerCase();
  if (!text) return null;

  const tariffs = isTariffsPath(text);

  if ((/401/.test(text) || lower.includes('unauthorized')) && lower.includes('withdrawn')) {
    return {
      kind: 'withdrawn',
      message: tariffs ? WB_TOKEN_TARIFFS_SCOPE_MESSAGE : WB_TOKEN_WITHDRAWN_MESSAGE,
      code: 'WB_TOKEN_WITHDRAWN',
    };
  }

  if (/403/.test(text) && /forbidden|scope|категор/i.test(text)) {
    return {
      kind: 'scope',
      message: tariffs ? WB_TOKEN_TARIFFS_SCOPE_MESSAGE : WB_TOKEN_SCOPE_MESSAGE,
      code: 'WB_TOKEN_SCOPE',
    };
  }

  if (/401|403/.test(text) && /unauthorized|withdrawn|недействител|истёк/i.test(text)) {
    return lower.includes('withdrawn')
      ? {
          kind: 'withdrawn',
          message: tariffs ? WB_TOKEN_TARIFFS_SCOPE_MESSAGE : WB_TOKEN_WITHDRAWN_MESSAGE,
          code: 'WB_TOKEN_WITHDRAWN',
        }
      : {
          kind: 'unauthorized',
          message: WB_TOKEN_UNAUTHORIZED_MESSAGE,
          code: 'WB_TOKEN_UNAUTHORIZED',
        };
  }

  return null;
}

export function isWbTokenWithdrawnError(message) {
  return parseWbAuthErrorFromMessage(message)?.kind === 'withdrawn';
}

export function isWbTokenScopeError(message) {
  return parseWbAuthErrorFromMessage(message)?.kind === 'scope';
}

export function isWbTokenAuthError(message) {
  return Boolean(parseWbAuthErrorFromMessage(message));
}
