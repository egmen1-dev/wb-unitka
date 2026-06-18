import { useEffect, useLayoutEffect, useState } from 'react';
import FeedbacksPanel from './components/FeedbacksPanel';
import TokenPanel from './components/TokenPanel';
import VersionBanner from './components/VersionBanner';
import { APP_BUILD } from './lib/app-build';
import { clearStaleFeedbacksCacheOnBoot } from './lib/feedbacks-cache';
import { loadToken, saveToken } from './lib/storage';
import { clearTokenFromHash, readTokenFromHash } from './lib/token-share';
import { fetchServerVersion } from './lib/version-check';

function BootStatus({ error }) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    );
  }

  return null;
}

export default function App() {
  const [token, setToken] = useState(() => readTokenFromHash() || loadToken());
  const [bootError, setBootError] = useState(null);
  const [bootReady, setBootReady] = useState(false);
  const [versionInfo, setVersionInfo] = useState(null);

  useLayoutEffect(() => {
    const fromHash = readTokenFromHash();
    if (fromHash) clearTokenFromHash();
    setBootReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchServerVersion().then((info) => {
      if (!cancelled && info?.stale) setVersionInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => clearStaleFeedbacksCacheOnBoot(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    saveToken(token);
  }, [token]);

  useEffect(() => {
    function onUnhandled(event) {
      const message = event?.reason?.message || 'Необработанная ошибка';
      setBootError(message);
    }

    window.addEventListener('unhandledrejection', onUnhandled);
    return () => window.removeEventListener('unhandledrejection', onUnhandled);
  }, []);

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

      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-5" data-boot-ready={bootReady ? '1' : '0'}>
        <BootStatus error={bootError} />
        {versionInfo?.stale ? (
          <VersionBanner serverSha={versionInfo.serverSha} alreadyTried={versionInfo.alreadyTried} />
        ) : null}
        <TokenPanel token={token} onTokenChange={setToken} />
        <FeedbacksPanel token={token} />
        <footer className="space-y-1 text-center text-xs text-slate-400">
          <p>
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
          <p className="font-mono text-[10px] text-slate-300">commit {APP_BUILD}</p>
        </footer>
      </main>
    </div>
  );
}
