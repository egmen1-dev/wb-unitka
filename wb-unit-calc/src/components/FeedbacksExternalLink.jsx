const FEEDBACKS_URL =
  import.meta.env.VITE_WB_FEEDBACKS_URL || 'https://wb-feedbacks.vercel.app';

export default function FeedbacksExternalLink() {
  return (
    <section className="panel mx-auto max-w-xl py-12 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.5 8.25h9m-9 3H12m-8.25 13.5l3.75-3.75h9.75a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0017.25 3.75H6.75A2.25 2.25 0 004.5 6v9a2.25 2.25 0 002.25 2.25z"
          />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-slate-800">Ответы на отзывы WB</h2>
      <p className="mt-2 text-sm text-slate-600">
        Вынесено в отдельный сервис с AI-черновиками — не нагружает основной токен синхронизации и FBS.
      </p>
      <a
        href={FEEDBACKS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary mt-6 inline-flex"
      >
        Открыть ответы на отзывы →
      </a>
      <p className="mt-3 text-xs text-slate-400">
        Токен «Вопросы и отзывы» вводится только там, в localStorage браузера.
      </p>
    </section>
  );
}
