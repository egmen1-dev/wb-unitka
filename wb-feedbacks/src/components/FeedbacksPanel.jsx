import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtMoney } from '../lib/format';
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, readJsonResponse } from '../lib/http';
import {
  clearFeedbacksRateLimit,
  formatCacheBadge,
  getCachedFeedbacksList,
  getCachedUnansweredCount,
  getFeedbacksRateLimitSecondsLeft,
  isFeedbacksRateLimited,
  setCachedFeedbacksList,
  setCachedUnansweredCount,
  setFeedbacksRateLimited,
} from '../lib/feedbacks-cache';

const PAGE_SIZE = 100;
const LOADING_WATCHDOG_MS = DEFAULT_FETCH_TIMEOUT_MS;

function Stars({ rating }) {
  const n = Math.max(0, Math.min(5, Number(rating) || 0));
  return (
    <span className="text-amber-500" title={`${n} из 5`}>
      {'★'.repeat(n)}
      <span className="text-slate-300">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function qualityBadgeClass(score, templateLike) {
  if (templateLike || score < 50) return 'bg-rose-100 text-rose-800';
  if (score < 75) return 'bg-amber-100 text-amber-800';
  return 'bg-emerald-100 text-emerald-800';
}

function QualityBadge({ quality }) {
  if (!quality || quality.score == null) return null;
  const label = quality.templateLike
    ? `Шаблонно · ${quality.score}%`
    : quality.ok
      ? `Качество ${quality.score}%`
      : `Слабо · ${quality.score}%`;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${qualityBadgeClass(quality.score, quality.templateLike)}`}
      title={quality.issues?.length ? quality.issues.join('; ') : 'Ответ прошёл проверку качества'}
    >
      {label}
    </span>
  );
}

function scenarioBadgeClass(tone) {
  if (tone === 'positive') return 'bg-emerald-100 text-emerald-800';
  if (tone === 'negative') return 'bg-rose-100 text-rose-800';
  return 'bg-amber-100 text-amber-800';
}

function managerLabelTone(label) {
  if (label === 'похвала') return 'positive';
  if (label === 'жалоба' || label === 'брак') return 'negative';
  return 'neutral';
}

function ScenarioBadge({ scenario }) {
  const displayLabel = scenario?.managerLabel || scenario?.label;
  if (!displayLabel) return null;
  const tone = scenario?.tone || managerLabelTone(scenario?.managerLabel);
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${scenarioBadgeClass(tone)}`}
      title={
        scenario?.label && scenario?.managerLabel && scenario.label !== scenario.managerLabel
          ? `${displayLabel} · ${scenario.label}`
          : scenario.keywords?.length
            ? `Ключевые слова: ${scenario.keywords.join(', ')}`
            : displayLabel
      }
    >
      {displayLabel}
    </span>
  );
}

function PreviewModal({ feedback, draft, onClose, onSend, sending }) {
  if (!feedback || !draft) return null;

  const upsell = draft.premiumUpsell || draft.alternative;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-800">Предпросмотр ответа</h3>
            <ScenarioBadge scenario={draft.scenario} />
          </div>
          <p className="mt-1 text-xs text-slate-500">Так ответ увидит покупатель на WB после модерации</p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2">
              <Stars rating={feedback.rating} />
              <span className="text-xs text-slate-500">{formatDate(feedback.createdDate)}</span>
            </div>
            <p className="mt-1 text-xs font-medium text-slate-700">
              {feedback.productName}
              {feedback.article ? ` · арт. ${feedback.article}` : ''}
            </p>
            {feedback.text ? (
              <p className="mt-2 text-xs italic text-slate-600">«{feedback.text}»</p>
            ) : null}
          </div>

          <div className="rounded-lg border border-brand-200 bg-brand-50/50 px-4 py-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{draft.text}</p>
            {draft.provider || draft.source ? (
              <p className="mt-2 text-xs text-slate-400">
                Источник: {formatProviderLabel(draft.provider, draft.source)}
              </p>
            ) : null}
          </div>

          {upsell?.article ? (
            <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs text-slate-600">
              <p className="font-medium text-slate-700">Рекомендованный SKU</p>
              <p className="mt-1">
                арт. <span className="font-mono">{upsell.article}</span> — {upsell.title}
              </p>
              {upsell.priceLabel || upsell.price ? (
                <p className="mt-0.5 text-slate-500">
                  {upsell.priceLabel || fmtMoney(upsell.price)}
                  {upsell.priceDelta > 0 ? ` (+${fmtMoney(upsell.priceDelta)} к текущему)` : ''}
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="text-xs text-slate-400">
            {draft.text?.length || 0} / 1000 символов
            {draft.source ? ` · ${draft.source}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>
            Назад к правке
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={sending || !draft.text?.trim()}
            onClick={onSend}
          >
            {sending ? 'Отправка…' : 'Отправить в WB'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatRateLimitError(payload, status) {
  if (status === 429 || payload?.code === 'RATE_LIMIT') {
    const sec = Number(payload?.retryAfterSec) || 5;
    return `Слишком много запросов к WB, подождите ${sec} сек`;
  }
  return null;
}

function formatAiConfigLabel({ yandexConfigured, openaiConfigured, loading, apiCheckStatus }) {
  if (loading) return 'Проверка настроек AI на сервере…';
  if (yandexConfigured && openaiConfigured) {
    return 'AI: YandexGPT и OpenAI подключены на сервере';
  }
  if (yandexConfigured) return 'AI: YandexGPT подключён на сервере';
  if (openaiConfigured) return 'AI: OpenAI подключён на сервере';
  if (apiCheckStatus === 'html') {
    return 'AI: API не отвечает JSON — проверьте деплой';
  }
  return 'AI не настроен на сервере — используется шаблон';
}

function formatApiCheckDiagnostic({ apiCheckStatus, endpoint, error }) {
  if (apiCheckStatus === 'pending') return 'API ai-config-check: отложена (не блокирует загрузку)';
  if (apiCheckStatus === 'loading') return 'API ai-config-check: проверка…';
  if (apiCheckStatus === 'ok') {
    return `API ai-config-check: OK (${endpoint || 'feedbacks-check'})`;
  }
  if (apiCheckStatus === 'inferred') {
    return 'API ai-config-check: OK (подтверждено генерацией черновика)';
  }
  if (apiCheckStatus === 'html') {
    return 'API ai-config-check: HTML вместо JSON — переразверните проект';
  }
  if (apiCheckStatus === 'error') {
    return `API ai-config-check: ошибка${error ? ` — ${error}` : ''}`;
  }
  return 'API ai-config-check: 404 / недоступен';
}

async function fetchAiConfigStatus() {
  const endpoints = [
    { path: '/api/feedbacks/feedbacks-check', label: 'feedbacks-check' },
    { path: '/api/feedbacks/ai-config-check', label: 'ai-config-check' },
  ];

  let lastHtmlError = null;

  for (const { path, label } of endpoints) {
    try {
      const response = await fetchWithTimeout(path, { method: 'GET' });
      const { data: payload } = await readJsonResponse(response);
      if (!response.ok) continue;
      if (payload?.action === 'ai-config' || payload?.yandexConfigured != null) {
        return {
          yandexConfigured: Boolean(payload?.yandexConfigured),
          openaiConfigured: Boolean(payload?.openaiConfigured),
          envPresent: payload?.envPresent || null,
          loading: false,
          error: '',
          apiCheckStatus: 'ok',
          endpoint: label,
        };
      }
    } catch (err) {
      if (err?.raw?.startsWith?.('<!DOCTYPE') || err?.raw?.startsWith?.('<html')) {
        lastHtmlError = {
          yandexConfigured: false,
          openaiConfigured: false,
          envPresent: null,
          loading: false,
          error: err.message || 'Сервер вернул HTML вместо JSON',
          apiCheckStatus: 'html',
          endpoint: label,
        };
        continue;
      }
    }
  }

  if (lastHtmlError) return lastHtmlError;

  return {
    yandexConfigured: false,
    openaiConfigured: false,
    envPresent: null,
    loading: false,
    error: 'Не удалось проверить AI на сервере',
    apiCheckStatus: 'error',
    endpoint: '',
  };
}

function formatProviderLabel(provider, source) {
  if (provider === 'yandex' || source?.startsWith('yandex')) return 'YandexGPT';
  if (provider === 'openai' || source?.startsWith('openai')) return 'OpenAI';
  if (source === 'ai-error' || provider === 'ai-error') return 'ошибка AI';
  if (provider === 'template' || source?.startsWith('template')) return 'шаблон';
  return provider || '—';
}

function formatDraftStatus(payload, { regenerate = false } = {}) {
  if (payload.hint && payload.error) return payload.error;
  if (payload.hint) return payload.hint;
  if (regenerate) {
    const label = formatProviderLabel(payload.provider, payload.source);
    return `Новый вариант готов (${label})`;
  }
  const label = formatProviderLabel(payload.provider, payload.source);
  if (payload.provider === 'yandex' || payload.source?.startsWith('yandex')) {
    return `Черновик сгенерирован (${label})`;
  }
  if (payload.provider === 'openai' || payload.source?.startsWith('openai')) {
    return `Черновик сгенерирован (${label})`;
  }
  if (payload.source === 'ai-error') {
    return 'Ошибка генерации AI';
  }
  if (payload.yandexConfigured || payload.openaiConfigured) {
    return 'Черновик по шаблону (ошибка AI)';
  }
  return `Черновик по шаблону (${label})`;
}

function formatApiError(payload, status, fallback = 'Не удалось загрузить отзывы') {
  const rateMsg = formatRateLimitError(payload, status);
  if (rateMsg) return rateMsg;
  const parts = [payload?.error, payload?.hint, payload?.detail].filter(Boolean);
  if (parts.length) return parts.join('. ');
  return fallback;
}

export default function FeedbacksPanel({ token }) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [generatingId, setGeneratingId] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [previewId, setPreviewId] = useState(null);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);
  const [aiConfig, setAiConfig] = useState({
    yandexConfigured: false,
    openaiConfigured: false,
    envPresent: null,
    loading: false,
    error: '',
    apiCheckStatus: 'pending',
    endpoint: '',
  });
  const [cacheBadge, setCacheBadge] = useState('');
  const refreshLockRef = useRef(false);
  const refreshDebounceRef = useRef(null);
  const loadAttemptRef = useRef(0);
  const hasDataRef = useRef(false);
  const dataRef = useRef(null);
  const loadInFlightRef = useRef(false);
  const backgroundInFlightRef = useRef(false);
  const autoRetryTimerRef = useRef(null);
  const abortRef = useRef(null);
  const bgAbortRef = useRef(null);
  const loadingWatchdogRef = useRef(null);

  const clearLoadingWatchdog = useCallback(() => {
    if (loadingWatchdogRef.current) {
      clearTimeout(loadingWatchdogRef.current);
      loadingWatchdogRef.current = null;
    }
  }, []);

  const startLoadingWatchdog = useCallback(() => {
    clearLoadingWatchdog();
    loadingWatchdogRef.current = setTimeout(() => {
      abortRef.current?.abort();
      loadInFlightRef.current = false;
      setLoading(false);
      setLoadingMore(false);
      setError('Загрузка заняла слишком много времени (30 сек). Попробуйте ещё раз.');
    }, LOADING_WATCHDOG_MS);
  }, [clearLoadingWatchdog]);

  const waitForRateLimit = useCallback(async () => {
    if (!isFeedbacksRateLimited()) return;
    const sec = getFeedbacksRateLimitSecondsLeft();
    if (sec <= 0) {
      clearFeedbacksRateLimit();
      return;
    }
    setRateLimitCountdown(sec);
    setError(`Слишком много запросов к WB, повтор через ${sec} сек…`);
    await new Promise((resolve) => {
      autoRetryTimerRef.current = setTimeout(resolve, sec * 1000);
    });
    clearFeedbacksRateLimit();
    setRateLimitCountdown(0);
  }, []);

  const loadFeedbacks = useCallback(
    async ({ force = false, isRetry = false, append = false, skip = 0, background = false } = {}) => {
      if (!token) {
        setError('Вставьте токен WB с категорией «Вопросы и отзывы».');
        return;
      }

      if (background) {
        if (backgroundInFlightRef.current || loadInFlightRef.current) return;
      } else if (loadInFlightRef.current && !append) {
        return;
      }

      if (!force && !isRetry && !append && isFeedbacksRateLimited()) {
        if (loadAttemptRef.current < 1) {
          loadAttemptRef.current += 1;
          setLoading(true);
          startLoadingWatchdog();
          try {
            await waitForRateLimit();
            return await loadFeedbacks({ force: true, isRetry: true });
          } finally {
            clearLoadingWatchdog();
            setLoading(false);
          }
        }
        const sec = getFeedbacksRateLimitSecondsLeft();
        setRateLimitCountdown(sec);
        setError(`Слишком много запросов к WB, подождите ${sec} сек`);
        setLoading(false);
        loadInFlightRef.current = false;
        return;
      }

      const cachedCount = getCachedUnansweredCount();
      if (!force && !append && cachedCount != null) {
        setStatus(`Без ответа: ${cachedCount}`);
      }

      const signalRef = background ? bgAbortRef : abortRef;

      if (append) {
        setLoadingMore(true);
      } else if (background) {
        bgAbortRef.current?.abort();
        bgAbortRef.current = new AbortController();
        backgroundInFlightRef.current = true;
        setRefreshing(true);
      } else {
        bgAbortRef.current?.abort();
        backgroundInFlightRef.current = false;
        setRefreshing(false);
        abortRef.current?.abort();
        abortRef.current = new AbortController();
        loadInFlightRef.current = true;
        setLoading(true);
        startLoadingWatchdog();
      }
      if (!isRetry && !append && !background) setError('');
      if ((!cachedCount || force) && !append && !background) setStatus('');
      try {
        const response = await fetchWithTimeout(
          '/api/feedbacks/feedbacks',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action: 'list', take: PAGE_SIZE, skip }),
            signal: signalRef.current?.signal,
          },
          LOADING_WATCHDOG_MS
        );
        const { data: payload } = await readJsonResponse(response);
        if (!response.ok) {
          if (response.status === 429 || payload?.code === 'RATE_LIMIT') {
            const sec = Number(payload?.retryAfterSec) || 5;
            setFeedbacksRateLimited(sec);
            setRateLimitCountdown(sec);
            if (!isRetry && loadAttemptRef.current < 1) {
              loadAttemptRef.current += 1;
              if (!background) {
                setError(`Слишком много запросов к WB, повтор через ${sec} сек…`);
              }
              if (append) setLoadingMore(false);
              else if (background) {
                setRefreshing(false);
                backgroundInFlightRef.current = false;
              } else {
                setLoading(false);
                loadInFlightRef.current = false;
              }
              await new Promise((resolve) => {
                autoRetryTimerRef.current = setTimeout(resolve, sec * 1000);
              });
              return loadFeedbacks({ force: true, isRetry: true, append, skip, background });
            }
          }
          throw new Error(formatApiError(payload, response.status));
        }
        clearFeedbacksRateLimit();
        loadAttemptRef.current = 0;
        setRateLimitCountdown(0);
        hasDataRef.current = true;
        let mergedPayload = payload;
        if (append && dataRef.current) {
          const seen = new Set((dataRef.current.feedbacks || []).map((fb) => fb.id));
          const merged = [...(dataRef.current.feedbacks || [])];
          for (const fb of payload.feedbacks || []) {
            if (!seen.has(fb.id)) merged.push(fb);
          }
          mergedPayload = { ...payload, feedbacks: merged };
        }
        dataRef.current = mergedPayload;
        setData(mergedPayload);
        const count = mergedPayload.countUnanswered ?? mergedPayload.feedbacks?.length ?? 0;
        setCachedFeedbacksList(token, {
          feedbacks: mergedPayload.feedbacks || [],
          countUnanswered: count,
          hasMore: mergedPayload.hasMore ?? count > (mergedPayload.feedbacks?.length || 0),
        });
        setCachedUnansweredCount(count);
        setCacheBadge('');
        setStatus(`Без ответа: ${count}`);
      } catch (err) {
        if (err?.message === 'Запрос отменён') return;
        if (background && hasDataRef.current) {
          const badge = formatCacheBadge(getCachedFeedbacksList(token));
          if (badge) setCacheBadge(badge);
          return;
        }
        setError(err.message || 'Ошибка загрузки');
      } finally {
        if (append) setLoadingMore(false);
        else if (background) {
          setRefreshing(false);
          backgroundInFlightRef.current = false;
        } else {
          clearLoadingWatchdog();
          setLoading(false);
          loadInFlightRef.current = false;
        }
      }
    },
    [token, waitForRateLimit, startLoadingWatchdog, clearLoadingWatchdog]
  );

  const loadMoreFeedbacks = useCallback(() => {
    const current = data?.feedbacks?.length || 0;
    if (loadingMore || loading) return;
    loadFeedbacks({ force: true, append: true, skip: current });
  }, [data?.feedbacks?.length, loadFeedbacks, loading, loadingMore]);

  const debouncedRefresh = useCallback(() => {
    if (refreshLockRef.current || loading) return;
    if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    refreshDebounceRef.current = setTimeout(() => {
      refreshLockRef.current = true;
      loadFeedbacks({ force: true }).finally(() => {
        refreshLockRef.current = false;
      });
    }, 400);
  }, [loadFeedbacks, loading]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setAiConfig((prev) => ({ ...prev, loading: true, apiCheckStatus: 'loading' }));
      (async () => {
        const result = await fetchAiConfigStatus();
        if (!cancelled) setAiConfig(result);
      })();
    }, 5000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setData(null);
      dataRef.current = null;
      setCacheBadge('');
      setStatus('');
      setError('');
      setLoading(false);
      return undefined;
    }

    const cached = getCachedFeedbacksList(token);
    if (cached) {
      hasDataRef.current = true;
      const cachedData = {
        feedbacks: cached.feedbacks || [],
        countUnanswered: cached.countUnanswered ?? cached.feedbacks?.length ?? 0,
        hasMore: cached.hasMore ?? false,
      };
      dataRef.current = cachedData;
      setData(cachedData);
      const badge = formatCacheBadge(cached);
      setCacheBadge(badge);
      const count = cached.countUnanswered ?? cached.feedbacks?.length ?? 0;
      setStatus(badge ? `Без ответа: ${count} · ${badge}` : `Без ответа: ${count}`);
      setError('');
      setLoading(false);
      loadAttemptRef.current = 0;
      return undefined;
    }

    hasDataRef.current = false;
    dataRef.current = null;
    setData(null);
    const cachedCount = getCachedUnansweredCount();
    if (cachedCount != null) {
      setStatus(`Без ответа: ${cachedCount} · кэш, нажмите «Обновить»`);
    } else {
      setStatus('Нажмите «Обновить» для загрузки отзывов с WB');
    }
    setCacheBadge('');
    setError('');
    setLoading(false);
    loadAttemptRef.current = 0;
    return undefined;
  }, [token]);

  useEffect(() => {
    if (rateLimitCountdown <= 0) return undefined;
    const timer = setInterval(() => {
      const left = getFeedbacksRateLimitSecondsLeft();
      setRateLimitCountdown(left);
      if (left <= 0) clearFeedbacksRateLimit();
    }, 1000);
    return () => clearInterval(timer);
  }, [rateLimitCountdown]);

  useEffect(
    () => () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current);
      bgAbortRef.current?.abort();
      abortRef.current?.abort();
      clearLoadingWatchdog();
    },
    [clearLoadingWatchdog]
  );

  const requestDraft = useCallback(
    async (feedback, { regenerate = false } = {}) => {
      if (!feedback?.id) return;
      setGeneratingId(feedback.id);
      setError('');
      const variationSeed = Date.now() + Math.floor(Math.random() * 10000);
      try {
        const response = await fetchWithTimeout('/api/feedbacks/feedback-draft', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            feedback,
            catalogRows: [],
            regenerate,
            variationSeed,
          }),
        });
        const { data: payload } = await readJsonResponse(response);
        if (!response.ok) throw new Error(payload.error || 'Не удалось сгенерировать ответ');

        setDrafts((prev) => ({
          ...prev,
          [feedback.id]: {
            text: payload.draft || '',
            source: payload.source,
            provider: payload.provider || null,
            alternative: payload.alternative,
            premiumUpsell: payload.premiumUpsell,
            validation: payload.validation,
            quality: payload.quality || null,
            qualityRetried: payload.qualityRetried || false,
            hint: payload.hint,
            scenario: payload.scenario || null,
          },
        }));
        if (payload.provider === 'yandex' || payload.provider === 'openai') {
          setAiConfig((prev) => ({
            ...prev,
            yandexConfigured: prev.yandexConfigured || payload.provider === 'yandex' || payload.yandexConfigured,
            openaiConfigured: prev.openaiConfigured || payload.provider === 'openai' || payload.openaiConfigured,
            loading: false,
            error: '',
            apiCheckStatus: prev.apiCheckStatus === 'ok' ? 'ok' : 'inferred',
          }));
        }
        setExpandedId(feedback.id);
        setStatus(formatDraftStatus(payload, { regenerate }));
      } catch (err) {
        setError(err.message || 'Ошибка генерации');
      } finally {
        setGeneratingId(null);
      }
    },
    [token]
  );

  const generateDraft = useCallback((feedback) => requestDraft(feedback, { regenerate: false }), [requestDraft]);
  const regenerateDraft = useCallback(
    (feedback) => requestDraft(feedback, { regenerate: true }),
    [requestDraft]
  );

  const sendAnswer = useCallback(
    async (feedback) => {
      const draft = drafts[feedback.id]?.text?.trim();
      if (!draft) {
        setError('Сначала сгенерируйте или введите текст ответа.');
        return;
      }
      if (!token) {
        setError('Вставьте токен WB.');
        return;
      }

      setSendingId(feedback.id);
      setError('');
      try {
        const response = await fetchWithTimeout('/api/feedbacks/feedbacks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: 'answer',
            feedbackId: feedback.id,
            text: draft,
          }),
        });
        const { data: payload } = await readJsonResponse(response);
        if (!response.ok) {
          if (response.status === 429 || payload?.code === 'RATE_LIMIT') {
            const sec = Number(payload?.retryAfterSec) || 5;
            setFeedbacksRateLimited(sec);
            setRateLimitCountdown(sec);
            throw new Error(`Слишком много запросов к WB, подождите ${sec} сек`);
          }
          throw new Error(payload.error || 'Не удалось отправить ответ');
        }

        setStatus(payload.verified ? 'Ответ отправлен и подтверждён в WB' : 'Ответ отправлен');
        setPreviewId(null);
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[feedback.id];
          return next;
        });
        await loadFeedbacks({ force: true });
      } catch (err) {
        setError(err.message || 'Ошибка отправки');
      } finally {
        setSendingId(null);
      }
    },
    [token, drafts, loadFeedbacks]
  );

  const feedbacks = data?.feedbacks || [];
  const countUnanswered = data?.countUnanswered ?? 0;
  const hasMore = countUnanswered > feedbacks.length || (data?.hasMore ?? false);
  const previewFeedback = previewId ? feedbacks.find((fb) => fb.id === previewId) : null;
  const previewDraft = previewId ? drafts[previewId] : null;

  if (!token) {
    return (
      <section className="panel text-sm text-slate-600">
        Сохраните токен WB выше — затем здесь появятся неотвеченные отзывы.
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
              Неотвеченные отзывы
              {countUnanswered > 0 ? (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                  {countUnanswered}
                </span>
              ) : null}
              {cacheBadge ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                  {cacheBadge}
                </span>
              ) : null}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              AI-черновики с апселлом. Предпросмотр и перегенерация — отправка только вручную.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={loading}
            onClick={debouncedRefresh}
          >
            {loading ? 'Загрузка…' : refreshing ? 'Обновление…' : 'Обновить'}
          </button>
        </div>

        <details className="mt-3 text-xs text-slate-500">
          <summary className="cursor-pointer text-slate-600 hover:text-slate-800">
            {formatAiConfigLabel(aiConfig)}
          </summary>
          <div className="mt-2 space-y-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-slate-600">
            <p className="font-mono text-[10px] text-slate-500">
              {formatApiCheckDiagnostic(aiConfig)}
            </p>
            <p>
              <span className="font-medium text-slate-700">YandexGPT: </span>
              {aiConfig.loading
                ? 'проверка…'
                : aiConfig.yandexConfigured
                  ? 'подключён'
                  : 'не подключён'}
            </p>
            {!aiConfig.loading && !aiConfig.yandexConfigured ? (
              <p>
                {aiConfig.apiCheckStatus === 'html' ? (
                  <>
                    Эндпоинт проверки AI не развёрнут — переразверните проект в Vercel. Если после деплоя
                    генерация черновиков работает (YandexGPT), ключи уже заданы.
                  </>
                ) : (
                  <>
                    В Vercel задайте <code className="rounded bg-white px-1">YANDEX_GPT_API_KEY</code> или{' '}
                    <code className="rounded bg-white px-1">YANDEX_CLOUD_API_KEY</code> и{' '}
                    <code className="rounded bg-white px-1">YANDEX_FOLDER_ID</code>.
                  </>
                )}
              </p>
            ) : null}
            <p>
              <span className="font-medium text-slate-700">OpenAI: </span>
              {aiConfig.loading
                ? 'проверка…'
                : aiConfig.openaiConfigured
                  ? 'подключён'
                  : 'не подключён'}
            </p>
            {!aiConfig.loading && !aiConfig.openaiConfigured ? (
              <p>
                Опционально: <code className="rounded bg-white px-1">OPENAI_API_KEY</code> в Vercel.
              </p>
            ) : null}
            {aiConfig.error ? (
              <p className="text-rose-600">
                <span className="font-medium text-rose-700">Ошибка проверки: </span>
                {aiConfig.error}
              </p>
            ) : null}
            {aiConfig.envPresent ? (
              <div className="rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-[10px] text-slate-500">
                <p className="mb-1 font-sans text-[10px] font-medium text-slate-600">
                  Переменные на сервере (только да/нет):
                </p>
                {Object.entries(aiConfig.envPresent).map(([key, present]) => (
                  <p key={key}>
                    {key}: {present ? 'да' : 'нет'}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </details>

        {error ? (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <p>{error}</p>
            <button
              type="button"
              className="btn-secondary mt-2 text-xs"
              disabled={loading || rateLimitCountdown > 0}
              onClick={() => {
                loadAttemptRef.current = 0;
                clearFeedbacksRateLimit();
                loadFeedbacks({ force: true });
              }}
            >
              {rateLimitCountdown > 0 ? `Повторить через ${rateLimitCountdown} сек` : 'Повторить загрузку'}
            </button>
          </div>
        ) : null}
        {status ? <p className="mt-2 text-xs text-slate-600">{status}</p> : null}
      </section>

      {!loading && feedbacks.length === 0 && !error ? (
        <section className="panel text-sm text-slate-600">
          {data
            ? 'Нет неотвеченных отзывов — отлично!'
            : 'Отзывы не загружены. Нажмите «Обновить» для запроса к WB.'}
        </section>
      ) : null}

      {loading && feedbacks.length === 0 ? (
        <section className="panel text-sm text-slate-600">Загрузка отзывов…</section>
      ) : null}

      <div className="flex flex-col gap-3">
        {feedbacks.map((fb) => {
          const draft = drafts[fb.id];
          const isOpen = expandedId === fb.id || Boolean(draft?.text);
          const upsell = draft?.premiumUpsell || draft?.alternative;

          return (
            <article key={fb.id} className="panel">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stars rating={fb.rating} />
                    <span className="text-xs text-slate-500">{formatDate(fb.createdDate)}</span>
                    {fb.userName ? <span className="text-xs text-slate-500">· {fb.userName}</span> : null}
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    {fb.productName || 'Товар'}
                    {fb.article ? (
                      <span className="ml-2 font-normal text-slate-500">арт. {fb.article}</span>
                    ) : null}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-xs text-brand-700 underline"
                  onClick={() => setExpandedId(isOpen ? null : fb.id)}
                >
                  {isOpen ? 'Свернуть' : 'Ответить'}
                </button>
              </div>

              {fb.text ? <p className="mt-2 text-sm text-slate-700">{fb.text}</p> : null}
              {(fb.pros || fb.cons) && (
                <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                  {fb.pros ? (
                    <p>
                      <span className="font-medium text-emerald-700">+</span> {fb.pros}
                    </p>
                  ) : null}
                  {fb.cons ? (
                    <p>
                      <span className="font-medium text-rose-700">−</span> {fb.cons}
                    </p>
                  ) : null}
                </div>
              )}

              {isOpen ? (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {draft?.scenario ? <ScenarioBadge scenario={draft.scenario} /> : null}
                    {draft?.quality ? <QualityBadge quality={draft.quality} /> : null}
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      disabled={generatingId === fb.id}
                      onClick={() => generateDraft(fb)}
                    >
                      {generatingId === fb.id ? 'Генерация…' : 'Сгенерировать ответ'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      disabled={generatingId === fb.id || !draft?.text}
                      onClick={() => regenerateDraft(fb)}
                    >
                      Перегенерировать
                    </button>
                    <button
                      type="button"
                      className="btn-primary text-sm"
                      disabled={sendingId === fb.id || !draft?.text?.trim()}
                      onClick={() => setPreviewId(fb.id)}
                    >
                      Отправить в WB
                    </button>
                  </div>

                  {upsell?.article ? (
                    <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">SKU в ответе: </span>
                      арт. {upsell.article} — {upsell.title}
                    </div>
                  ) : null}

                  <textarea
                    className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
                    rows={5}
                    placeholder="Текст ответа (на «ты», 2–1000 символов)"
                    value={draft?.text || ''}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [fb.id]: { ...(prev[fb.id] || {}), text: e.target.value },
                      }))
                    }
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    {(draft?.text || '').length} / 1000
                    {draft?.provider || draft?.source ? (
                      <span className="ml-1 font-medium text-slate-500">
                        · {formatProviderLabel(draft?.provider, draft?.source)}
                      </span>
                    ) : null}
                    {draft?.qualityRetried ? (
                      <span className="ml-1 text-slate-400">· перегенераций: {draft.qualityRetried}</span>
                    ) : null}
                    {draft?.quality?.templateLike || (draft?.quality?.score != null && draft.quality.score < 60) ? (
                      <span className="ml-1 text-amber-600">
                        · перегенерируй, если звучит шаблонно
                      </span>
                    ) : null}
                    {draft?.quality?.issues?.length ? (
                      <span className="mt-0.5 block text-amber-600" title={draft.quality.issues.join('; ')}>
                        {draft.quality.issues.slice(0, 2).join(' · ')}
                      </span>
                    ) : null}
                  </p>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {hasMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={loading || loadingMore}
            onClick={loadMoreFeedbacks}
          >
            {loadingMore
              ? 'Загрузка…'
              : `Загрузить ещё (${feedbacks.length} из ${countUnanswered})`}
          </button>
        </div>
      ) : null}

      {previewFeedback && previewDraft ? (
        <PreviewModal
          feedback={previewFeedback}
          draft={previewDraft}
          sending={sendingId === previewFeedback.id}
          onClose={() => setPreviewId(null)}
          onSend={() => sendAnswer(previewFeedback)}
        />
      ) : null}
    </div>
  );
}
