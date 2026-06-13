function StepIcon({ status }) {
  if (status === 'done') {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      </span>
    );
  }
  return <span className="h-6 w-6 shrink-0 rounded-full border-2 border-slate-200 bg-slate-50" />;
}

function formatElapsed(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} сек`;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export default function SyncProgressPanel({ steps, startedAt, partialReady = false, tick = 0 }) {
  if (!steps?.length) return null;
  void tick;

  const elapsed = startedAt ? formatElapsed(Date.now() - startedAt) : null;
  const running = steps.find((s) => s.status === 'running');
  const hasError = steps.some((s) => s.status === 'error');
  const allDone = steps.every((s) => s.status === 'done' || s.status === 'error');

  return (
    <section className="panel border-brand-200 bg-gradient-to-br from-brand-50/80 to-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            {partialReady && !allDone ? 'Таблица готова — догружаем отчёты' : 'Загрузка данных WB'}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {running
              ? running.detail || running.label
              : hasError
                ? 'Часть данных загружена — можно работать с таблицей'
                : allDone
                  ? 'Синхронизация завершена'
                  : 'Подготовка…'}
            {elapsed ? ` · ${elapsed}` : ''}
          </p>
        </div>
        {partialReady && !allDone ? (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
            Можно смотреть расчёты
          </span>
        ) : null}
      </div>

      <ol className="mt-4 space-y-2">
        {steps.map((step) => (
          <li
            key={step.id}
            className={`flex items-start gap-3 rounded-lg px-2 py-1.5 ${
              step.status === 'running' ? 'bg-white/70' : ''
            }`}
          >
            <StepIcon status={step.status} />
            <div className="min-w-0 flex-1 pt-0.5">
              <p
                className={`text-sm ${
                  step.status === 'pending' ? 'text-slate-400' : 'font-medium text-slate-800'
                }`}
              >
                {step.label}
              </p>
              {step.detail ? (
                <p
                  className={`mt-0.5 text-xs ${
                    step.status === 'error' ? 'text-rose-700' : 'text-slate-500'
                  }`}
                >
                  {step.detail}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export const SYNC_STEPS = [
  { id: 'catalog', label: 'Каталог карточек WB' },
  { id: 'bootstrap', label: 'Цены, комиссии и тарифы' },
  { id: 'realization', label: 'Отчёт реализации (еженедельный WB)' },
  { id: 'enrich', label: 'Остатки, заказы и реклама' },
];

export function createSyncSteps() {
  return SYNC_STEPS.map((step) => ({ ...step, status: 'pending', detail: '' }));
}

export function patchSyncStep(steps, id, patch) {
  return steps.map((step) => (step.id === id ? { ...step, ...patch } : step));
}
