import { useEffect, useState } from 'react';
import FeedbacksPanel from './components/FeedbacksPanel';
import TokenPanel from './components/TokenPanel';
import { APP_BUILD } from './lib/app-build';
import { loadToken, saveToken } from './lib/storage';

export default function App() {
  const [token, setToken] = useState(() => loadToken());

  useEffect(() => {
    saveToken(token);
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="app-header">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold text-white">Отзывы WB</h1>
            <p className="text-xs text-brand-100">AI-черновики и ответы на отзывы</p>
          </div>
          <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-medium text-brand-100">
            v{APP_BUILD}
          </span>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-5">
        <TokenPanel token={token} onTokenChange={setToken} />
        <FeedbacksPanel token={token} />
        <p className="text-center text-xs text-slate-400">
          Отдельный сервис — не нагружает токен{' '}
          <a
            href="https://wb-unitka.vercel.app"
            className="text-brand-700 underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Юнитки WB
          </a>
        </p>
      </main>
    </div>
  );
}
