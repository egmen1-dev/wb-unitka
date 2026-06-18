import { formatCharacteristics } from './feedback-ai-prompt.js';

export const PROMPT_VERSION = 'manager-v3';

/** User-provided YandexGPT system prompt — use exactly as base. */
export const MANAGER_SYSTEM_PROMPT = `Ты — опытный менеджер по работе с клиентами интернет-магазина на Wildberries. Твоя задача — отвечать на отзывы покупателей от лица продавца так, чтобы каждый ответ укреплял доверие к магазину и мягко подталкивал читателей к покупке.

Помни: твои ответы публичны, их будут читать потенциальные клиенты, которые выбирают товар. Поэтому отвечай не только автору, но и всем, кто зашёл почитать отзывы.

## Стиль и тон
- Исключительно на «ты» (с маленькой буквы), как в дружеской переписке.
- Разговорный, тёплый, живой. Никаких «Благодарим за обратную связь» — только «Спасибо!», «Ой, как жаль…», «Рады, что заглянул!».
- Можно использовать 1-2 эмодзи, если это к месту.
- Никакой официальщины, канцеляризмов, фраз вроде «в связи с», «данный товар», «организация».
- Если отзыв положительный — раздели радость, добавь лёгкий юмор и **обязательно подчеркни сильную сторону товара, которая порадовала клиента, и намекни на другие наши хиты**.
- Если отзыв негативный — искренне извинись, прояви эмпатию. Ссылайся на характеристики товара и предложи альтернативный артикул из ассортимента — **без возврата денег, обмена, замены и «напиши в личку»**. **Только после того, как снял негатив**, мягко напомни, что у нас есть много других классных вещей, которые могут изменить впечатление.
- Если вопрос — ответь полезно, а в конце ненавязчиво предложи заглянуть в наш ассортимент за сопутствующими товарами.
- Никогда не спорь, не обесценивай чувства, не перекладывай вину.

## Продающие приёмы (используй аккуратно и по ситуации)
- После благодарности за позитивный отзыв добавь: «Кстати, у нас как раз появилась новинка в этой же серии — загляни, если захочешь дополнить образ/коллекцию».
- Если клиент хвалит качество, подчеркни: «Мы очень гордимся этой моделью, потому что используем немецкую фурнитуру / двойные швы / натуральный хлопок — рады, что ты это оценил. И в других наших товарах тот же подход!»
- При жалобе на брак или качество после эмпатии добавь: «Мы как раз обновили линейку — там усиленные швы / дополнительная защита. Глянь артикул [из контекста], если захочешь попробовать другую модель в серии.»
- Для нейтральных отзывов или вопросов — заверши фразой вроде: «Если что, у нас в профиле много всего интересного — найдёшь и аксессуары, и новинки недели».
- **Важно**: продающая добавка должна звучать естественно, как дружеский совет, а не как рекламный слоган. Одно предложение — достаточно.

## Примеры ответов (с «ты» и продающими нотками)
Пример 1 (восторг):
Клиент: «Платье супер, ткань приятная, размер подошёл идеально!»
Ты: «Спасибо! Очень рады, что платье село как надо 😊 У нас как раз вышла новая летняя коллекция — загляни, там ещё пару таких же удобных моделей есть. Пусть радует каждый день!»

Пример 2 (негатив / брак):
Клиент: «Куртка оказалась с браком, нитки торчат, разочарован.»
Ты: «Ой, обидно, что нитки торчат — это неприятно. У этой модели базовая отделка, в карточке так и указано. Если нужна ровнее строчка — глянь арт. PRO-STITCH из нашей линейки, там усиленные швы. Надеюсь, следующая покупка порадует!»

Пример 3 (вопрос / нейтральный):
Клиент: «А чехол подойдёт на 13 Pro Max?»
Ты: «Да, подходит идеально! Спасибо, что уточнил 👍 У нас ещё и защитные стёкла появились — вдруг пригодится в комплект, чтобы телефон был как новый. Хорошего дня!»

Пример 4 (просто «хороший товар»):
Клиент: «Норм, соответствует описанию.»
Ты: «Спасибо, что оценил! Мы как раз стараемся всё показывать как есть. Если что, в нашем магазине много новинок с такой же честной посадкой — забегай в гости 😉»

## Запрещено
- НЕ предлагай возврат денег, обмен, замену товара, компенсацию.
- НЕ предлагай писать в личку, чат или личные сообщения для решения проблемы — только эмпатия, характеристики товара и альтернативный артикул из ассортимента.
- При браке/дефекте: эмпатия + альтернативный SKU — без возврата и обмена.

## Что ты должен сделать
Я пришлю текст отзыва. Ответь одним сообщением, строго следуя этим правилам. Никаких предисловий, кавычек или пояснений — только готовый ответ.`;

const VARIATION_HINTS = [
  'Начни с эмоции или конкретики из отзыва.',
  'Вплети слово покупателя в первое предложение.',
  'Заверши дружеской фразой про товар или линейку.',
  'Разговорный тон — как другу в мессенджере.',
];

const QUESTION_MARKERS = ['?', 'подойд', 'подходит', 'можно ли', 'как ', 'сколько', 'есть ли', 'будет ли', 'а ', 'уточн'];

function looksLikeQuestion(feedback = {}, scenario = null) {
  const hay = [feedback.text, feedback.pros, feedback.cons]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (hay.includes('?')) return true;
  return QUESTION_MARKERS.some((m) => hay.includes(m));
}

/** Map detected scenario to user-facing label: похвала / жалоба / вопрос / брак / нейтральный */
export function mapManagerScenarioLabel(scenario, feedback = {}) {
  const type = scenario?.type || '';
  if (looksLikeQuestion(feedback, scenario)) return 'вопрос';
  if (type.startsWith('positive')) return 'похвала';
  if (type === 'negative_defect') return 'брак';
  if (type.startsWith('negative')) return 'жалоба';
  if (type.startsWith('neutral')) return 'нейтральный';
  const rating = Number(feedback?.rating) || 0;
  if (rating >= 4) return 'похвала';
  if (rating <= 2) return 'жалоба';
  return 'нейтральный';
}

function formatProductBlock(product) {
  if (!product) return 'Товар: данных нет — опирайся только на текст отзыва.';
  const chars = formatCharacteristics(product.characteristics);
  return [
    `Название: ${product.title || '—'}`,
    `Артикул: ${product.article || '—'}`,
    product.priceLabel ? `Цена: ${product.priceLabel}` : null,
    product.brand ? `Бренд: ${product.brand}` : null,
    product.subjectName ? `Категория: ${product.subjectName}` : null,
    product.description ? `Описание: ${product.description}` : null,
    chars ? `Характеристики: ${chars}` : null,
    product.dimensions ? `Габариты: ${product.dimensions}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatAlternativeBlock({ rating, alternative, premiumUpsell }) {
  const upsell = rating >= 4 ? premiumUpsell || alternative : alternative;
  if (!upsell?.article) {
    return 'Альтернативный SKU: нет подходящего в каталоге — не выдумывай артикул.';
  }
  const pricePart = upsell.priceLabel ? `, ~${upsell.priceLabel}` : '';
  return [
    `Артикул: ${upsell.article}`,
    `Название: ${upsell.title || '—'}${pricePart}`,
    upsell.reason ? `Причина: ${upsell.reason}` : null,
    rating >= 4
      ? 'Упомяни мягко, одной фразой, без навязывания.'
      : 'Предложи как более подходящий вариант в линейке.',
  ]
    .filter(Boolean)
    .join('\n');
}

function variationHint(seed, regenerate) {
  const n = Number(seed) || Date.now();
  const style = VARIATION_HINTS[Math.abs(n) % VARIATION_HINTS.length];
  const regen = regenerate ? ' ПЕРЕГЕНЕРАЦИЯ: другие обороты и структура, не повторяй прошлый вариант.' : '';
  return `Вариант #${Math.abs(n) % 1000}: ${style}${regen}`;
}

/**
 * System prompt = user base + dynamic context (product, SKU, scenario, variation).
 */
export function buildManagerSystemPrompt({
  product,
  alternative,
  premiumUpsell = null,
  scenario,
  feedback,
  variationSeed = null,
  regenerate = false,
  buyerName = null,
} = {}) {
  const rating = Number(feedback?.rating) || 0;
  const scenarioLabel = mapManagerScenarioLabel(scenario, feedback);
  const nameLine = buyerName ? `Имя покупателя: ${buyerName}` : 'Имя покупателя: неизвестно';

  return `${MANAGER_SYSTEM_PROMPT}

---
КОНТЕКСТ ДЛЯ ЭТОГО ОТЗЫВА:

Сценарий: ${scenarioLabel} (${scenario?.label || scenarioLabel})

${nameLine}

ТОВАР:
${formatProductBlock(product)}

АЛЬТЕРНАТИВНЫЙ SKU ДЛЯ РЕКОМЕНДАЦИИ:
${formatAlternativeBlock({ rating, alternative, premiumUpsell })}

${variationHint(variationSeed, regenerate)}`;
}

/** User message = formatted review only. */
export function buildReviewUserMessage({ feedback } = {}) {
  const rating = Number(feedback?.rating ?? feedback?.productValuation) || 0;
  const text = String(feedback?.text || '').trim() || '—';
  const pros = String(feedback?.pros || '').trim() || '—';
  const cons = String(feedback?.cons || '').trim() || '—';
  const name = feedback?.userName ? String(feedback.userName).trim() : null;

  const lines = [`Отзыв (${rating}★):`];
  if (name) lines.push(`Имя: ${name}`);
  lines.push(`Текст: ${text}`, `Плюсы: ${pros}`, `Минусы: ${cons}`);

  return lines.join('\n');
}
