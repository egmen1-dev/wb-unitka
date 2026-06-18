const YANDEX_COMPLETION_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MODEL = 'yandexgpt';

/** yandexgpt-32k для длинных отзывов, если YANDEX_GPT_MODEL не задан. */
export function pickYandexModel(reviewCharCount = 0) {
  const envModel = process.env.YANDEX_GPT_MODEL?.trim();
  if (envModel) return envModel;
  if (reviewCharCount > 700) return 'yandexgpt-32k';
  return DEFAULT_MODEL;
}

function readYandexConfig() {
  const apiKey =
    process.env.YANDEX_GPT_API_KEY?.trim() || process.env.YANDEX_CLOUD_API_KEY?.trim() || '';
  const folderId = process.env.YANDEX_FOLDER_ID?.trim() || '';
  if (!apiKey || !folderId) return null;
  return {
    apiKey,
    folderId,
    model: pickYandexModel(),
  };
}

/**
 * @param {{ system?: string, user: string, temperature?: number, maxTokens?: number, timeoutMs?: number, apiKey?: string, folderId?: string, model?: string }} options
 */
export async function completeYandexGpt({
  system,
  user,
  temperature = 0.8,
  maxTokens = 450,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  apiKey: apiKeyOverride,
  folderId: folderIdOverride,
  model: modelOverride,
} = {}) {
  const config = readYandexConfig();
  const apiKey = apiKeyOverride || config?.apiKey;
  const folderId = folderIdOverride || config?.folderId;
  const model = modelOverride || config?.model || DEFAULT_MODEL;

  if (!apiKey || !folderId) {
    throw new Error(
      'YandexGPT: задайте YANDEX_GPT_API_KEY (или YANDEX_CLOUD_API_KEY) и YANDEX_FOLDER_ID'
    );
  }
  if (!user?.trim()) {
    throw new Error('YandexGPT: пустой user prompt');
  }

  const messages = [];
  if (system?.trim()) {
    messages.push({ role: 'system', text: system.trim() });
  }
  messages.push({ role: 'user', text: user.trim() });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(YANDEX_COMPLETION_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        'x-folder-id': folderId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        modelUri: `gpt://${folderId}/${model}/latest`,
        completionOptions: {
          stream: false,
          temperature,
          maxTokens,
        },
        messages,
      }),
    });

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`YandexGPT: неверный ответ (${response.status})`);
    }

    if (!response.ok) {
      const message =
        payload?.error?.message ||
        payload?.message ||
        payload?.details?.[0]?.message ||
        text.slice(0, 200) ||
        `HTTP ${response.status}`;
      throw new Error(`YandexGPT ${response.status}: ${message}`);
    }

    const draft = String(payload?.result?.alternatives?.[0]?.message?.text || '').trim();
    if (!draft) {
      throw new Error('YandexGPT вернул пустой ответ');
    }

    return {
      text: draft,
      usage: payload?.result?.usage || null,
      modelUri: `gpt://${folderId}/${model}/latest`,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`YandexGPT: таймаут ${timeoutMs} мс`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export { readYandexConfig };
