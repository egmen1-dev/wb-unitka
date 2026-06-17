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

async function wbProbe(token, url, { method = 'GET', body = null } = {}) {
  const authToken = (token || '').trim();
  if (!authToken) {
    return { ok: false, status: 0, error: 'Токен не указан' };
  }

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
    let detail = text.slice(0, 160);
    try {
      const json = JSON.parse(text);
      detail = json?.errorText || json?.message || json?.title || detail;
    } catch {
      // keep text slice
    }

    if (response.ok) {
      return { ok: true, status: response.status, detail: 'OK' };
    }

    if (response.status === 401) {
      return { ok: false, status: 401, error: 'Токен недействителен или истёк' };
    }
    if (response.status === 403) {
      return {
        ok: false,
        status: 403,
        error: 'Нет доступа — включите эту категорию при создании токена',
      };
    }

    return { ok: false, status: response.status, error: detail || `HTTP ${response.status}` };
  } catch (err) {
    return { ok: false, status: 0, error: err.message || 'Сетевая ошибка' };
  }
}

/** Проверка одной категории токена через /ping соответствующего API. */
export async function probeWbTokenScope(token, scopeId) {
  const scope = getFeedbackTokenScope(scopeId);
  if (!scope) {
    return { scopeId, ok: false, error: 'Неизвестная категория' };
  }

  const ping = await wbProbe(token, `https://${scope.apiHost}/ping`);
  let functional = null;

  if (scopeId === 'feedbacks' && ping.ok) {
    functional = await wbProbe(
      token,
      `https://${scope.apiHost}/api/v1/feedbacks/count-unanswered`
    );
  }

  if (scopeId === 'content' && ping.ok) {
    functional = await wbProbe(token, `https://${scope.apiHost}/content/v2/get/cards/list?limit=1`, {
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

  if (scopeId === 'prices' && ping.ok) {
    functional = await wbProbe(
      token,
      `https://${scope.apiHost}/api/v2/list/goods/filter?limit=1`
    );
  }

  if (scopeId === 'statistics' && ping.ok) {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const dateFrom = start.toISOString().slice(0, 10);
    functional = await wbProbe(
      token,
      `https://${scope.apiHost}/api/v5/supplier/reportDetailByPeriod?dateFrom=${dateFrom}&limit=1&rrdid=0`
    );
  }

  const ok = ping.ok && (!functional || functional.ok);

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
    error: ok ? undefined : functional?.error || ping.error,
  };
}

/** Проверка всех категорий, нужных для отзывов. */
export async function probeWbFeedbacksTokenScopes(token) {
  const results = await Promise.all(
    WB_FEEDBACKS_TOKEN_SCOPES.map((scope) => probeWbTokenScope(token, scope.id))
  );

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
