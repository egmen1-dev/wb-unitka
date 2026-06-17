import { useCallback, useEffect, useState } from 'react';
import { readJsonResponse } from '../lib/http';
import {
  getCachedScopeCheck,
  markScopeCheckStarted,
  setCachedScopeCheck,
} from '../lib/feedbacks-cache';

/** Категории токена WB для вкладки «Отзывы» (дублирует lib/wb-token-scopes.js для UI). */
export const FEEDBACKS_TOKEN_CATEGORIES = [
  {
    id: 'feedbacks',
    label: 'Вопросы и отзывы',
    required: true,
    purpose: 'Список, счётчик, просмотр и ответ на отзывы',
    withoutScope: 'Вкладка не работает: нельзя загрузить отзывы и отправить ответ',
  },
  {
    id: 'content',
    label: 'Контент',
    required: true,
    purpose: 'Артикул, характеристики, описание, nmId, subjectId — для AI-черновика',
    withoutScope: 'Черновик по названию из каталога, без описания и характеристик с WB',
  },
  {
    id: 'prices',
    label: 'Цены и скидки',
    recommended: true,
    purpose: 'Цена товара и дорогих аналогов для премиум-апселла',
    withoutScope: 'Апселл по артикулу без цены и дельты «+N ₽ к текущему»',
  },
  {
    id: 'statistics',
    label: 'Статистика',
    optional: true,
    purpose: 'Сводный рейтинг SKU в каталоге',
    withoutScope: 'Рейтинг в отзыве есть из API отзывов; сводный рейтинг SKU не обновится',
  },
];

export default function WbTokenScopesHint({
  token,
  compact = false,
  collapsible = false,
  defaultOpen = false,
  showCheckButton = true,
  autoCheckOnLoad = false,
  className = '',
  title = 'Категории токена WB для отзывов',
}) {
  const [open, setOpen] = useState(!collapsible || defaultOpen);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [checkError, setCheckError] = useState('');

  const runCheck = useCallback(async ({ force = false } = {}) => {
    if (!token) {
      setCheckError('Сначала добавьте API-ключ WB.');
      return;
    }

    if (!force) {
      const cached = getCachedScopeCheck();
      if (cached) {
        setCheckResult(cached);
        return;
      }
    }

    setChecking(true);
    setCheckError('');
    setCheckResult(null);
    markScopeCheckStarted();
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
      if (!response.ok) {
        if (response.status === 429 || payload?.code === 'RATE_LIMIT') {
          const sec = Number(payload?.retryAfterSec) || 5;
          throw new Error(`Слишком много запросов к WB, подождите ${sec} сек`);
        }
        throw new Error(payload.error || 'Проверка не удалась');
      }
      setCheckResult(payload);
      setCachedScopeCheck(payload);
    } catch (err) {
      setCheckError(err.message || 'Ошибка проверки');
    } finally {
      setChecking(false);
    }
  }, [token]);

  useEffect(() => {
    if (!autoCheckOnLoad || !token) return undefined;

    const cached = getCachedScopeCheck();
    if (cached) {
      setCheckResult(cached);
      return undefined;
    }

    const timer = setTimeout(() => runCheck(), 3000);
    return () => clearTimeout(timer);
  }, [autoCheckOnLoad, token, runCheck]);

  const scopeResult = (label) => checkResult?.scopes?.find((s) => s.label === label) || null;

  const scopeStatus = (label) => {
    const found = scopeResult(label);
    if (!found) return null;
    return found.ok ? 'ok' : 'fail';
  };

  const categories = checkResult?.categories?.length
    ? checkResult.categories.map((cat) => ({
        id: cat.id,
        label: cat.label,
        required: cat.required,
        recommended: cat.recommended,
        optional: cat.optional,
        purpose: cat.purpose,
        withoutScope: cat.withoutScope,
      }))
    : FEEDBACKS_TOKEN_CATEGORIES;

  const list = (
    <ul className={`${compact ? 'mt-1' : 'mt-2'} space-y-2`}>
      {categories.map((cat) => {
        const status = scopeStatus(cat.label);
        const probe = scopeResult(cat.label);
        const badge = cat.required
          ? 'обязательно'
          : cat.recommended
            ? 'рекомендуется'
            : 'опционально';
        const badgeClass = cat.required
          ? 'text-rose-600'
          : cat.recommended
            ? 'text-amber-600'
            : 'text-slate-400';

        return (
          <li key={cat.id || cat.label} className="flex gap-2 text-xs text-slate-600">
            <span className="mt-0.5 shrink-0" aria-hidden>
              {status === 'ok' ? (
                <span className="text-emerald-600" title="Доступ есть">
                  ✓
                </span>
              ) : status === 'fail' ? (
                <span className="text-rose-600" title="Нет доступа">
                  ✗
                </span>
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
              <span className={`ml-1 ${badgeClass}`}>{badge}</span>
              {' — '}
              {cat.purpose}
              {status === 'fail' && cat.withoutScope ? (
                <span className="mt-0.5 block text-slate-400">Без права: {cat.withoutScope}</span>
              ) : null}
              {status === 'fail' && probe?.error ? (
                <details className="mt-0.5 text-slate-400">
                  <summary className="cursor-pointer select-none">Детали проверки</summary>
                  <span className="mt-0.5 block font-mono text-[10px] leading-snug text-slate-500">
                    {probe.error}
                    {probe.functional?.status ? ` · API ${probe.functional.status}` : ''}
                    {probe.ping?.status ? ` · ping ${probe.ping.status}` : ''}
                  </span>
                </details>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );

  const body = (
    <>
      {list}

      {!compact ? (
        <p className="mt-2 text-xs text-slate-400">
          Создайте токен в ЛК WB: Профиль → Настройки → Доступ к API. Включите нужные категории.
        </p>
      ) : null}

      {showCheckButton ? (
        <div className={`${compact ? 'mt-2' : 'mt-3'} flex flex-wrap items-center gap-2`}>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={checking || !token}
            onClick={() => runCheck({ force: true })}
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
    </>
  );

  if (collapsible) {
    return (
      <div className={`rounded-lg border border-slate-100 bg-slate-50 ${className}`.trim()}>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span>{title}</span>
          <span className="text-slate-400">{open ? '▾' : '▸'}</span>
        </button>
        {open ? <div className="border-t border-slate-100 px-3 pb-3">{body}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={
        compact
          ? `text-xs text-slate-500 ${className}`.trim()
          : `rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 ${className}`.trim()
      }
    >
      {!compact ? <p className="text-xs font-semibold text-slate-700">{title}</p> : null}
      {body}
    </div>
  );
}
