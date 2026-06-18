import { APP_BUILD } from './app-build';

const RELOAD_KEY = 'wb-feedbacks:version-reload';

/** Compare bundled commit with /api/feedbacks/version. */
export async function fetchServerVersion() {
  try {
    const response = await fetch('/api/feedbacks/version', { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json();
    const serverSha = String(payload?.commitSha || '').trim();
    if (!serverSha || serverSha === 'local') return null;
    return {
      serverSha,
      promptVersion: payload?.promptVersion || null,
      builtAt: payload?.builtAt || null,
      stale: serverSha !== APP_BUILD,
      alreadyTried: sessionStorage.getItem(RELOAD_KEY) === serverSha,
    };
  } catch {
    return null;
  }
}

/** Hard reload with ?v=commit cache-bust (once per serverSha per tab). */
export function forceVersionRefresh(serverSha) {
  try {
    sessionStorage.setItem(RELOAD_KEY, serverSha);
  } catch {
    // private mode
  }

  const url = new URL(window.location.href);
  url.searchParams.set('v', serverSha);
  window.location.replace(url.toString());
}
