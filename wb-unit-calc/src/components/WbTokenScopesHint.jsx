import { useCallback, useState } from 'react';
import { readJsonResponse } from '../lib/http';

/** Категории токена WB для вкладки «Отзывы» (дублирует lib/wb-token-scopes.js для UI). */
export const FEEDBACKS_TOKEN_CATEGORIES = [
  {
    label: 'Вопросы и отзывы',
    required: true,
    purpose: 'Список, счётчик, просмотр и ответ на отзывы',
  },
  {
    label: 'Контент',
    recommended: true,
    purpose: 'Описание, характеристики, артикул, nmId — для AI-черновика',
  },
  {
    label: 'Цены и скидки',
    recommended: true,
    purpose: 'Цена товара и дорогих аналогов для премиум-апселла',
  },
  {
    label: 'Статистика',
    optional: true,
    purpose: 'Рейтинг SKU в каталоге (опционально)',
  },
];

export default function WbTokenScopesHint({
  token,
  compact = false,
  showCheckButton = true,
  title = 'Категории токена WB для отзывов',
  className = '',
}) {
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [checkError, setCheckError] = useState('');

  const runCheck = useCallback(async () => {
    if (!token) {
      setCheckError('Сначала добавьте API-ключ WB.');
      return;
    }
    setChecking(true);
    setCheckError('');
    setCheckResult(null);
    try {
      const response = await fetch('/api/unit-calc/feedbacks-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const { data: payload } = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Проверка не удалась');
      setCheckResult(payload);
    } catch (err) {
      setCheckError(err.message || 'Ошибка проверки');
    } finally {
      setChecking(false);
    }
  }, [token]);

  const scopeStatus = (label) => {
    const found = checkResult?.scopes?.find((s) => s.label === label);
    if (!found) return null;
    return found.ok ? 'ok' : 'fail';
  };

  return (
    <div
      className={`${className} ${compact ? 'text-xs text-slate-500' : 'rounded-lg border border-slate-100 bg-slate-50 px-3 py-3'}`.trim()}
    >
      {!compact ? <p className="text-xs font-semibold text-slate-700">{title}</p> : null}

      <ul className={`${compact ? 'mt-1' : 'mt-2'} space-y-1.5`}>
        {FEEDBACKS_TOKEN_CATEGORIES.map((cat) => {
          const status = scopeStatus(cat.label);
          return (
            <li key={cat.label} className="flex gap-2 text-xs text-slate-600">
              <span className="mt-0.5 shrink-0" aria-hidden>
                {status === 'ok' ? (
                  <span className="text-emerald-600">✓</span>
                ) : status === 'fail' ? (
                  <span className="text-rose-600">✗</span>
                ) : cat.required ? (
                  <span className="text-rose-500">●</span>
                ) : cat.recommended ? (
                  <span className="text-amber-500">○</span>
                ) : (
                  <span className="text-slate-300">·</span>
                )}
              </span>
              <span>
                <strong className="font-medium text-slate-700">{cat.label}</strong>
                {cat.required ? (
                  <span className="ml-1 text-rose-600">обязательно</span>
                ) : cat.recommended ? (
                  <span className="ml-1 text-amber-600">рекомендуется</span>
                ) : (
                  <span className="ml-1 text-slate-400">опционально</span>
                )}
                {' — '}
                {cat.purpose}
              </span>
            </li>
          );
        })}
      </ul>

      {!compact ? (
        <p className="mt-2 text-xs text-slate-400">
          Создайте токен в ЛК WB: Профиль → Настройки → Доступ к API. Включите только нужные категории.
        </p>
      ) : null}

      {showCheckButton ? (
        <div className={`${compact ? 'mt-2' : 'mt-3'} flex flex-wrap items-center gap-2`}>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={checking || !token}
            onClick={runCheck}
          >
            {checking ? 'Проверка…' : 'Проверить права токена'}
          </button>
          {checkResult?.summary ? (
            <span
              className={`text-xs ${checkResult.allRequiredOk ? 'text-emerald-700' : 'text-amber-700'}`}
            >
              {checkResult.summary}
            </span>
          ) : null}
        </div>
      ) : null}

      {checkError ? <p className="mt-2 text-xs text-rose-600">{checkError}</p> : null}
    </div>
  );
}
