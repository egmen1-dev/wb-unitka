import { feedbacksApiRequest } from './wb-feedbacks.js';

/**
 * Категории токена WB для вкладки «Отзывы» и смежных функций unit-calc.
 * Названия соответствуют личному кабинету продавца (Профиль → API).
 */

export const WB_FEEDBACKS_TOKEN_SCOPES = [
  {
    id: 'feedbacks',
    label: 'Вопросы и отзывы',
    labelEn: 'Feedbacks and Questions',
    required: true,
    purpose: 'Список неотвеченных отзывов, просмотр, ответ, счётчик',
    usedFor: ['list', 'count', 'get', 'answer'],
    apiHost: 'feedbacks-api.wildberries.ru',
    withoutScope: 'Вкладка «Отзывы» не работает: нельзя загрузить список, счётчик и отправить ответ',
  },
  {
    id: 'content',
    label: 'Контент',
    labelEn: 'Content',
    required: true,
    purpose: 'Карточка: артикул, характеристики, описание, nmId, subjectId — обогащение AI-черновика',
    usedFor: ['draft', 'characteristics', 'description', 'subjectId'],
    apiHost: 'content-api.wildberries.ru',
    withoutScope:
      'Черновик по названию из каталога синка, без описания и характеристик с WB Content API',
  },
  {
    id: 'prices',
    label: 'Цены и скидки',
    labelEn: 'Prices and Discounts',
    required: false,
    recommended: true,
    purpose: 'Цена товара и дорогих аналогов для премиум-апселла в ответе',
    usedFor: ['upsell', 'premium alternative'],
    apiHost: 'discounts-prices-api.wildberries.ru',
    withoutScope:
      'Апселл по артикулу и названию из каталога, без цены и дельты «+N ₽ к текущему»',
  },
  {
    id: 'statistics',
    label: 'Статистика',
    labelEn: 'Statistics',
    required: false,
    optional: true,
    purpose: 'Рейтинг и аналитика SKU в каталоге (опционально — рейтинг в отзыве приходит из API отзывов)',
    usedFor: ['product rating'],
    apiHost: 'statistics-api.wildberries.ru',
    withoutScope: 'Рейтинг в отзыве приходит из API отзывов; сводный рейтинг SKU в каталоге не обновится',
  },
];

const SCOPE_BY_ID = new Map(WB_FEEDBACKS_TOKEN_SCOPES.map((s) => [s.id, s]));

export function getFeedbackTokenScope(id) {
  return SCOPE_BY_ID.get(id) || null;
}

function normalizeWbToken(token) {
  return String(token || '')
    .trim()
    .replace(/^Bearer\s+/i, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyProbeError(status, detail) {
  if (status === 401) {
    return { kind: 'unauthorized', error: 'Токен недействителен или истёк (401)' };
  }
  if (status === 403) {
    return {
      kind: 'forbidden',
      error: 'Нет доступа — включите эту категорию при создании токена (403)',
    };
  }
  if (status === 429 || status === 461) {
    return {
      kind: 'rateLimit',
      error: `Лимит запросов WB API (${status}) — подождите и повторите`,
    };
  }
  if (status === 0) {
    return { kind: 'network', error: detail || 'Сетевая ошибка' };
  }
  return { kind: 'http', error: detail || `HTTP ${status}` };
}

async function feedbacksApiProbe(token, path, { method = 'GET', body = null } = {}) {
  const authToken = normalizeWbToken(token);
  if (!authToken) {
    return { ok: false, status: 0, kind: 'network', error: 'Токен не указан' };
  }

  try {
    const response = await feedbacksApiRequest(authToken, path, { method, body });
    const text = await response.text().catch(() => '');
    let detail = text.slice(0, 200);
    try {
      const json = JSON.parse(text);
      detail = json?.errorText || json?.message || json?.title || detail;
    } catch {
      // keep text slice
    }

    if (response.ok) {
      return { ok: true, status: response.status, kind: 'ok', detail: 'OK' };
    }

    return { ok: false, status: response.status, detail, ...classifyProbeError(response.status, detail) };
  } catch (err) {
    if (err?.code === 'RATE_LIMIT') {
      return {
        ok: false,
        status: err.status || 429,
        kind: 'rateLimit',
        error: err.message,
        detail: err.detail || err.message,
      };
    }
    return {
      ok: false,
      status: 0,
      kind: 'network',
      error: err.message || 'Сетевая ошибка',
    };
  }
}

async function wbProbe(token, url, { method = 'GET', body = null, retries = 2 } = {}) {
  const authToken = normalizeWbToken(token);
  if (!authToken) {
    return { ok: false, status: 0, kind: 'network', error: 'Токен не указан' };
  }

  let lastResult = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: authToken,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const text = await response.text().catch(() => '');
      let detail = text.slice(0, 200);
      try {
        const json = JSON.parse(text);
        detail = json?.errorText || json?.message || json?.title || detail;
      } catch {
        // keep text slice
      }

      if (response.ok) {
        return { ok: true, status: response.status, kind: 'ok', detail: 'OK' };
      }

      const classified = classifyProbeError(response.status, detail);
      lastResult = { ok: false, status: response.status, detail, ...classified };

      const retryable = response.status === 429 || response.status === 461 || response.status === 503;
      if (retryable && attempt < retries) {
        const retryAfterSec = Number(response.headers.get('Retry-After')) || 0;
        const waitMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 1500 * (attempt + 1);
        await sleep(waitMs);
        continue;
      }

      return lastResult;
    } catch (err) {
      lastResult = {
        ok: false,
        status: 0,
        kind: 'network',
        error: err.message || 'Сетевая ошибка',
      };
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      return lastResult;
    }
  }

  return lastResult || { ok: false, status: 0, kind: 'network', error: 'Неизвестная ошибка' };
}

/** Считаем категорию доступной: функциональный запрос важнее /ping. */
function resolveScopeOk(ping, functional) {
  if (functional?.ok) return true;
  if (ping?.ok) return true;

  if (functional?.kind === 'forbidden' || ping?.kind === 'forbidden') return false;
  if (functional?.kind === 'unauthorized' || ping?.kind === 'unauthorized') return false;

  return false;
}

function resolveScopeError(ping, functional, ok) {
  if (ok) return undefined;

  const primary = functional?.ok === false ? functional : ping;
  const secondary = functional?.ok === false ? ping : functional;

  if (primary?.error) return primary.error;
  if (secondary?.error && secondary.kind !== 'rateLimit') return secondary.error;

  if (functional && !functional.ok && ping && !ping.ok) {
    return `ping: ${ping.error || ping.detail || ping.status}; API: ${functional.error || functional.detail || functional.status}`;
  }

  return primary?.detail || secondary?.detail || 'Нет доступа к API';
}

async function runFunctionalProbe(token, scopeId, apiHost) {
  const authToken = normalizeWbToken(token);

  if (scopeId === 'feedbacks') {
    return feedbacksApiProbe(authToken, '/api/v1/feedbacks/count-unanswered');
  }

  if (scopeId === 'content') {
    return wbProbe(authToken, `https://${apiHost}/content/v2/get/cards/list?locale=ru`, {
      method: 'POST',
      body: {
        settings: {
          sort: { ascending: true },
          filter: { withPhoto: -1 },
          cursor: { limit: 1 },
        },
      },
    });
  }

  if (scopeId === 'prices') {
    return wbProbe(authToken, `https://${apiHost}/api/v2/list/goods/filter?limit=1&offset=0`);
  }

  if (scopeId === 'statistics') {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const dateFrom = start.toISOString().slice(0, 10);
    const dateTo = end.toISOString().slice(0, 10);
    return wbProbe(
      authToken,
      `https://${apiHost}/api/v5/supplier/reportDetailByPeriod?dateFrom=${dateFrom}&dateTo=${dateTo}&limit=1&rrdid=0`
    );
  }

  return null;
}

/** Проверка одной категории: функциональный запрос + /ping (fallback). */
export async function probeWbTokenScope(token, scopeId) {
  const scope = getFeedbackTokenScope(scopeId);
  if (!scope) {
    return { scopeId, ok: false, error: 'Неизвестная категория' };
  }

  let functional;
  let ping;

  if (scopeId === 'feedbacks') {
    functional = await runFunctionalProbe(token, scopeId, scope.apiHost);
    ping = await feedbacksApiProbe(token, '/ping');
  } else {
    [functional, ping] = await Promise.all([
      runFunctionalProbe(token, scopeId, scope.apiHost),
      wbProbe(token, `https://${scope.apiHost}/ping`, { retries: 1 }),
    ]);
  }

  const ok = resolveScopeOk(ping, functional);

  return {
    scopeId,
    label: scope.label,
    required: scope.required,
    recommended: scope.recommended,
    optional: scope.optional,
    purpose: scope.purpose,
    withoutScope: scope.withoutScope,
    ok,
    ping,
    functional,
    error: resolveScopeError(ping, functional, ok),
  };
}

/** Проверка всех категорий, нужных для отзывов (последовательно — меньше 429 на /ping). */
export async function probeWbFeedbacksTokenScopes(token) {
  const results = [];
  for (const scope of WB_FEEDBACKS_TOKEN_SCOPES) {
    results.push(await probeWbTokenScope(token, scope.id));
  }

  const missingRequired = results.filter((r) => r.required && !r.ok);
  const missingRecommended = results.filter((r) => r.recommended && !r.ok);

  return {
    scopes: results,
    allRequiredOk: missingRequired.length === 0,
    missingRequired: missingRequired.map((r) => r.label),
    missingRecommended: missingRecommended.map((r) => r.label),
    summary:
      missingRequired.length > 0
        ? `Не хватает обязательных категорий: ${missingRequired.map((r) => r.label).join(', ')}`
        : missingRecommended.length > 0
          ? `Базовые права есть. Для полного AI-черновика добавьте: ${missingRecommended.map((r) => r.label).join(', ')}`
          : 'Все рекомендуемые категории доступны',
  };
}
