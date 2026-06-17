import { useCallback, useEffect, useMemo, useState } from 'react';
import { readJsonResponse } from '../lib/http';

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

  const catalogRows = useMemo(
    () =>
      rows.map((row) => ({
        vendorCode: row.vendorCode,
        nmId: row.nmId,
        brand: row.brand,
        title: row.title,
        subjectId: row.subjectId,
        subjectName: row.subjectName,
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

  const generateDraft = useCallback(
    async (feedback) => {
      if (!feedback?.id) return;
      setGeneratingId(feedback.id);
      setError('');
      try {
        const response = await fetch('/api/unit-calc/feedback-draft', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ feedback, catalogRows }),
        });
        const { data: payload } = await readJsonResponse(response);
        if (!response.ok) throw new Error(payload.error || 'Не удалось сгенерировать ответ');

        setDrafts((prev) => ({
          ...prev,
          [feedback.id]: {
            text: payload.draft || '',
            source: payload.source,
            alternative: payload.alternative,
            hint: payload.hint,
          },
        }));
        setExpandedId(feedback.id);
        if (payload.hint) setStatus(payload.hint);
        else if (payload.source === 'openai') setStatus('Черновик сгенерирован (AI)');
        else setStatus('Черновик по шаблону (без OPENAI_API_KEY)');
      } catch (err) {
        setError(err.message || 'Ошибка генерации');
      } finally {
        setGeneratingId(null);
      }
    },
    [token, catalogRows]
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
      if (!window.confirm('Отправить ответ в WB? Текст уйдёт на модерацию.')) return;

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
              Неотвеченные отзывы из кабинета WB. Сгенерируй черновик, отредактируй и отправь вручную — без
              автопилота.
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

        <p className="mt-2 text-xs text-slate-500">
          Токен WB: категория «Вопросы и отзывы». Для AI-черновиков на сервере нужен{' '}
          <code className="rounded bg-slate-100 px-1">OPENAI_API_KEY</code>.
        </p>

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
                      className="btn-primary text-sm"
                      disabled={sendingId === fb.id || !draft?.text?.trim()}
                      onClick={() => sendAnswer(fb)}
                    >
                      {sendingId === fb.id ? 'Отправка…' : 'Отправить в WB'}
                    </button>
                  </div>

                  {draft?.alternative?.article ? (
                    <p className="mt-2 text-xs text-slate-500">
                      Альтернатива в черновике: арт. {draft.alternative.article} — {draft.alternative.title}
                    </p>
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
                    {draft?.source ? ` · источник: ${draft.source}` : ''}
                  </p>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
