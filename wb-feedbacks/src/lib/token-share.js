const TOKEN_HASH_KEY = 'token';

/** Read WB token from URL fragment (#token=…). Not sent to server logs. */
export function readTokenFromHash() {
  try {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return '';
    const params = new URLSearchParams(raw);
    return params.get(TOKEN_HASH_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

/** Remove token from address bar after applying (keeps query string). */
export function clearTokenFromHash() {
  try {
    const { pathname, search } = window.location;
    if (!window.location.hash) return;
    window.history.replaceState(null, '', `${pathname}${search}`);
  } catch {
    // ignore
  }
}

/** Share link with token in fragment — safe for server logs, visible to recipient. */
export function buildTokenShareUrl(token) {
  const url = new URL(window.location.origin + window.location.pathname);
  const v = url.searchParams.get('v');
  if (v) url.searchParams.set('v', v);
  url.hash = `${TOKEN_HASH_KEY}=${encodeURIComponent(String(token || '').trim())}`;
  return url.toString();
}
