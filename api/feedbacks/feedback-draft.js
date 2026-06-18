import { fetchContentCardsByNmIds, withWbApiToken } from '../../lib/wb-official-api.js';
import {
  buildTemplateDraft,
  catalogRowToProductContext,
  detectBuyerScenario,
  listAlternativeCandidates,
  pickAlternativeProduct,
  pickPremiumUpsell,
  reviewAsksContact,
  validateDraftQuality,
  validateFeedbackAnswer,
} from '../../lib/feedback-ai-prompt.js';
import {
  buildManagerSystemPrompt,
  buildReviewUserMessage,
  mapManagerScenarioLabel,
} from '../../lib/feedback-manager-prompt.js';
import { getDeployMeta } from '../../lib/deploy-meta.js';
import { completeYandexGpt, pickYandexModel, readYandexConfig } from '../../lib/yandex-gpt.js';
import { serializeFeedback } from '../../lib/wb-feedbacks.js';

const MAX_QUALITY_RETRIES = 3;
const QUALITY_ERROR = 'Не удалось сгенерировать качественный ответ. Попробуйте перегенерировать.';

function readToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const fromHeader = String(header).replace(/^Bearer\s+/i, '').trim();
  if (fromHeader) return fromHeader;
  if (req.body?.token) return String(req.body.token).trim();
  return process.env.WB_API_TOKEN?.trim() || null;
}

function cardCharacteristics(card) {
  const items = [];
  for (const group of card?.characteristics || []) {
    const name = String(group?.name || '').trim();
    const values = Array.isArray(group?.value) ? group.value : group?.value ? [group.value] : [];
    const value = values.map((v) => String(v).trim()).filter(Boolean).join(', ');
    if (name && value) items.push({ name, value });
  }
  if (card?.description?.trim()) {
    items.push({ name: 'Описание', value: card.description.trim().slice(0, 500) });
  }
  return items;
}

function findCatalogRow(rows, feedback) {
  const nmId = Number(feedback?.nmId) || 0;
  const article = String(feedback?.article || '').trim();
  return (
    rows.find((r) => Number(r.nmId) === nmId) ||
    rows.find((r) => String(r.vendorCode || '').trim() === article) ||
    null
  );
}

async function enrichProductFromContent(token, row, feedback) {
  const nmId = Number(row?.nmId || feedback?.nmId) || 0;
  if (!nmId || !token) {
    return catalogRowToProductContext(row, {
      description: row?.title || feedback?.productName || '',
    });
  }

  try {
    const cards = await withWbApiToken(token, () =>
      fetchContentCardsByNmIds([nmId], { concurrency: 1 })
    );
    const card = cards[0];
    if (!card) {
      return catalogRowToProductContext(row, { description: row?.title || feedback?.productName || '' });
    }
    return catalogRowToProductContext(row, {
      description: card.description?.trim() || row?.title || feedback?.productName || '',
      characteristics: cardCharacteristics(card),
    });
  } catch {
    return catalogRowToProductContext(row, { description: row?.title || feedback?.productName || '' });
  }
}

async function generateWithOpenAI(userPrompt, systemPrompt, apiKey, { regenerate = false } = {}) {
  const temperature = regenerate ? 0.85 : 0.8;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature,
      top_p: 0.95,
      presence_penalty: regenerate ? 0.6 : 0.35,
      frequency_penalty: regenerate ? 0.5 : 0.2,
      max_tokens: 450,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`OpenAI: неверный ответ (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI ${response.status}`);
  }

  const draft = String(payload?.choices?.[0]?.message?.content || '').trim();
  if (!draft) throw new Error('OpenAI вернул пустой ответ');
  return draft;
}

async function generateWithYandex(userPrompt, systemPrompt, { regenerate = false, reviewLength = 0 } = {}) {
  const temperature = regenerate ? 0.85 : 0.8;
  const model = pickYandexModel(reviewLength);
  const opts = {
    system: systemPrompt,
    user: userPrompt,
    temperature,
    maxTokens: 550,
  };
  try {
    const { text } = await completeYandexGpt({ ...opts, model });
    return text;
  } catch (error) {
    const envModel = process.env.YANDEX_GPT_MODEL?.trim();
    if (!envModel && model !== 'yandexgpt-lite') {
      const { text } = await completeYandexGpt({ ...opts, model: 'yandexgpt-lite' });
      return text;
    }
    throw error;
  }
}

function reviewCharCount(feedback) {
  return [feedback?.text, feedback?.pros, feedback?.cons].filter(Boolean).join(' ').length;
}

async function callAiProvider({
  yandexConfigured,
  openaiKey,
  userPrompt,
  systemPrompt,
  regenerate,
  reviewLength,
}) {
  if (yandexConfigured) {
    try {
      const draft = await generateWithYandex(userPrompt, systemPrompt, { regenerate, reviewLength });
      return { draft, provider: 'yandex', source: regenerate ? 'yandex-regen' : 'yandex' };
    } catch (error) {
      console.error('[feedbacks/feedback-draft] YandexGPT', error);
      if (openaiKey) {
        const draft = await generateWithOpenAI(userPrompt, systemPrompt, openaiKey, { regenerate });
        return { draft, provider: 'openai', source: regenerate ? 'openai-regen' : 'openai' };
      }
      throw error;
    }
  }
  if (openaiKey) {
    const draft = await generateWithOpenAI(userPrompt, systemPrompt, openaiKey, { regenerate });
    return { draft, provider: 'openai', source: regenerate ? 'openai-regen' : 'openai' };
  }
  return null;
}

async function generateDraftWithQuality({
  userPrompt,
  systemPrompt,
  yandexConfigured,
  openaiKey,
  regenerate,
  reviewLength,
  qualityContext,
}) {
  let draft;
  let source;
  let provider;
  let qualityRetried = 0;
  let activeSystemPrompt = systemPrompt;

  for (let attempt = 0; attempt <= MAX_QUALITY_RETRIES; attempt += 1) {
    const isRetry = attempt > 0;
    const aiResult = await callAiProvider({
      yandexConfigured,
      openaiKey,
      userPrompt,
      systemPrompt: activeSystemPrompt,
      regenerate: isRetry || regenerate,
      reviewLength,
    });

    if (!aiResult) {
      throw new Error('AI не настроен');
    }

    draft = aiResult.draft;
    source = aiResult.source;
    provider = aiResult.provider;

    const quality = validateDraftQuality(draft, qualityContext);
    if (quality.ok) {
      return { draft, source, provider, quality, qualityRetried };
    }

    if (attempt < MAX_QUALITY_RETRIES) {
      qualityRetried += 1;
      activeSystemPrompt = `${systemPrompt}\n\nПРЕДЫДУЩИЙ ОТВЕТ ОТКЛОНЁН (попытка ${attempt + 1}/${MAX_QUALITY_RETRIES}): ${quality.issues.join('; ')}. Перепиши полностью, исправь все замечания. Не используй шаблонные фразы.`;
      console.warn('[feedbacks/feedback-draft] quality retry', attempt + 1, quality.issues);
    } else {
      const err = new Error(QUALITY_ERROR);
      err.quality = quality;
      err.provider = provider;
      throw err;
    }
  }

  throw new Error(QUALITY_ERROR);
}

function aiHint({ yandexConfigured, openaiConfigured }) {
  if (yandexConfigured || openaiConfigured) return undefined;
  return 'Задайте YANDEX_GPT_API_KEY (или YANDEX_CLOUD_API_KEY) + YANDEX_FOLDER_ID в Vercel, либо OPENAI_API_KEY. Сейчас используется шаблон.';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Используйте POST' });
  }

  const token = readToken(req);
  const feedback = serializeFeedback(req.body?.feedback) || req.body?.feedback;
  if (!feedback?.id) {
    return res.status(400).json({ error: 'Укажите объект feedback' });
  }

  const regenerate = req.body?.regenerate === true;
  const variationSeed =
    req.body?.variationSeed != null
      ? Number(req.body.variationSeed) || Date.now()
      : regenerate
        ? Date.now()
        : null;

  const catalogRows = Array.isArray(req.body?.catalogRows) ? req.body.catalogRows : [];
  const row = findCatalogRow(catalogRows, feedback);
  const product = await enrichProductFromContent(token, row, feedback);
  const rating = Number(feedback?.rating) || 0;
  const alternative = pickAlternativeProduct(catalogRows, feedback, feedback.nmId);
  const premiumUpsell = rating >= 4 ? pickPremiumUpsell(catalogRows, feedback.nmId) : null;
  const scenario = detectBuyerScenario(feedback);
  const candidates = listAlternativeCandidates(catalogRows, feedback, feedback.nmId, 6);

  const systemPrompt = buildManagerSystemPrompt({
    product,
    alternative,
    premiumUpsell,
    scenario,
    feedback,
    variationSeed,
    regenerate,
    buyerName: feedback?.userName || null,
    buyerGender: feedback?.buyerGender || null,
  });
  const userPrompt = buildReviewUserMessage({ feedback });

  const yandexConfigured = Boolean(readYandexConfig());
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const aiAvailable = yandexConfigured || Boolean(openaiKey);
  const deployMeta = getDeployMeta();

  const templateArgs = { feedback, product, alternative, premiumUpsell, variationSeed, scenario };
  const reviewLength = reviewCharCount(feedback);
  const allowChat = reviewAsksContact(feedback);
  const qualityContext = {
    scenario,
    feedback,
    alternative,
    premiumUpsell,
    reviewAsksContact: allowChat,
    managerStyle: true,
  };

  let draft;
  let source = 'template';
  let provider = 'template';
  let quality = null;
  let qualityRetried = false;

  if (!aiAvailable) {
    draft = buildTemplateDraft(templateArgs);
    source = 'template';
    provider = 'template';
    quality = validateDraftQuality(draft, qualityContext);
    if (!quality.ok) {
      return res.status(503).json({
        error: QUALITY_ERROR,
        ...deployMeta,
        hint: quality.issues.join('; '),
        provider: 'template',
        source: 'template-error',
        quality,
        yandexConfigured: false,
        openaiConfigured: false,
        scenario: {
          type: scenario.type,
          label: scenario.label,
          tone: scenario.tone,
        },
      });
    }
  } else {
    try {
      const result = await generateDraftWithQuality({
        userPrompt,
        systemPrompt,
        yandexConfigured,
        openaiKey,
        regenerate,
        reviewLength,
        qualityContext,
      });
      draft = result.draft;
      source = result.source;
      provider = result.provider;
      quality = result.quality;
      qualityRetried = result.qualityRetried;
    } catch (error) {
      console.error('[feedbacks/feedback-draft] AI generation failed', error);
      const generationError = error.message || QUALITY_ERROR;
      return res.status(503).json({
        error: generationError,
        ...deployMeta,
        hint:
          error.quality?.issues?.length > 0
            ? `Проблемы: ${error.quality.issues.slice(0, 3).join('; ')}`
            : 'Проверьте ключи YandexGPT/OpenAI в Vercel или попробуйте перегенерировать.',
        provider: error.provider || (yandexConfigured ? 'yandex' : 'openai'),
        source: 'ai-error',
        quality: error.quality || null,
        qualityRetried: MAX_QUALITY_RETRIES,
        yandexConfigured,
        openaiConfigured: Boolean(openaiKey),
        scenario: {
          type: scenario.type,
          label: scenario.label,
          tone: scenario.tone,
        },
      });
    }
  }

  const validation = validateFeedbackAnswer(draft);

  return res.status(200).json({
    draft: validation.text,
    source,
    provider,
    ...deployMeta,
    regenerate,
    variationSeed,
    yandexConfigured,
    openaiConfigured: Boolean(openaiKey),
    scenario: {
      type: scenario.type,
      label: scenario.label,
      managerLabel: mapManagerScenarioLabel(scenario, feedback),
      tone: scenario.tone,
      keywords: scenario.keywords,
      mirrorPhrases: scenario.mirrorPhrases,
    },
    parsedReview: {
      bables: scenario.parsed.bables,
      matchingSize: scenario.parsed.matchingSize,
      themes: scenario.parsed.themes,
    },
    promptPreview: `${systemPrompt.slice(0, 700)}\n---\n${userPrompt.slice(0, 700)}`,
    product,
    alternative,
    premiumUpsell,
    candidates,
    validation,
    quality: quality || validateDraftQuality(draft, qualityContext),
    qualityRetried,
    yandexModel: yandexConfigured ? pickYandexModel(reviewLength) : null,
    hint:
      provider === 'template'
        ? aiHint({ yandexConfigured, openaiConfigured: Boolean(openaiKey) })
        : undefined,
  });
}
