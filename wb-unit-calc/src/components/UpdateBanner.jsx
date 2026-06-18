import { useEffect, useState } from 'react';
import { APP_BUILD, currentBundlePath, fetchLatestBundlePath } from '../lib/app-build';

export default function UpdateBanner() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const live = await fetchLatestBundlePath();
        const current = currentBundlePath();
        if (!cancelled && live && current && live !== current) {
          setStale(true);
        }
      } catch {
        // offline / adblock — не мешаем работе
      }
    }

    check();
    const timer = setInterval(check, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!stale) return null;

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 lg:px-6">
      <span className="font-medium">Доступна новая версия</span>
      {' · '}
      у вас устаревший интерфейс (сборка {APP_BUILD}).{' '}
      <button
        type="button"
        className="font-semibold text-brand-800 underline"
        onClick={() => window.location.reload()}
      >
        Обновить страницу
      </button>
      {' '}
      или{' '}
      <button
        type="button"
        className="font-semibold text-brand-800 underline"
        onClick={() => {
          if ('caches' in window) {
            caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).finally(() => {
              window.location.reload();
            });
          } else {
            window.location.reload();
          }
        }}
      >
        сбросить кэш
      </button>
    </div>
  );
}
