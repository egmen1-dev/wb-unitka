import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFeedbacksApi, isRateLimitError } from '../lib/wb-api-queue';
import {
  getCachedScopeCheck,
  isFeedbacksReadRateLimited,
  getFeedbacksReadRateLimitSecondsLeft,
  setCachedScopeCheck,
  setFeedbacksRateLimited,
} from '../lib/feedbacks-cache';

export const FEEDBACKS_TOKEN_CATEGORIES = [
  {
    id: 'feedbacks',
    label: 'Вопросы и отзывы',
    required: true,
    purpose: 'Список, счётчик, просмотр и ответ на отзывы',
    withoutScope: 'Нельзя загрузить отзывы и отправить ответ',
  },
  {
    id: 'content',
    label: 'Контент',
    required: true,
    purpose: 'Артикул, характеристики, описание — для AI-черновика',
    withoutScope: 'Черновик только по названию из отзыва',
  },
  {
    id: 'prices',
    label: 'Цены и скидки',
    recommended: true,
    purpose: 'Цена товара и аналогов для премиум-апселла',
    withoutScope: 'Апселл без суммы «+N ₽»',
  },
  {
    id: 'statistics',
    label: 'Статистика',
    optional: true,
    purpose: 'Сводный рейтинг SKU',
    withoutScope: 'Рейтинг в отзыве есть из API отзывов',
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
  title = 'Категории токена WB',
}) {
  const [open, setOpen] = useState(!collapsible || defaultOpen);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [checkError, setCheckError] = useState('');
  const pendingCheckRef = useRef(false);

  const runCheck = useCallback(async ({ force = false } = {}) => {
    if (!token) {
      setCheckError('Сначала добавьте токен WB.');
      return;
    }

    if (!force && isFeedbacksReadRateLimited()) {
      const sec = getFeedbacksReadRateLimitSecondsLeft();
      pendingCheckRef.current = true;
      setCheckError(`В очереди · проверка через ${sec} сек`);
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
    pendingCheckRef.current = false;
    try {
      const { response, payload } = await fetchFeedbacksApi(
        '/api/feedbacks/feedbacks-check',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        },
        { kind: 'read' }
      );
      if (!response.ok) {
        throw new Error(payload.error || 'Проверка не удалась');
      }
      setCheckResult(payload);
      setCachedScopeCheck(payload);
    } catch (err) {
      if (isRateLimitError(err)) {
        const sec = Number(err.retryAfterSec) || 5;
        setFeedbacksRateLimited(sec, { kind: 'read' });
        pendingCheckRef.current = true;
        setCheckError(`В очереди · повтор через ${sec} сек…`);
      } else {
        setCheckError(err.message || 'Ошибка проверки');
      }
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

  useEffect(() => {
    if (!pendingCheckRef.current || checking || !token) return undefined;
    const sec = getFeedbacksReadRateLimitSecondsLeft();
    if (sec > 0) {
      const timer = setTimeout(() => {
        if (pendingCheckRef.current) runCheck({ force: true });
      }, sec * 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [checkError, checking, token, runCheck]);

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
        const badge = cat.required ? 'обязательно' : cat.recommended ? 'рекомендуется' : 'опционально';
        const badgeClass = cat.required
          ? 'text-rose-600'
          : cat.recommended
            ? 'text-amber-600'
            : 'text-slate-400';

        return (
          <li key={cat.id || cat.label} className="flex gap-2 text-xs text-slate-600">
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
              <span className={`ml-1 ${badgeClass}`}>{badge}</span>
              {' — '}
              {cat.purpose}
              {status === 'fail' && cat.withoutScope ? (
                <span className="mt-0.5 block text-slate-400">Без права: {cat.withoutScope}</span>
              ) : null}
              {status === 'fail' && probe?.error ? (
                <span className="mt-0.5 block font-mono text-[10px] text-slate-500">{probe.error}</span>
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
          ЛК WB → Профиль → Настройки → Доступ к API → включите нужные категории.
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
