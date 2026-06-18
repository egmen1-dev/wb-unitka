export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
/** YandexGPT draft generation on Vercel often needs 60–90s. */
export const DRAFT_FETCH_TIMEOUT_MS = 95_000;

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const { signal: externalSignal, ...rest } = options;

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timedOut = !externalSignal?.aborted;
      const sec = Math.round(timeoutMs / 1000);
      throw new Error(
        timedOut ? `Запрос не ответил за ${sec} сек — попробуйте ещё раз` : 'Запрос отменён'
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return { ok: response.ok, data: {}, text: '' };
  }

  try {
    return { ok: response.ok, data: JSON.parse(text), text };
  } catch {
    const preview = text.replace(/\s+/g, ' ').slice(0, 160);
    let message = preview;

    if (response.status === 504 || /timeout/i.test(preview)) {
      message = 'Сервер не успел ответить (таймаут). Попробуйте ещё раз.';
    } else if (response.status >= 500) {
      message = 'Ошибка сервера. Попробуйте через минуту.';
    } else if (preview.startsWith('<!DOCTYPE') || preview.startsWith('<html')) {
      message = `Сервер вернул HTML вместо JSON (${response.status})`;
    }

    const error = new Error(message);
    error.status = response.status;
    error.raw = preview;
    throw error;
  }
}
