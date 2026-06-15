/** Короткий id сборки (git sha) — задаётся при деплое. */
export const APP_BUILD = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'local';

export function currentBundlePath() {
  const script = document.querySelector('script[src*="/assets/index-"]');
  const src = script?.getAttribute('src') || '';
  const match = src.match(/\/assets\/index-[^.]+\.js/);
  return match?.[0] || '';
}

export async function fetchLatestBundlePath() {
  const response = await fetch(`/?_=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) return '';
  const html = await response.text();
  const match = html.match(/\/assets\/index-[^"']+\.js/);
  return match?.[0] || '';
}
