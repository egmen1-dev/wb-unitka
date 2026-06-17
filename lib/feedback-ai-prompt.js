const MATERIAL_TERMS = [
  { key: 'metal', words: ['металл', 'металлич', 'сталь', 'желез', 'ржав'], label: 'металл' },
  { key: 'plastic', words: ['пластик', 'пластмасс', 'полипропилен', 'abs'], label: 'пластик' },
  { key: 'wood', words: ['дерев', 'деревян'], label: 'дерево' },
  { key: 'aluminum', words: ['алюмин', 'алюминий'], label: 'алюминий' },
  { key: 'fabric', words: ['ткан', 'текстил', 'хлопок', 'полиэстер'], label: 'ткань' },
];

const COMPLAINT_PATTERNS = {
  size: ['размер', 'маломер', 'большемер', 'велик', 'мал', 'длин', 'коротк', 'ширин', 'узк', 'тесн', 'свободн'],
  weight: ['тяжел', 'легк', 'вес', 'массивн', 'хлипк', 'тонк'],
  color: ['цвет', 'блекл', 'выцвет', 'ярк', 'оттенок'],
  quality: ['качеств', 'брак', 'дефект', 'слом', 'тресн', 'дешев', 'хлипк', 'неаккурат', 'плох'],
  price: ['дорог', 'дешев', 'цена', 'переплат', 'не стоит'],
  material: MATERIAL_TERMS.flatMap((t) => t.words),
};

const VARIATION_STYLES = [
  'Начни с короткой живой фразы — не с «Спасибо за отзыв».',
  'Добавь конкретную деталь из текста отзыва покупателя.',
  'Заверши мягким приглашением написать в чат заказа, если уместно.',
  'Используй разговорный, но уважительный тон — как в переписке с другом-знакомым.',
  'Избегай канцелярита и шаблонов вроде «благодарим за обратную связь».',
];

function normalizeText(...parts) {
  return parts
    .flat()
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function rowPrice(row) {
  const sale = Number(row?.salePrice);
  if (sale > 0) return sale;
  const our = Number(row?.ourPrice);
  if (our > 0) return our;
  const base = Number(row?.basePrice);
  return base > 0 ? base : 0;
}

function detectMaterialKey(text) {
  const hay = normalizeText(text);
  for (const term of MATERIAL_TERMS) {
    if (term.words.some((w) => hay.includes(w))) return term.key;
  }
  return null;
}

function materialLabel(key) {
  return MATERIAL_TERMS.find((t) => t.key === key)?.label || key;
}

function rowHaystack(row) {
  return normalizeText(row?.title, row?.subjectName, row?.description, formatCharacteristics(row?.characteristics));
}

function formatCharacteristics(characteristics) {
  if (!Array.isArray(characteristics) || !characteristics.length) return '';
  return characteristics
    .map((c) => {
      if (typeof c === 'string') return c;
      const name = String(c?.name || c?.charcName || '').trim();
      const value = String(c?.value || c?.charcValue || c?.values?.join?.(', ') || '').trim();
      return name && value ? `${name}: ${value}` : name || value;
    })
    .filter(Boolean)
    .join('; ');
}

/** Разбор тем жалобы для любой категории товаров. */
export function parseComplaintThemes(feedback = {}) {
  const hay = normalizeText(feedback.text, feedback.cons, feedback.pros);
  const themes = [];
  for (const [key, words] of Object.entries(COMPLAINT_PATTERNS)) {
    if (words.some((w) => hay.includes(w))) themes.push(key);
  }
  if (detectMaterialKey(hay)) themes.push('material');
  return [...new Set(themes)];
}

function isAnalogousProduct(current, row) {
  if (!current || !row) return false;
  const rowNm = Number(row.nmId);
  const currentNm = Number(current.nmId);
  if (!rowNm || rowNm === currentNm) return false;
  if (current.subjectId && row.subjectId && current.subjectId === row.subjectId) return true;
  if (
    current.brand &&
    row.brand &&
    current.brand === row.brand &&
    current.subjectName &&
    row.subjectName &&
    current.subjectName === row.subjectName
  ) {
    return true;
  }
  if (current.brand && row.brand && current.brand === row.brand && current.subjectName) {
    const a = normalizeText(current.subjectName);
    const b = normalizeText(row.subjectName);
    if (a && b && (a.includes(b) || b.includes(a))) return true;
  }
  return false;
}

function scoreCandidate(row, current, themes, complaintMaterial, feedback = {}) {
  let score = 0;
  const rowMaterial = detectMaterialKey(rowHaystack(row));
  const currentMaterial = detectMaterialKey(rowHaystack(current));
  const price = rowPrice(row);
  const currentPrice = rowPrice(current);

  if (current?.brand && row.brand === current.brand) score += 2;
  if (current?.subjectId && row.subjectId === current.subjectId) score += 3;

  if (themes.includes('material') || complaintMaterial) {
    if (rowMaterial && rowMaterial !== currentMaterial) score += 6;
    if (complaintMaterial && !rowHaystack(row).includes(materialLabel(complaintMaterial))) score += 2;
  }

  if (themes.includes('size') && row.title !== current?.title) score += 4;
  if (themes.includes('weight')) {
    const hay = rowHaystack(row);
    const complaintHay = normalizeText(feedback?.text, feedback?.cons);
    if (complaintHay.includes('тяжел') || complaintHay.includes('массивн')) {
      if (hay.includes('легк') || hay.includes('облегч')) score += 5;
    } else if (hay.includes('усилен') || hay.includes('прочн')) score += 4;
  }
  if (themes.includes('quality') || themes.includes('price')) score += 2;
  if (themes.includes('color') && row.title !== current?.title) score += 3;

  // Премиум-апселл: чем дороже аналог при прочих равных — тем лучше
  if (price > currentPrice) score += 4 + Math.min(3, Math.floor((price - currentPrice) / 500));

  return { score, rowMaterial, price, currentPrice };
}

function sortByPriceDesc(a, b) {
  return rowPrice(b) - rowPrice(a) || b.score - a.score;
}

function formatPriceRub(price) {
  if (!price || price <= 0) return null;
  return `${Math.round(price).toLocaleString('ru-RU')} ₽`;
}

function toAlternativeResult(row, { reason, analogyType, currentPrice }) {
  const price = rowPrice(row);
  return {
    nmId: row.nmId,
    article: String(row.vendorCode || '').trim(),
    title: row.title || '',
    price,
    priceLabel: formatPriceRub(price),
    currentPrice,
    currentPriceLabel: formatPriceRub(currentPrice),
    priceDelta: price > currentPrice ? price - currentPrice : 0,
    reason,
    analogyType,
  };
}

export function catalogRowToProductContext(row, extra = {}) {
  if (!row) return null;
  const price = rowPrice(row);
  return {
    nmId: row.nmId,
    article: String(row.vendorCode || row.article || '').trim(),
    title: row.title || '',
    brand: row.brand || '',
    subjectId: row.subjectId,
    subjectName: row.subjectName || '',
    price,
    priceLabel: formatPriceRub(price),
    description: extra.description || row.description || row.title || '',
    characteristics: extra.characteristics || row.characteristics || [],
    dimensions:
      row.lengthCm || row.widthCm || row.heightCm
        ? `${row.lengthCm || '?'}×${row.widthCm || '?'}×${row.heightCm || '?'} см, ${row.weightKg || '?'} кг`
        : '',
  };
}

/**
 * Подбор альтернативы с апселлом: аналог в той же категории, предпочтительно дороже.
 */
export function pickAlternativeProduct(rows = [], feedback = {}, currentNmId = null) {
  const nmId = Number(currentNmId || feedback.nmId) || 0;
  const current = rows.find((r) => Number(r.nmId) === nmId) || null;
  const themes = parseComplaintThemes(feedback);
  const complaintMaterial = detectMaterialKey(normalizeText(feedback.text, feedback.cons, feedback.pros));
  const currentPrice = rowPrice(current);

  let pool = rows
    .filter((row) => isAnalogousProduct(current, row))
    .map((row) => {
      const scored = scoreCandidate(row, current, themes, complaintMaterial, feedback);
      return { row, ...scored };
    })
    .filter((c) => c.score > 0);

  // Если карточки нет в синке — ищем по бренду из отзыва
  if (!pool.length && !current && feedback.brandName) {
    pool = rows
      .filter((row) => Number(row.nmId) !== nmId && row.brand === feedback.brandName)
      .map((row) => {
        const scored = scoreCandidate(row, { nmId, brand: feedback.brandName }, themes, complaintMaterial, feedback);
        return { row, ...scored };
      })
      .filter((c) => c.score > 0);
  }

  if (!pool.length) return null;

  // Сначала кандидаты дороже текущего — премиум-апселл
  const pricier = pool.filter((c) => c.price > currentPrice).sort(sortByPriceDesc);
  const cheaper = pool.filter((c) => c.price <= currentPrice).sort((a, b) => b.score - a.score);

  const pick = pricier[0] || cheaper[0];
  if (!pick) return null;

  let analogyType = 'category';
  let reason = current?.subjectName
    ? `аналог в категории «${current.subjectName}»`
    : 'похожий товар из вашего каталога';

  if (themes.includes('material') || complaintMaterial) {
    analogyType = 'material';
    reason = pick.rowMaterial
      ? `другой материал (${materialLabel(pick.rowMaterial)}), премиум-линейка`
      : 'другие характеристики в той же категории';
  } else if (themes.includes('quality') || themes.includes('price')) {
    analogyType = 'premium';
    reason = 'жалоба на качество/цену — предложена более дорогая модель';
  } else if (themes.includes('size')) {
    analogyType = 'size';
    reason = 'другая модель/размерная линейка в той же категории';
  } else if (themes.includes('weight')) {
    analogyType = 'weight';
    reason = 'другой вариант по весу/прочности в категории';
  } else if (pick.price > currentPrice) {
    analogyType = 'premium';
    reason = 'более продвинутая модель в линейке (выше цена)';
  }

  if (pick.price > currentPrice) {
    reason += ` (+${formatPriceRub(pick.price - currentPrice) || 'дороже'})`;
  }

  return toAlternativeResult(pick.row, { reason, analogyType, currentPrice });
}

/** Мягкий премиум-апселл для положительных отзывов (4–5★). */
export function pickPremiumUpsell(rows = [], currentNmId = null) {
  const nmId = Number(currentNmId) || 0;
  const current = rows.find((r) => Number(r.nmId) === nmId) || null;
  if (!current) return null;

  const currentPrice = rowPrice(current);
  const pricier = rows
    .filter((row) => isAnalogousProduct(current, row) && rowPrice(row) > currentPrice)
    .sort((a, b) => rowPrice(b) - rowPrice(a));

  const best = pricier[0];
  if (!best) return null;

  return toAlternativeResult(best, {
    analogyType: 'soft-premium',
    reason: 'для довольного покупателя — мягко упомянуть старшую модель в линейке',
    currentPrice,
  });
}

export function listAlternativeCandidates(rows = [], feedback = {}, currentNmId = null, limit = 5) {
  const nmId = Number(currentNmId || feedback.nmId) || 0;
  const current = rows.find((r) => Number(r.nmId) === nmId) || null;
  const themes = parseComplaintThemes(feedback);
  const complaintMaterial = detectMaterialKey(normalizeText(feedback.text, feedback.cons, feedback.pros));
  const currentPrice = rowPrice(current);
  const rating = Number(feedback?.rating) || 0;

  const pool = rows
    .filter((row) => isAnalogousProduct(current, row))
    .map((row) => {
      const scored = scoreCandidate(row, current, themes, complaintMaterial, feedback);
      return { row, ...scored };
    })
    .filter((c) => c.score > 0);

  const sorted =
    rating >= 4
      ? pool.filter((c) => c.price > currentPrice).sort(sortByPriceDesc)
      : pool.sort(sortByPriceDesc);

  return sorted.slice(0, limit).map(({ row, score, price }) => ({
    nmId: row.nmId,
    article: String(row.vendorCode || '').trim(),
    title: row.title || '',
    brand: row.brand || '',
    subjectName: row.subjectName || '',
    price,
    priceLabel: formatPriceRub(price),
    score,
  }));
}

export function validateFeedbackAnswer(text) {
  const answer = String(text || '').trim();
  const errors = [];
  if (answer.length < 2) errors.push('Минимум 2 символа');
  if (answer.length > 1000) errors.push('Максимум 1000 символов');
  if (/https?:\/\//i.test(answer) || /www\./i.test(answer)) errors.push('Без ссылок');
  if (/\+?\d[\d\s\-()]{8,}/.test(answer)) errors.push('Без телефонов');
  if (/%|скидк|промокод/i.test(answer)) errors.push('Без скидок и промокодов');
  if (answer === answer.toUpperCase() && answer.length > 20) errors.push('Без CAPS LOCK');
  if (/\bвы\b|\bвас\b|\bвам\b/i.test(answer)) errors.push('Используй «ты», не «вы»');
  return { ok: !errors.length, errors, text: answer };
}

function ratingStrategy(rating, alternative, premiumUpsell) {
  if (rating >= 5) {
    return `Восторженная благодарность на «ты» — живо, с отсылкой к конкретным словам из отзыва. ${
      premiumUpsell
        ? 'Мягко, без навязчивости, упомяни старшую модель (артикул и название) — «если захочешь апгрейд».'
        : 'Покажи, что отзыв реально прочитали.'
    }`;
  }
  if (rating >= 4) {
    return `Тёплое спасибо на «ты», отзеркаль что понравилось покупателю. ${
      premiumUpsell
        ? 'Опционально — одна фраза про более продвинутую модель в линейке, без давления.'
        : 'Будь искренним, не шаблонным.'
    }`;
  }
  if (rating >= 3) {
    return 'Нейтрально-дружелюбно: поблагодари за честность, поясни характеристики без оправданий. Если есть более дорогой аналог — ненавязчиво предложи как вариант «если нужен другой уровень».';
  }
  return 'Эмпатия без признания вины. Товар мог не подойти под задачу — сослаться на характеристики. Предложи более дорогой/подходящий артикул из каталога как апгрейд, не как «замену брака».';
}

function variationHint(seed) {
  const n = Number(seed) || Date.now();
  const style = VARIATION_STYLES[Math.abs(n) % VARIATION_STYLES.length];
  const angle = ['юмор без сарказма', 'конкретика из отзыва', 'образ из быта', 'короткий комплимент товару'][
    Math.abs(n >> 2) % 4
  ];
  return `Вариант #${Math.abs(n) % 1000}: ${style} Угол подачи: ${angle}. Не повторяй формулировки из прошлых ответов — каждый раз новая фразировка.`;
}

export function buildFeedbackPrompt({
  feedback,
  product,
  alternative,
  premiumUpsell = null,
  candidates = [],
  variationSeed = null,
  regenerate = false,
}) {
  const rating = Number(feedback?.rating) || 0;
  const productChars = formatCharacteristics(product?.characteristics);
  const upsell = rating >= 4 ? premiumUpsell : alternative;
  const upsellTarget = upsell || alternative;

  const altBlock = upsellTarget
    ? `SKU для упоминания: артикул ${upsellTarget.article}, «${upsellTarget.title}»${
        upsellTarget.priceLabel ? `, цена ~${upsellTarget.priceLabel}` : ''
      }. Тип: ${upsellTarget.analogyType}. Причина: ${upsellTarget.reason}. ${
        rating >= 4
          ? 'Упомяни мягко, одной фразой, без навязывания.'
          : 'Предложи как более подходящий/продвинутый вариант в линейке.'
      }`
    : candidates.length
      ? `Кандидаты (от дорогих к дешёвым):\n${candidates
          .map(
            (c) =>
              `- арт. ${c.article}: ${c.title}${c.priceLabel ? ` (~${c.priceLabel})` : ''}`
          )
          .join('\n')}`
      : 'Подходящего аналога в каталоге нет — не выдумывай артикул.';

  const regenNote = regenerate
    ? 'Это ПЕРЕГЕНЕРАЦИЯ — напиши принципиально другой текст, другие обороты и структуру.'
    : '';

  return `Ты — живой менеджер магазина на Wildberries. Напиши ответ на отзыв — интересно, по-человечески, не скучно.

СТРАТЕГИЯ (рейтинг ${rating}/5): ${ratingStrategy(rating, alternative, premiumUpsell)}

${variationHint(variationSeed)}
${regenNote}

ЖЁСТКИЕ ПРАВИЛА:
- Обращайся на «ты». Тепло, с характером, но уважительно. Никогда не груби.
- НЕ признавай вину продавца («наша ошибка», «виноваты», «извините за брак»). Товар мог не подойти под задачу/ожидания.
- Отзеркаль 1–2 конкретные детали из отзыва (слова покупателя).
- Ссылайся на характеристики товара из контекста.
- Без телефонов, ссылок, скидок, промокодов. Без CAPS LOCK.
- 3–6 предложений, 2–1000 символов. Только готовый текст ответа.

ОТЗЫВ:
Рейтинг: ${rating}/5
Текст: ${feedback?.text || '—'}
Плюсы: ${feedback?.pros || '—'}
Минусы: ${feedback?.cons || '—'}

ТОВАР:
Название: ${product?.title || feedback?.productName || '—'}
Артикул: ${product?.article || feedback?.article || '—'}
Цена: ${product?.priceLabel || '—'}
Бренд: ${product?.brand || feedback?.brandName || '—'}
Категория: ${product?.subjectName || '—'}
Описание: ${product?.description || '—'}
Характеристики: ${productChars || '—'}
Габариты: ${product?.dimensions || '—'}

${altBlock}`;
}

const TEMPLATE_OPENERS_POSITIVE = [
  (name) => `Круто, что зашло${name}!`,
  (name) => `Ого, спасибо за такие слова${name}!`,
  (name) => `Приятно читать${name} —`,
  (name) => `Супер${name}, рады, что попали в точку!`,
];

const TEMPLATE_OPENERS_NEGATIVE = [
  (name) => `Понимаю тебя${name} —`,
  (name) => `Спасибо, что написал честно${name}.`,
  (name) => `Жаль, что ожидания не совпали${name},`,
  (name) => `Сочувствую${name}:`,
];

function pickFromSeed(arr, seed) {
  const n = Math.abs(Number(seed) || Date.now());
  return arr[n % arr.length];
}

/** Шаблон без OpenAI — с вариативностью по seed. */
export function buildTemplateDraft({ feedback, product, alternative, premiumUpsell = null, variationSeed = null }) {
  const rating = Number(feedback?.rating) || 0;
  const seed = variationSeed ?? Date.now();
  const name = feedback?.userName ? `, ${feedback.userName}` : '';
  const snippet = [feedback?.pros, feedback?.text].filter(Boolean).join(' ').slice(0, 60);

  if (rating >= 4) {
    const opener = pickFromSeed(TEMPLATE_OPENERS_POSITIVE, seed)(name);
    const mirror = snippet ? ` Особенно про «${snippet.trim()}» — приятно.` : '';
    const premium = premiumUpsell?.article
      ? ` Кстати, если захочешь апгрейд — глянь арт. ${premiumUpsell.article} («${premiumUpsell.title}»${
          premiumUpsell.priceLabel ? `, ~${premiumUpsell.priceLabel}` : ''
        }), там поинтереснее фишки.`
      : '';
    return `${opener}${mirror}${premium} Хороших покупок!`;
  }

  if (rating >= 3) {
    const chars = formatCharacteristics(product?.characteristics);
    const charHint = chars ? ` ${chars.split(';').slice(0, 1).join('')} —` : '';
    const alt = alternative?.article
      ? ` Если нужен другой уровень — арт. ${alternative.article} («${alternative.title}»${
          alternative.priceLabel ? `, ~${alternative.priceLabel}` : ''
        }).`
      : '';
    return `Спасибо за честный отзыв${name}!${charHint} у этого товара своя специализация.${alt} Напиши в чат заказа — подберём точнее.`;
  }

  const opener = pickFromSeed(TEMPLATE_OPENERS_NEGATIVE, seed)(name);
  const chars = formatCharacteristics(product?.characteristics);
  const fitHint = chars
    ? ` По карточке: ${chars.split(';').slice(0, 2).join('; ')} — видимо, под твою задачу нужен другой формат.`
    : product?.title
      ? ` «${product.title}» — базовый вариант в линейке.`
      : '';

  const pricePart =
    alternative?.priceLabel && alternative?.priceDelta
      ? ` (~${alternative.priceLabel}, +${formatPriceRub(alternative.priceDelta)})`
      : alternative?.priceLabel
        ? ` (~${alternative.priceLabel})`
        : '';
  const altHint = alternative?.article
    ? ` Загляни на арт. ${alternative.article} — «${alternative.title}»${pricePart} — продвинутее по характеристикам.`
    : '';

  return `${opener}${fitHint}${altHint} Напиши в чат заказа — поможем с выбором.`;
}
