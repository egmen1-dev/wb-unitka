import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtMoney } from '../lib/format';
import { readJsonResponse } from '../lib/http';
import WbTokenScopesHint from './WbTokenScopesHint';

function TabDescription({ children }) {
  return <p className="text-sm text-slate-600">{children}</p>;
}

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

function PreviewModal({ feedback, draft, onClose, onSend, sending }) {
  if (!feedback || !draft) return null;

  const upsell = draft.premiumUpsell || draft.alternative;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 id="preview-title" className="text-sm font-semibold text-slate-800">
            Предпросмотр ответа
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Так ответ увидит покупатель на WB после модерации
          </p>
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
              <p className="mt-2 text-xs text-slate-600 italic">«{feedback.text}»</p>
            ) : null}
          </div>

          <div className="rounded-lg border border-brand-200 bg-brand-50/50 px-4 py-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{draft.text}</p>
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
              {upsell.reason ? <p className="mt-1 text-slate-400">{upsell.reason}</p> : null}
            </div>
          ) : null}

          <p className="text-xs text-slate-400">
            {draft.text?.length || 0} / 1000 символов
            {draft.source ? ` · ${draft.source}` : ''}
            {draft.validation && !draft.validation.ok ? (
              <span className="text-amber-600"> · {draft.validation.errors?.join(', ')}</span>
            ) : null}
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

export default function FeedbacksPanel({
  token,
  rows = [],
  onUnansweredCountChange,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [generatingId, setGeneratingId] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [previewId, setPreviewId] = useState(null);

  const catalogRows = useMemo(
    () =>
      rows.map((row) => ({
        vendorCode: row.vendorCode,
        nmId: row.nmId,
        brand: row.brand,
        title: row.title,
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        salePrice: row.salePrice,
        ourPrice: row.ourPrice,
        basePrice: row.basePrice,
        lengthCm: row.lengthCm,
        widthCm: row.widthCm,
        heightCm: row.heightCm,
        weightKg: row.weightKg,
      })),
    [rows]
  );

  const loadFeedbacks = useCallback(async () => {
    if (!token) {
      setError('Добавьте API-ключ WB в разделе «Данные».');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const response = await fetch('/api/unit-calc/feedbacks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'list', take: 50 }),
      });
      const { data: payload } = await readJsonResponse(response);
      if (!response.ok) {
        const err = new Error(payload.error || 'Не удалось загрузить отзывы');
        err.hint = payload.hint;
        throw err;
      }
      setData(payload);
      onUnansweredCountChange?.(payload.countUnanswered ?? 0);
      setStatus(`Без ответа: ${payload.countUnanswered ?? 0}`);
    } catch (err) {
      setError(err.hint ? `${err.message}. ${err.hint}` : err.message || 'Ошибка загрузки');
      setData(null);
      onUnansweredCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [token, onUnansweredCountChange]);

  useEffect(() => {
    if (token) loadFeedbacks();
  }, [token, loadFeedbacks]);

  const requestDraft = useCallback(
    async (feedback, { regenerate = false } = {}) => {
      if (!feedback?.id) return;
      setGeneratingId(feedback.id);
      setError('');
      const variationSeed = Date.now() + Math.floor(Math.random() * 10000);
      try {
        const response = await fetch('/api/unit-calc/feedback-draft', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            feedback,
            catalogRows,
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
            alternative: payload.alternative,
            premiumUpsell: payload.premiumUpsell,
            validation: payload.validation,
            hint: payload.hint,
          },
        }));
        setExpandedId(feedback.id);
        if (payload.hint) setStatus(payload.hint);
        else if (regenerate) setStatus('Новый вариант ответа готов');
        else if (payload.provider === 'yandex' || payload.source?.startsWith('yandex'))
          setStatus('Черновик сгенерирован (YandexGPT)');
        else if (payload.provider === 'openai' || payload.source?.startsWith('openai'))
          setStatus('Черновик сгенерирован (OpenAI)');
        else setStatus('Черновик по шаблону (AI не настроен на сервере)');
      } catch (err) {
        setError(err.message || 'Ошибка генерации');
      } finally {
        setGeneratingId(null);
      }
    },
    [token, catalogRows]
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
        setError('Нужен API-ключ WB.');
        return;
      }

      setSendingId(feedback.id);
      setError('');
      try {
        const response = await fetch('/api/unit-calc/feedbacks', {
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
        if (!response.ok) throw new Error(payload.error || 'Не удалось отправить ответ');

        setStatus(payload.verified ? 'Ответ отправлен и подтверждён в WB' : 'Ответ отправлен');
        setPreviewId(null);
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[feedback.id];
          return next;
        });
        await loadFeedbacks();
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
  const previewFeedback = previewId ? feedbacks.find((fb) => fb.id === previewId) : null;
  const previewDraft = previewId ? drafts[previewId] : null;

  return (
    <div className="flex flex-col gap-4">
      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              Отзывы WB
              {countUnanswered > 0 ? (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                  {countUnanswered}
                </span>
              ) : null}
            </h2>
            <TabDescription>
              AI черновики с апселлом на более дорогие аналоги. Предпросмотр и перегенерация — отправка только
              вручную.
            </TabDescription>
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={loading || !token}
            onClick={loadFeedbacks}
          >
            {loading ? 'Загрузка…' : 'Обновить'}
          </button>
        </div>

        <WbTokenScopesHint
          token={token}
          collapsible
          defaultOpen={false}
          autoCheckOnLoad
          showCheckButton
          className="mt-3"
        />
        <details className="mt-2 text-xs text-slate-500">
          <summary className="cursor-pointer text-slate-600 hover:text-slate-800">
            AI-черновики: YandexGPT (из РФ) или OpenAI
          </summary>
          <div className="mt-2 space-y-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-slate-600">
            <p>
              <span className="font-medium text-slate-700">Рекомендуется из России — YandexGPT:</span>{' '}
              openai.com не нужен, API работает через{' '}
              <a
                href="https://console.yandex.cloud/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-700 underline"
              >
                console.yandex.cloud
              </a>
              .
            </p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>
                Зарегистрируйтесь в{' '}
                <a
                  href="https://console.yandex.cloud/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-700 underline"
                >
                  Yandex Cloud
                </a>{' '}
                и создайте каталог (folder).
              </li>
              <li>
                Включите сервис{' '}
                <a
                  href="https://console.yandex.cloud/folders?section=ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-700 underline"
                >
                  Foundation Models
                </a>{' '}
                и создайте API-ключ (тип «Api-Key»).
              </li>
              <li>
                Скопируйте ID каталога (например <code className="rounded bg-white px-1">b1g…</code>) и ключ.
              </li>
              <li>
                В Vercel → Settings → Environment Variables добавьте{' '}
                <code className="rounded bg-white px-1">YANDEX_GPT_API_KEY</code> и{' '}
                <code className="rounded bg-white px-1">YANDEX_FOLDER_ID</code>, затем redeploy.
              </li>
            </ol>
            <p className="text-slate-500">
              Опционально: <code className="rounded bg-white px-1">OPENAI_API_KEY</code> — если есть доступ к
              OpenAI (используется как запасной вариант, если YandexGPT недоступен).
            </p>
          </div>
        </details>

        {error ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </p>
        ) : null}
        {status ? <p className="mt-2 text-xs text-slate-600">{status}</p> : null}
      </section>

      {!token ? (
        <section className="panel text-sm text-slate-600">
          Добавьте API-ключ в разделе «Данные», чтобы загружать отзывы.
        </section>
      ) : null}

      {token && !loading && feedbacks.length === 0 ? (
        <section className="panel text-sm text-slate-600">
          {data ? 'Нет неотвеченных отзывов — отлично!' : 'Нажмите «Обновить», чтобы загрузить отзывы.'}
        </section>
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
                    {fb.userName ? (
                      <span className="text-xs text-slate-500">· {fb.userName}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    {fb.productName || 'Товар'}
                    {fb.article ? (
                      <span className="ml-2 font-normal text-slate-500">арт. {fb.article}</span>
                    ) : null}
                    {fb.nmId ? (
                      <span className="ml-1 font-normal text-slate-400">nm {fb.nmId}</span>
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
                  <div className="flex flex-wrap gap-2">
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
                      title="AI напишет другой вариант формулировки"
                    >
                      Перегенерировать
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      disabled={!draft?.text?.trim()}
                      onClick={() => setPreviewId(fb.id)}
                    >
                      Предпросмотр
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
                      {upsell.priceLabel || upsell.price ? (
                        <span className="text-slate-500">
                          {' '}
                          · {upsell.priceLabel || fmtMoney(upsell.price)}
                          {upsell.priceDelta > 0 ? ` (+${fmtMoney(upsell.priceDelta)})` : ''}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <textarea
                    className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
                    rows={5}
                    placeholder="Текст ответа (на «ты», без ссылок и скидок, 2–1000 символов)"
                    value={draft?.text || ''}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [fb.id]: { ...(prev[fb.id] || {}), text: e.target.value },
                      }))
                    }
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    {(draft?.text || '').length} / 1000 символов
                    {draft?.source ? ` · ${draft.source}` : ''}
                  </p>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

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
