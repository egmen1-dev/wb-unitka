import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_BUILD } from '../lib/app-build';
import {
  AUTO_REPLY_MAX_PER_HOUR,
  createAutoReplyScheduler,
  formatMinutes,
  getAutoReplyLog,
  getMsUntilNextSlot,
  getSentThisHour,
  loadAutoReplyEnabled,
  saveAutoReplyEnabled,
} from '../lib/auto-reply-scheduler';
import { fmtMoney } from '../lib/format';
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, readJsonResponse } from '../lib/http';
import { fetchFeedbacksApi, isRateLimitError } from '../lib/wb-api-queue';
import { EXPECTED_PROMPT_VERSION, PROMPT_BADGE_LABEL } from '../lib/prompt-meta';
import {
  clearFeedbacksRateLimit,
  formatCacheBadge,
  getCachedFeedbacksList,
  getCachedUnansweredCount,
  getFeedbacksRateLimitSecondsLeft,
  getStaleCachedFeedbacksList,
  isFeedbacksRateLimited,
  isFeedbacksReadRateLimited,
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

function GenderBadge({ gender, source, label }) {
  if (!gender || gender === 'unknown') return null;
  const short = gender === 'female' ? 'ж' : gender === 'male' ? 'м' : null;
  if (!short) return null;
  const title =
    label && source === 'name'
      ? `Пол: ${label} (определён по имени)`
      : label
        ? `Пол: ${label}`
        : gender === 'female'
          ? 'Женский пол'
          : 'Мужской пол';
  const className =
    gender === 'female'
      ? 'bg-fuchsia-100 text-fuchsia-800'
      : 'bg-sky-100 text-sky-800';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`} title={title}>
      {short}
    </span>
  );
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

function UsageContextBadge({ usageContext }) {
  if (!usageContext?.labels?.length) return null;
  const title = [
    usageContext.summary || usageContext.labels.join(', '),
    usageContext.vocabularyHint,
    usageContext.portable ? 'Компактный/переносной товар' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span
      className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-900"
      title={title}
    >
      {usageContext.labels.join(' · ')}
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
    return `Подождите ${sec} сек`;
  }
  return null;
}

function cachedListToData(entry) {
  if (!entry) return null;
  return {
    feedbacks: entry.feedbacks || [],
    countUnanswered: entry.countUnanswered ?? entry.feedbacks?.length ?? 0,
    hasMore: entry.hasMore ?? false,
  };
}

function applyCachedListToState(entry, { setData, setCacheBadge, setStatus, dataRef, hasDataRef }) {
  const cachedData = cachedListToData(entry);
  if (!cachedData?.feedbacks?.length) return false;
  dataRef.current = cachedData;
  setData(cachedData);
  hasDataRef.current = true;
  const badge = formatCacheBadge(entry, { short: true });
  setCacheBadge(badge);
  const count = cachedData.countUnanswered;
  setStatus(`Без ответа: ${count} · ${badge}`);
  return true;
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
          promptVersion: payload?.promptVersion || null,
          commitSha: payload?.commitSha || null,
          managerPromptOnly: payload?.managerPromptOnly ?? null,
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

function PromptBadge({ promptVersion, commitSha, stale = false }) {
  if (!promptVersion && !stale) return null;
  const version = promptVersion || EXPECTED_PROMPT_VERSION;
  const sha = commitSha || APP_BUILD;
  const mismatch = version !== EXPECTED_PROMPT_VERSION;
  const title = [
    PROMPT_BADGE_LABEL,
    `версия API: ${version}`,
    sha ? `commit ${sha}` : null,
    stale ? 'ожидается ответ API' : null,
    mismatch ? 'устаревшая версия промпта на сервере' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        mismatch || stale
          ? 'bg-amber-100 text-amber-900'
          : 'bg-indigo-100 text-indigo-800'
      }`}
      title={title}
    >
      {PROMPT_BADGE_LABEL} · {version}
      {sha ? ` · ${sha}` : ''}
    </span>
  );
}


function isTemplateDraft(draft) {
  return draft?.provider === 'template' || draft?.source?.startsWith?.('template');
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

function formatAutoReplyTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const AUTO_REPLY_PHASE_LABELS = {
  idle: 'ожидание',
  processing: 'обработка',
  generating: 'генерация черновика',
  sending: 'отправка в WB',
  sent: 'отправлен',
  error: 'ошибка',
};

function formatAutoReplyPhase(phase, status) {
  if (status?.startsWith('в очереди')) return status;
  if (status && !['запущен', 'остановлен', 'обработка'].includes(status)) return status;
  return AUTO_REPLY_PHASE_LABELS[phase] || status || 'ожидание';
}

function AutoReplyLogEntry({ entry }) {
  const statusClass =
    entry.status === 'отправлен'
      ? 'text-emerald-700'
      : entry.status === 'пропущен'
        ? 'text-amber-700'
        : entry.status === 'в очереди'
          ? 'text-brand-700'
          : 'text-rose-700';
  return (
    <li className="border-b border-slate-100 py-2 last:border-0">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">{formatAutoReplyTime(entry.at)}</span>
        <span className={`font-medium ${statusClass}`}>{entry.status}</span>
        {entry.rating ? <Stars rating={entry.rating} /> : null}
      </div>
      <p className="mt-0.5 text-xs text-slate-700">{entry.productName || entry.feedbackId || '—'}</p>
      {entry.preview ? (
        <p className="mt-0.5 text-xs italic text-slate-500">«{entry.preview}…»</p>
      ) : entry.reason ? (
        <p className="mt-0.5 text-xs text-slate-500">{entry.reason}</p>
      ) : null}
    </li>
  );
}

function formatApiError(payload, status, fallback = 'Не удалось загрузить отзывы') {
  if (status === 401) return '401 токен отозван';
  const rateMsg = formatRateLimitError(payload, status);
  if (rateMsg) return rateMsg;
  const parts = [payload?.error, payload?.hint, payload?.detail].filter(Boolean);
  if (parts.length) return parts.join('. ');
  return fallback;
}

export default function FeedbacksPanel({ token }) {
  const [loading, setLoading] = useState(false);
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
    promptVersion: null,
    commitSha: null,
    managerPromptOnly: null,
    loading: false,
    error: '',
    apiCheckStatus: 'pending',
    endpoint: '',
  });
  const [cacheBadge, setCacheBadge] = useState('');
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(() => loadAutoReplyEnabled());
  const [autoReplyState, setAutoReplyState] = useState({
    sentThisHour: getSentThisHour(),
    nextInMs: getMsUntilNextSlot(),
    log: getAutoReplyLog(),
    status: '',
    phase: 'idle',
    running: false,
    lastResult: null,
  });
  const autoReplyRef = useRef(null);
  const loadFeedbacksRef = useRef(null);
  const loadAttemptRef = useRef(0);
  const hasDataRef = useRef(false);
  const dataRef = useRef(null);
  const loadInFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const abortRef = useRef(null);
  const aiCheckStartedRef = useRef(false);
  const loadingWatchdogRef = useRef(null);

  const restoreCachedList = useCallback(
    ({ stale = false } = {}) => {
      const entry = stale
        ? getStaleCachedFeedbacksList(token) || getCachedFeedbacksList(token)
        : getCachedFeedbacksList(token) || getStaleCachedFeedbacksList(token);
      return applyCachedListToState(entry, {
        setData,
        setCacheBadge,
        setStatus,
        dataRef,
        hasDataRef,
      });
    },
    [token]
  );

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

  const cancelForegroundLoad = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    loadInFlightRef.current = false;
    clearLoadingWatchdog();
    setLoading(false);
    setLoadingMore(false);
  }, [clearLoadingWatchdog]);

  const loadFeedbacks = useCallback(
    async ({ force = false, isRetry = false, append = false, skip = 0 } = {}) => {
      if (!token?.trim()) {
        setError('Нет токена');
        return;
      }

      const showRateLimit = (sec, { queued = false } = {}) => {
        setFeedbacksRateLimited(sec, { kind: 'read' });
        setRateLimitCountdown(sec);
        restoreCachedList({ stale: true });
        if (queued) {
          setStatus(`В очереди · обновление через ${sec} сек…`);
          setError('');
        } else {
          setError(`Подождите ${sec} сек — повтор автоматически…`);
        }
      };

      if (force && !append) {
        loadAttemptRef.current = 0;
        if (isFeedbacksRateLimited() && !isRetry) {
          const sec = getFeedbacksRateLimitSecondsLeft();
          if (sec > 0) {
            pendingRefreshRef.current = true;
            showRateLimit(sec, { queued: true });
            return;
          }
          clearFeedbacksRateLimit('read');
        }
        if (loadInFlightRef.current) {
          cancelForegroundLoad();
        }
      } else if (loadInFlightRef.current && !append) {
        return;
      }

      if (!force && !isRetry && !append && isFeedbacksRateLimited()) {
        const sec = getFeedbacksRateLimitSecondsLeft();
        pendingRefreshRef.current = true;
        showRateLimit(sec, { queued: true });
        return;
      }

      const cachedCount = getCachedUnansweredCount();
      if (!force && !append && cachedCount != null) {
        setStatus(`Без ответа: ${cachedCount}`);
      }

      if (append) {
        setLoadingMore(true);
      } else {
        abortRef.current?.abort();
        abortRef.current = new AbortController();
        loadInFlightRef.current = true;
        setLoading(true);
        startLoadingWatchdog();
      }
      if (!isRetry && !append) setError('');
      if ((!cachedCount || force) && !append) setStatus('');
      try {
        const { response, payload } = await fetchFeedbacksApi(
          '/api/feedbacks/feedbacks',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action: 'list', take: PAGE_SIZE, skip }),
            signal: abortRef.current?.signal,
          },
          { timeoutMs: LOADING_WATCHDOG_MS, kind: 'read' }
        );
        if (!response.ok) {
          throw new Error(formatApiError(payload, response.status));
        }
        clearFeedbacksRateLimit('read');
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
        restoreCachedList({ stale: true });
        if (isRateLimitError(err)) {
          const sec = Number(err.retryAfterSec) || getFeedbacksRateLimitSecondsLeft() || 5;
          pendingRefreshRef.current = true;
          showRateLimit(sec, { queued: true });
          return;
        }
        setError(err.message || 'Ошибка загрузки');
      } finally {
        if (append) setLoadingMore(false);
        else {
          clearLoadingWatchdog();
          setLoading(false);
          loadInFlightRef.current = false;
        }
      }
    },
    [token, startLoadingWatchdog, clearLoadingWatchdog, cancelForegroundLoad, restoreCachedList]
  );

  loadFeedbacksRef.current = loadFeedbacks;

  const applyFeedbacksList = useCallback(
    ({ feedbacks, countUnanswered, hasMore }) => {
      const count = countUnanswered ?? feedbacks?.length ?? 0;
      const nextData = {
        feedbacks: feedbacks || [],
        countUnanswered: count,
        hasMore: Boolean(hasMore),
      };
      dataRef.current = nextData;
      hasDataRef.current = Boolean(nextData.feedbacks?.length);
      setData(nextData);
      setCachedFeedbacksList(token, {
        feedbacks: nextData.feedbacks,
        countUnanswered: count,
        hasMore: nextData.hasMore,
      });
      setCachedUnansweredCount(count);
      setStatus(`Без ответа: ${count}`);
    },
    [token]
  );

  const loadMoreFeedbacks = useCallback(() => {
    const current = data?.feedbacks?.length || 0;
    if (loadingMore || loading) return;
    loadFeedbacks({ force: true, append: true, skip: current });
  }, [data?.feedbacks?.length, loadFeedbacks, loading, loadingMore]);

  const requestAiConfigCheck = useCallback(() => {
    if (aiCheckStartedRef.current) return;
    aiCheckStartedRef.current = true;
    setAiConfig((prev) => ({ ...prev, loading: true, apiCheckStatus: 'loading' }));
    fetchAiConfigStatus().then((result) => setAiConfig(result));
  }, []);

  const handleRefresh = useCallback(() => {
    if (loadInFlightRef.current) return;
    if (isFeedbacksRateLimited()) {
      const sec = getFeedbacksRateLimitSecondsLeft();
      if (sec > 0) {
        pendingRefreshRef.current = true;
        setRateLimitCountdown(sec);
        setStatus(`В очереди · обновление через ${sec} сек…`);
        setError('');
        restoreCachedList({ stale: true });
        return;
      }
    }
    pendingRefreshRef.current = false;
    loadFeedbacks({ force: true });
  }, [loadFeedbacks, restoreCachedList]);

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

    const cached = getCachedFeedbacksList(token) || getStaleCachedFeedbacksList(token);
    if (cached) {
      hasDataRef.current = true;
      const cachedData = cachedListToData(cached);
      dataRef.current = cachedData;
      setData(cachedData);
      const badge = formatCacheBadge(cached, { short: true });
      setCacheBadge(badge);
      const count = cachedData.countUnanswered;
      setStatus(`Без ответа: ${count} · ${badge}`);
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
    if (rateLimitCountdown <= 0) {
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        loadFeedbacks({ force: true });
      }
      return undefined;
    }
    const timer = setInterval(() => {
      const left = getFeedbacksRateLimitSecondsLeft();
      setRateLimitCountdown(left);
      if (left <= 0) {
        clearFeedbacksRateLimit('read');
        setError((prev) => (prev.startsWith('Подождите') ? '' : prev));
        if (pendingRefreshRef.current) {
          pendingRefreshRef.current = false;
          loadFeedbacks({ force: true });
        }
      } else if (pendingRefreshRef.current) {
        setStatus(`Обновление через ${left} сек…`);
        setError('');
      } else {
        setError(`Подождите ${left} сек — повтор автоматически…`);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [rateLimitCountdown, loadFeedbacks]);

  useEffect(
    () => () => {
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
            promptVersion: payload.promptVersion || null,
            commitSha: payload.commitSha || null,
            alternative: payload.alternative,
            premiumUpsell: payload.premiumUpsell,
            validation: payload.validation,
            quality: payload.quality || null,
            qualityRetried: payload.qualityRetried || false,
            hint: payload.hint,
            scenario: payload.scenario || null,
            usageContext: payload.usageContext || null,
          },
        }));
        if (payload.provider === 'yandex' || payload.provider === 'openai') {
          setAiConfig((prev) => ({
            ...prev,
            yandexConfigured: prev.yandexConfigured || payload.provider === 'yandex' || payload.yandexConfigured,
            openaiConfigured: prev.openaiConfigured || payload.provider === 'openai' || payload.openaiConfigured,
            promptVersion: payload.promptVersion || prev.promptVersion,
            commitSha: payload.commitSha || prev.commitSha,
            managerPromptOnly: payload.managerPromptOnly ?? prev.managerPromptOnly,
            loading: false,
            error: '',
            apiCheckStatus: prev.apiCheckStatus === 'ok' ? 'ok' : 'inferred',
          }));
        } else if (payload.promptVersion) {
          setAiConfig((prev) => ({
            ...prev,
            promptVersion: payload.promptVersion,
            commitSha: payload.commitSha || prev.commitSha,
            managerPromptOnly: payload.managerPromptOnly ?? prev.managerPromptOnly,
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
        setError('Нет токена');
        return;
      }

      setSendingId(feedback.id);
      setError('');
      try {
        const { response, payload } = await fetchFeedbacksApi(
          '/api/feedbacks/feedbacks',
          {
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
          },
          { kind: 'write', maxRetries: 5 }
        );
        if (!response.ok) {
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
        if (isRateLimitError(err)) {
          const sec = Number(err.retryAfterSec) || getFeedbacksRateLimitSecondsLeft() || 5;
          setFeedbacksRateLimited(sec, { kind: err.kind === 'write' ? 'write' : 'read' });
          setRateLimitCountdown(sec);
          restoreCachedList({ stale: true });
          setError(`В очереди · повтор через ${sec} сек`);
        } else {
          setError(err.message || 'Ошибка отправки');
        }
      } finally {
        setSendingId(null);
      }
    },
    [token, drafts, loadFeedbacks, restoreCachedList]
  );

  useEffect(() => {
    autoReplyRef.current?.destroy();
    autoReplyRef.current = null;

    if (!token || !autoReplyEnabled) {
      setAutoReplyState((prev) => ({
        ...prev,
        sentThisHour: getSentThisHour(),
        nextInMs: getMsUntilNextSlot(),
        log: getAutoReplyLog(),
        running: false,
        phase: 'idle',
        status: autoReplyEnabled ? '' : 'остановлен',
      }));
      return undefined;
    }

    const scheduler = createAutoReplyScheduler({
      token,
      getFeedbacks: () => dataRef.current?.feedbacks || [],
      onState: (state) => setAutoReplyState((prev) => ({ ...prev, ...state })),
      onFeedbacksLoaded: (list) => applyFeedbacksList(list),
      onAfterSend: (feedbackId) => {
        if (autoReplyRef.current?.isPosting?.()) return;
        if (dataRef.current?.feedbacks?.length) {
          const nextFeedbacks = dataRef.current.feedbacks.filter((fb) => fb.id !== feedbackId);
          const count = Math.max(0, (dataRef.current.countUnanswered ?? nextFeedbacks.length) - 1);
          const nextData = {
            ...dataRef.current,
            feedbacks: nextFeedbacks,
            countUnanswered: count,
          };
          dataRef.current = nextData;
          setData(nextData);
          setCachedFeedbacksList(token, {
            feedbacks: nextFeedbacks,
            countUnanswered: count,
            hasMore: dataRef.current.hasMore,
          });
          setStatus(`Без ответа: ${count}`);
        }
        if (isFeedbacksReadRateLimited() || loadInFlightRef.current) return;
        loadFeedbacksRef.current?.({ force: true });
      },
    });
    autoReplyRef.current = scheduler;
    scheduler.start();

    return () => scheduler.destroy();
  }, [token, autoReplyEnabled, applyFeedbacksList]);

  useEffect(() => {
    if (!autoReplyEnabled) return undefined;
    const timer = setInterval(() => {
      setAutoReplyState((prev) => ({
        ...prev,
        sentThisHour: getSentThisHour(),
        nextInMs: getMsUntilNextSlot(),
      }));
    }, 10_000);
    return () => clearInterval(timer);
  }, [autoReplyEnabled]);

  const toggleAutoReply = useCallback(() => {
    const next = !autoReplyEnabled;
    setAutoReplyEnabled(next);
    saveAutoReplyEnabled(next);
    if (!next) {
      autoReplyRef.current?.stop();
      return;
    }
    if (!dataRef.current?.feedbacks?.length && !loadInFlightRef.current) {
      loadFeedbacksRef.current?.({ force: true });
    }
  }, [autoReplyEnabled]);

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
              <PromptBadge
                promptVersion={aiConfig.promptVersion}
                commitSha={aiConfig.commitSha || APP_BUILD}
                stale={!aiConfig.promptVersion && aiConfig.apiCheckStatus !== 'ok'}
              />
              {cacheBadge ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                  {cacheBadge}
                </span>
              ) : null}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              AI-черновики с апселлом. Автоответчик — до {AUTO_REPLY_MAX_PER_HOUR} отзывов в час с проверкой
              manager-v9.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={loading || loadingMore}
            onClick={handleRefresh}
          >
            {loading
              ? 'Загрузка…'
              : rateLimitCountdown > 0
                ? `Обновить (${rateLimitCountdown}с)`
                : 'Обновить'}
          </button>
        </div>

        <details className="mt-3 text-xs text-slate-500" onToggle={(event) => event.currentTarget.open && requestAiConfigCheck()}>
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
            {!error.startsWith('Подождите') ? (
              <button
                type="button"
                className="btn-secondary mt-2 text-xs"
                disabled={loading || loadingMore}
                onClick={() => {
                  loadAttemptRef.current = 0;
                  clearFeedbacksRateLimit('read');
                  loadFeedbacks({ force: true });
                }}
              >
                Повторить загрузку
              </button>
            ) : null}
          </div>
        ) : null}
        {status ? <p className="mt-2 text-xs text-slate-600">{status}</p> : null}
      </section>

      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Автоответчик</h2>
            <p className="mt-1 text-xs text-slate-600">
              Пока вкладка открыта: черновик YandexGPT → валидация → ответ в WB. Не более{' '}
              {AUTO_REPLY_MAX_PER_HOUR}/час (~1 каждые 6 мин).
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <span>{autoReplyEnabled ? 'Вкл' : 'Выкл'}</span>
            <button
              type="button"
              role="switch"
              aria-checked={autoReplyEnabled}
              className={`relative h-7 w-12 rounded-full transition-colors ${
                autoReplyEnabled ? 'bg-brand-600' : 'bg-slate-300'
              }`}
              onClick={toggleAutoReply}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                  autoReplyEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
        </div>

        <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
          <p>
            <span className="font-medium text-slate-700">Лимит: </span>
            {AUTO_REPLY_MAX_PER_HOUR} отзывов/час
          </p>
          <p>
            <span className="font-medium text-slate-700">Отправлено за час: </span>
            {autoReplyState.sentThisHour} / {AUTO_REPLY_MAX_PER_HOUR}
          </p>
          <p>
            <span className="font-medium text-slate-700">Следующий: </span>
            {autoReplyEnabled
              ? autoReplyState.posting
                ? 'отправка…'
                : autoReplyState.running
                  ? 'сейчас…'
                  : autoReplyState.status?.startsWith('в очереди')
                    ? autoReplyState.status
                    : formatMinutes(autoReplyState.nextInMs) > 0
                      ? `через ${formatMinutes(autoReplyState.nextInMs)} мин`
                      : 'скоро'
              : '—'}
          </p>
        </div>

        {autoReplyEnabled ? (
          <div className="mt-2 space-y-1">
            <p
              className={`text-xs font-medium ${
                autoReplyState.phase === 'error'
                  ? 'text-rose-700'
                  : autoReplyState.phase === 'sent'
                    ? 'text-emerald-700'
                    : 'text-brand-700'
              }`}
            >
              {formatAutoReplyPhase(autoReplyState.phase, autoReplyState.status)}
            </p>
            {autoReplyState.lastResult ? (
              <p className="text-xs text-slate-500">
                Последний: {formatAutoReplyTime(autoReplyState.lastResult.at)} ·{' '}
                {autoReplyState.lastResult.ok ? (
                  <span className="text-emerald-700">
                    ✓ {autoReplyState.lastResult.productName || autoReplyState.lastResult.feedbackId}
                  </span>
                ) : (
                  <span className="text-rose-700">
                    ✗ {autoReplyState.lastResult.reason || 'ошибка'}
                    {autoReplyState.lastResult.feedbackId
                      ? ` · ${autoReplyState.lastResult.feedbackId}`
                      : ''}
                  </span>
                )}
              </p>
            ) : null}
          </div>
        ) : null}

        {!autoReplyEnabled ? (
          <p className="mt-2 text-xs text-slate-500">
            Включите переключатель — нужен токен WB и YandexGPT на сервере. Вкладку держите открытой.
          </p>
        ) : null}

        {autoReplyState.log?.length ? (
          <details className="mt-3" open={autoReplyEnabled}>
            <summary className="cursor-pointer text-xs font-medium text-slate-700">
              Журнал автоответов ({autoReplyState.log.length})
            </summary>
            <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 px-3 py-1">
              {autoReplyState.log.map((entry, index) => (
                <AutoReplyLogEntry key={`${entry.at}-${entry.feedbackId || index}`} entry={entry} />
              ))}
            </ul>
          </details>
        ) : null}
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
                    <GenderBadge
                      gender={fb.buyerGender}
                      source={fb.buyerGenderSource}
                      label={fb.buyerGenderLabel}
                    />
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
                    {draft?.usageContext ? <UsageContextBadge usageContext={draft.usageContext} /> : null}
                    {draft?.quality ? <QualityBadge quality={draft.quality} /> : null}
                    {draft?.promptVersion ? (
                      <PromptBadge promptVersion={draft.promptVersion} commitSha={draft.commitSha} />
                    ) : null}
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

                  {isTemplateDraft(draft) ? (
                    <div
                      className="mt-2 rounded-lg border-2 border-red-500 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
                      role="alert"
                    >
                      ⚠️ НЕ МЕНЕДЖЕР — ОШИБКА AI. Ответ сгенерирован по старому шаблону, не отправляйте его.
                      Проверьте ключи YandexGPT в Vercel и перегенерируйте.
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
