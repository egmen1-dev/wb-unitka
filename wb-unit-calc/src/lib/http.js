/** Безопасное чтение JSON из fetch — без «Unexpected token» при HTML-ошибках Vercel. */
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
      message = 'Сервер не успел загрузить данные WB (таймаут). Попробуйте ещё раз.';
    } else if (response.status === 413) {
      message = 'Слишком большой запрос. Данные прайса не отправляются на сервер — повторите синхронизацию.';
    } else if (response.status >= 500) {
      message = 'Ошибка сервера при синхронизации. Попробуйте через минуту.';
    } else if (preview.startsWith('<!DOCTYPE') || preview.startsWith('<html')) {
      message = `Сервер вернул HTML вместо JSON (${response.status})`;
    }

    const error = new Error(message);
    error.status = response.status;
    error.raw = preview;
    throw error;
  }
}
