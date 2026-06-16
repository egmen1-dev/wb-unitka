/** Короткий id сборки (git sha) — задаётся при деплое. */
export const APP_BUILD = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'local';

export function currentBundlePath() {
  const script = document.querySelector('script[src*="/assets/index-"]');
  const src = script?.getAttribute('src') || '';
  const match = src.match(/\/assets\/index-[^.]+\.js/);
  return match?.[0] || '';
}

export async function fetchLatestBundlePath() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`/?_=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return '';
    const html = await response.text();
    const match = html.match(/\/assets\/index-[^"']+\.js/);
    return match?.[0] || '';
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}
