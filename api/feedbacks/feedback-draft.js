import { fetchContentCardsByNmIds, withWbApiToken } from '../../lib/wb-official-api.js';
import {
  buildFeedbackSystemPrompt,
  buildFeedbackUserMessage,
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
import { completeYandexGpt, pickYandexModel, readYandexConfig } from '../../lib/yandex-gpt.js';
import { serializeFeedback } from '../../lib/wb-feedbacks.js';

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
  const temperature = regenerate ? 0.95 : 0.88;

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
  const temperature = regenerate ? 0.95 : 0.88;
  const model = pickYandexModel(reviewLength);
  const { text } = await completeYandexGpt({
    system: systemPrompt,
    user: userPrompt,
    temperature,
    maxTokens: 550,
    model,
  });
  return text;
}

function reviewCharCount(feedback) {
  return [feedback?.text, feedback?.pros, feedback?.cons].filter(Boolean).join(' ').length;
}

async function generateDraftWithQuality({
  userPrompt,
  systemPrompt,
  yandexConfigured,
  openaiKey,
  regenerate,
  reviewLength,
  templateArgs,
  qualityContext,
}) {
  let draft;
  let source;
  let provider;
  let qualityRetried = false;

  const runAi = async (isRetry) => {
    if (yandexConfigured) {
      try {
        draft = await generateWithYandex(userPrompt, systemPrompt, {
          regenerate: isRetry || regenerate,
          reviewLength,
        });
        source = isRetry || regenerate ? 'yandex-regen' : 'yandex';
        provider = 'yandex';
        return;
      } catch (error) {
        console.error('[feedbacks/feedback-draft] YandexGPT', error);
        if (openaiKey) {
          draft = await generateWithOpenAI(userPrompt, systemPrompt, openaiKey, {
            regenerate: isRetry || regenerate,
          });
          source = isRetry || regenerate ? 'openai-regen' : 'openai';
          provider = 'openai';
          return;
        }
        throw error;
      }
    }
    if (openaiKey) {
      draft = await generateWithOpenAI(userPrompt, systemPrompt, openaiKey, {
        regenerate: isRetry || regenerate,
      });
      source = isRetry || regenerate ? 'openai-regen' : 'openai';
      provider = 'openai';
      return;
    }
    draft = buildTemplateDraft(templateArgs);
    source = 'template-fallback';
    provider = 'template';
  };

  await runAi(false);

  let quality = validateDraftQuality(draft, qualityContext);
  if (!quality.ok && provider !== 'template') {
    qualityRetried = true;
    const retrySystem = `${systemPrompt}\n\nПРЕДЫДУЩИЙ ОТВЕТ ОТКЛОНЁН: ${quality.issues.join('; ')}. Перепиши полностью, исправь все замечания.`;
    await runAi(true);
    quality = validateDraftQuality(draft, qualityContext);
  }

  return { draft, source, provider, quality, qualityRetried };
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

  const systemPrompt = buildFeedbackSystemPrompt({
    scenario,
    variationSeed,
    regenerate,
    buyerName: feedback?.userName || null,
  });
  const userPrompt = buildFeedbackUserMessage({
    feedback,
    product,
    alternative,
    premiumUpsell,
    candidates,
    scenario,
  });

  const yandexConfigured = Boolean(readYandexConfig());
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  const templateArgs = { feedback, product, alternative, premiumUpsell, variationSeed };
  const reviewLength = reviewCharCount(feedback);
  const allowChat = reviewAsksContact(feedback);
  const qualityContext = {
    scenario,
    feedback,
    alternative,
    premiumUpsell,
    reviewAsksContact: allowChat,
  };

  let draft;
  let source = 'template';
  let provider = 'template';
  let quality = null;
  let qualityRetried = false;

  if (yandexConfigured || openaiKey) {
    try {
      const result = await generateDraftWithQuality({
        userPrompt,
        systemPrompt,
        yandexConfigured,
        openaiKey,
        regenerate,
        reviewLength,
        templateArgs,
        qualityContext,
      });
      draft = result.draft;
      source = result.source;
      provider = result.provider;
      quality = result.quality;
      qualityRetried = result.qualityRetried;
    } catch (error) {
      console.error('[feedbacks/feedback-draft] AI generation failed', error);
      draft = buildTemplateDraft(templateArgs);
      source = 'template-fallback';
      provider = 'template';
      quality = validateDraftQuality(draft, qualityContext);
    }
  } else {
    draft = buildTemplateDraft(templateArgs);
    quality = validateDraftQuality(draft, qualityContext);
  }

  const validation = validateFeedbackAnswer(draft);

  return res.status(200).json({
    draft: validation.text,
    source,
    provider,
    regenerate,
    variationSeed,
    yandexConfigured,
    openaiConfigured: Boolean(openaiKey),
    scenario: {
      type: scenario.type,
      label: scenario.label,
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
