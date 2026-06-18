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

const SCENARIO_PATTERNS = {
  negative_delivery: ['доставк', 'курьер', 'упаковк', 'опоздал', 'транспорт', 'получил через', 'пришёл бит'],
  negative_wrong_item: ['не тот', 'другой товар', 'перепутали', 'не то что заказ', 'отправили не', 'не то пришло'],
  negative_defect: ['брак', 'дефект', 'сломал', 'сломан', 'треснул', 'не работает', 'отвалил', 'скол', 'пятн'],
  negative_expectation: ['ожидал', 'не соответств', 'разочар', 'не так', 'не то что', 'обман', 'на фото', 'не подош'],
};

const POSITIVE_PATTERNS = {
  photo: ['фото', 'снимок', 'на картинке', 'выглядит на фото', 'как на фото'],
  repeat: ['второй раз', 'снова заказ', 'повторн', 'не первый', 'уже брал', 'уже покупал', 'вернусь', 'закажу ещё'],
  praise: ['качеств', 'удобн', 'стильн', 'прочн', 'красив', 'мягк', 'лёгк', 'легк', 'отличн', 'супер', 'класс', 'рекоменд'],
};

/** Типы сценариев покупателя для UI и промпта. */
export const SCENARIO_TYPES = {
  NEGATIVE_MATERIAL: 'negative_material',
  NEGATIVE_SIZE: 'negative_size',
  NEGATIVE_QUALITY: 'negative_quality',
  NEGATIVE_DEFECT: 'negative_defect',
  NEGATIVE_EXPECTATION: 'negative_expectation',
  NEGATIVE_DELIVERY: 'negative_delivery',
  NEGATIVE_WRONG_ITEM: 'negative_wrong_item',
  NEGATIVE_PRICE: 'negative_price',
  NEGATIVE_COLOR: 'negative_color',
  NEGATIVE_WEIGHT: 'negative_weight',
  NEGATIVE_GENERAL: 'negative_general',
  NEUTRAL_MIXED: 'neutral_mixed',
  NEUTRAL_MIDDLE: 'neutral_middle',
  POSITIVE_PRAISE: 'positive_praise',
  POSITIVE_REPEAT: 'positive_repeat',
  POSITIVE_PHOTO: 'positive_photo',
  POSITIVE_WOW: 'positive_wow',
  POSITIVE_GENERAL: 'positive_general',
};

export const SCENARIO_LABELS = {
  negative_material: 'Материал не подошёл',
  negative_size: 'Размер не подошёл',
  negative_quality: 'Жалоба на качество',
  negative_defect: 'Брак / дефект',
  negative_expectation: 'Ожидания не совпали',
  negative_delivery: 'Доставка / упаковка',
  negative_wrong_item: 'Не тот товар',
  negative_price: 'Цена / ценность',
  negative_color: 'Цвет не подошёл',
  negative_weight: 'Вес / прочность',
  negative_general: 'Негативный отзыв',
  neutral_mixed: 'Смешанные впечатления',
  neutral_middle: 'Нейтральный отзыв',
  positive_praise: 'Похвала характеристик',
  positive_repeat: 'Повторная покупка',
  positive_photo: 'Упоминание фото',
  positive_wow: 'Восторг (5★)',
  positive_general: 'Положительный отзыв',
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

function normalizeBables(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        return String(item?.name || item?.text || item?.value || '').trim();
      })
      .filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function hayIncludes(hay, words) {
  return words.some((w) => hay.includes(w));
}

function extractMirrorPhrases(feedback = {}) {
  const phrases = [];
  for (const part of [feedback.pros, feedback.text, feedback.cons]) {
    if (!part) continue;
    const chunks = String(part)
      .split(/[.!?,;—–-]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 4 && s.length <= 90);
    phrases.push(...chunks.slice(0, 2));
  }
  return [...new Set(phrases)].slice(0, 5);
}

/** Глубокий разбор текста отзыва: рейтинг, теги WB, ключевые фразы. */
export function parseFeedbackContent(feedback = {}) {
  const rating = Number(feedback.rating ?? feedback.productValuation) || 0;
  const text = String(feedback.text || '').trim();
  const pros = String(feedback.pros || '').trim();
  const cons = String(feedback.cons || '').trim();
  const bables = normalizeBables(
    feedback.bables ?? feedback.bablesList ?? feedback.productBables ?? feedback.tags
  );
  const matchingSize = feedback.matchingSize || null;
  const hay = normalizeText(text, pros, cons, bables.join(' '));
  const themes = parseComplaintThemes(feedback);
  const material = detectMaterialKey(hay);
  const mirrorPhrases = extractMirrorPhrases(feedback);
  const keywords = [
    ...bables,
    ...mirrorPhrases,
    ...(material ? [materialLabel(material)] : []),
    ...themes.map((t) => {
      const map = {
        size: 'размер',
        weight: 'вес',
        color: 'цвет',
        quality: 'качество',
        price: 'цена',
        material: 'материал',
      };
      return map[t] || t;
    }),
  ].filter(Boolean);

  return {
    rating,
    productValuation: rating,
    text,
    pros,
    cons,
    bables,
    matchingSize,
    hay,
    themes,
    material,
    mirrorPhrases,
    keywords: [...new Set(keywords)].slice(0, 12),
    hasPros: Boolean(pros),
    hasCons: Boolean(cons),
    isMixed: Boolean(pros && cons) || (rating === 3 && (pros || cons)),
  };
}

function matchScenarioPatterns(hay, patterns) {
  const hits = [];
  for (const [key, words] of Object.entries(patterns)) {
    if (hayIncludes(hay, words)) hits.push(key);
  }
  return hits;
}

/**
 * Классификация сценария покупателя по тексту, рейтингу и тегам WB.
 * @returns {{ type: string, label: string, tone: 'negative'|'neutral'|'positive', strategy: string, parsed: ReturnType<typeof parseFeedbackContent> }}
 */
export function detectBuyerScenario(feedback = {}) {
  const parsed = parseFeedbackContent(feedback);
  const { rating, hay, themes, material, isMixed, hasPros, hasCons, mirrorPhrases, bables } = parsed;
  const scenarioHits = matchScenarioPatterns(hay, SCENARIO_PATTERNS);
  const positiveHits = matchScenarioPatterns(hay, POSITIVE_PATTERNS);

  let type = SCENARIO_TYPES.POSITIVE_GENERAL;
  let tone = 'positive';

  if (rating <= 2 || (rating <= 3 && hasCons && !hasPros)) {
    tone = 'negative';
    if (scenarioHits.includes('negative_wrong_item')) type = SCENARIO_TYPES.NEGATIVE_WRONG_ITEM;
    else if (scenarioHits.includes('negative_delivery')) type = SCENARIO_TYPES.NEGATIVE_DELIVERY;
    else if (scenarioHits.includes('negative_defect') || themes.includes('quality')) {
      type = themes.includes('quality') && !scenarioHits.includes('negative_defect')
        ? SCENARIO_TYPES.NEGATIVE_QUALITY
        : SCENARIO_TYPES.NEGATIVE_DEFECT;
    } else if (material || themes.includes('material')) type = SCENARIO_TYPES.NEGATIVE_MATERIAL;
    else if (themes.includes('size') || parsed.matchingSize === 'smaller' || parsed.matchingSize === 'bigger') {
      type = SCENARIO_TYPES.NEGATIVE_SIZE;
    } else if (themes.includes('color')) type = SCENARIO_TYPES.NEGATIVE_COLOR;
    else if (themes.includes('weight')) type = SCENARIO_TYPES.NEGATIVE_WEIGHT;
    else if (themes.includes('price')) type = SCENARIO_TYPES.NEGATIVE_PRICE;
    else if (scenarioHits.includes('negative_expectation')) type = SCENARIO_TYPES.NEGATIVE_EXPECTATION;
    else type = SCENARIO_TYPES.NEGATIVE_GENERAL;
  } else if (rating === 3 || isMixed) {
    tone = 'neutral';
    type = isMixed ? SCENARIO_TYPES.NEUTRAL_MIXED : SCENARIO_TYPES.NEUTRAL_MIDDLE;
  } else {
    tone = 'positive';
    if (rating >= 5 && (positiveHits.includes('praise') || hasPros)) type = SCENARIO_TYPES.POSITIVE_WOW;
    else if (positiveHits.includes('repeat')) type = SCENARIO_TYPES.POSITIVE_REPEAT;
    else if (positiveHits.includes('photo')) type = SCENARIO_TYPES.POSITIVE_PHOTO;
    else if (positiveHits.includes('praise') || hasPros) type = SCENARIO_TYPES.POSITIVE_PRAISE;
    else type = SCENARIO_TYPES.POSITIVE_GENERAL;
  }

  const mirrorHint =
    mirrorPhrases.length > 0
      ? `Отзеркаль фразы покупателя: ${mirrorPhrases.map((p) => `«${p}»`).join(', ')}.`
      : bables.length
        ? `Учти теги WB: ${bables.join(', ')}.`
        : 'Отзеркаль 1–2 слова из отзыва.';

  const strategy = scenarioStrategy(type, { mirrorHint });

  return {
    type,
    label: SCENARIO_LABELS[type] || type,
    tone,
    strategy,
    parsed,
    mirrorPhrases,
    keywords: parsed.keywords,
  };
}

function scenarioStrategy(type, { mirrorHint }) {
  const base = {
    negative_material: `Товар мог не подойти по материалу. ${mirrorHint} Поясни материал из характеристик карточки — без извинений за «ошибку». Предложи премиум-артикул с другим материалом.`,
    negative_size: `${mirrorHint} Ссылайся на размерную сетку/габариты. Товар мог не подойти по посадке — предложи другую модель в линейке.`,
    negative_quality: `${mirrorHint} Без признания вины. Уточни, что это базовая модель; предложи более дорогой вариант с лучшими характеристиками.`,
    negative_defect: `${mirrorHint} Эмпатия, но не «наша вина/брак». Предложи написать в чат заказа + альтернативу из линейки.`,
    negative_expectation: `${mirrorHint} Ожидания могли не совпасть с назначением товара — опирайся на описание и характеристики.`,
    negative_delivery: `${mirrorHint} Сочувствие по доставке/упаковке, без обещаний компенсации. Мягко верни разговор к товару и его характеристикам.`,
    negative_wrong_item: `${mirrorHint} Предложи написать в чат заказа для уточнения — без признания ошибки склада.`,
    negative_price: `${mirrorHint} Объясни ценность базовой модели; предложи апгрейд, если нужен другой уровень.`,
    negative_color: `${mirrorHint} Цвет на экране может отличаться — ссылайся на характеристики.`,
    negative_weight: `${mirrorHint} Вес/прочность заложены в спецификацию — предложи другой вариант по массе/усилению.`,
    negative_general: `${mirrorHint} Товар мог не подойти под задачу. Характеристики + премиум-альтернатива.`,
    neutral_mixed: `${mirrorHint} Поблагодари за честность. Отметь плюсы и мягко поясни минусы через характеристики.`,
    neutral_middle: `${mirrorHint} Нейтрально-дружелюбно: поблагодари, поясни назначение товара, предложи апгрейд при необходимости.`,
    positive_praise: `${mirrorHint} Тёплое спасибо — процитируй, что именно понравилось. Мягко упомяни старшую модель.`,
    positive_repeat: `${mirrorHint} Поблагодари за лояльность и повторный заказ. Тепло, без шаблонов.`,
    positive_photo: `${mirrorHint} Поблагодари; отметь, что рад(а), что товар выглядит как надо. Мягкий апселл.`,
    positive_wow: `${mirrorHint} Живая благодарность на «ты» — энергично, но искренне. Опционально — апгрейд одной фразой.`,
    positive_general: `${mirrorHint} Тёплое спасибо, отзеркаль детали из отзыва.`,
  };
  return base[type] || base.positive_general;
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

function variationHint(seed) {
  const n = Number(seed) || Date.now();
  const style = VARIATION_STYLES[Math.abs(n) % VARIATION_STYLES.length];
  const angle = ['юмор без сарказма', 'конкретика из отзыва', 'образ из быта', 'короткий комплимент товару'][
    Math.abs(n >> 2) % 4
  ];
  return `Вариант #${Math.abs(n) % 1000}: ${style} Угол подачи: ${angle}. Не повторяй формулировки из прошлых ответов — каждый раз новая фразировка.`;
}

function formatAltBlock({ rating, upsellTarget, alternative, premiumUpsell, candidates }) {
  if (upsellTarget) {
    return `SKU для упоминания: артикул ${upsellTarget.article}, «${upsellTarget.title}»${
      upsellTarget.priceLabel ? `, цена ~${upsellTarget.priceLabel}` : ''
    }. Тип: ${upsellTarget.analogyType}. Причина: ${upsellTarget.reason}. ${
      rating >= 4
        ? 'Упомяни мягко, одной фразой, без навязывания.'
        : 'Предложи как более подходящий/продвинутый вариант в линейке.'
    }`;
  }
  if (candidates.length) {
    return `Кандидаты (от дорогих к дешёвым):\n${candidates
      .map((c) => `- арт. ${c.article}: ${c.title}${c.priceLabel ? ` (~${c.priceLabel})` : ''}`)
      .join('\n')}`;
  }
  return 'Подходящего аналога в каталоге нет — не выдумывай артикул.';
}

const FEW_SHOT_EXAMPLES = `ПРИМЕРЫ (стиль, не копируй дословно):

[Сценарий: материал — грабли]
Отзыв: 2★ «Думал металл, а пришёл пластик, для огорода слабовато»
Ответ: Понимаю — когда ждёшь металл, пластик кажется лёгким. У этой модели корпус из пластика — так и указано в характеристиках, она для лёгких работ. Если нужна прочность — глянь арт. MG-STEEL («Грабли стальные усиленные», ~2 490 ₽), там стальная рама. Напиши в чат заказа, подскажем точнее.

[Сценарий: положительный]
Отзыв: 5★ «Качество огонь, пришло быстро, буду брать ещё»
Ответ: Круто, что качество зашло и доставка не подвела! Рад, что вернёшься — если захочешь апгрейд, есть старшая модель в линейке (арт. XXX). Хороших покупок!

[Сценарий: смешанный]
Отзыв: 3★ «+ удобно держать − маловат для моих задач»
Ответ: Спасибо за честность — «удобно держать» приятно слышать. По размеру эта модель компактная, в карточке так и заявлено. Если нужен запас по габаритам — есть арт. YYY, там побольше. Напиши в чат, поможем подобрать.`;

export function buildFeedbackSystemPrompt({
  scenario,
  variationSeed = null,
  regenerate = false,
} = {}) {
  const regenNote = regenerate
    ? 'ПЕРЕГЕНЕРАЦИЯ: другие обороты, другая структура, те же правила и стратегия.'
    : '';
  const keywordsLine =
    scenario?.keywords?.length > 0
      ? `Ключевые слова из отзыва: ${scenario.keywords.join(', ')}.`
      : '';

  return `Ты — живой менеджер магазина на Wildberries. Пишешь ответы на отзывы на «ты».

СЦЕНАРИЙ ПОКУПАТЕЛЯ: ${scenario?.label || 'Общий'} (${scenario?.type || 'general'}, тон: ${scenario?.tone || 'neutral'})
СТРАТЕГИЯ: ${scenario?.strategy || 'Отзеркаль слова покупателя и ответь по существу.'}
${keywordsLine}

${variationHint(variationSeed)}
${regenNote}

ЖЁСТКИЕ ПРАВИЛА:
- Обращайся на «ты». Тепло, с характером, уважительно.
- НЕ признавай вину продавца («наша ошибка», «виноваты», «извините за брак»).
- Отзеркаль 1–2 конкретные фразы покупателя (их слова, в кавычках или перефраз).
- Ссылайся на характеристики товара из контекста пользователя.
- Без телефонов, ссылок, скидок, промокодов. Без CAPS LOCK.
- 3–6 предложений, 2–1000 символов. Только готовый текст ответа, без пояснений.

${FEW_SHOT_EXAMPLES}`;
}

export function buildFeedbackUserMessage({
  feedback,
  product,
  alternative,
  premiumUpsell = null,
  candidates = [],
  scenario = null,
}) {
  const rating = Number(feedback?.rating) || 0;
  const parsed = scenario?.parsed || parseFeedbackContent(feedback);
  const productChars = formatCharacteristics(product?.characteristics);
  const upsell = rating >= 4 ? premiumUpsell : alternative;
  const upsellTarget = upsell || alternative;
  const altBlock = formatAltBlock({ rating, upsellTarget, alternative, premiumUpsell, candidates });

  const bablesLine = parsed.bables.length ? `Теги WB (bables): ${parsed.bables.join(', ')}` : '';
  const sizeLine = parsed.matchingSize ? `Соответствие размеру (WB): ${parsed.matchingSize}` : '';

  return `Напиши ответ на этот отзыв по сценарию «${scenario?.label || 'Общий'}».

ОТЗЫВ:
- productValuation (рейтинг): ${parsed.productValuation}/5
- Текст: ${parsed.text || '—'}
- Плюсы: ${parsed.pros || '—'}
- Минусы: ${parsed.cons || '—'}
${bablesLine ? `- ${bablesLine}\n` : ''}${sizeLine ? `- ${sizeLine}\n` : ''}- Фразы для отражения: ${parsed.mirrorPhrases.length ? parsed.mirrorPhrases.map((p) => `«${p}»`).join('; ') : '—'}

ТОВАР:
- Название: ${product?.title || feedback?.productName || '—'}
- Артикул: ${product?.article || feedback?.article || '—'}
- Цена: ${product?.priceLabel || '—'}
- Бренд: ${product?.brand || feedback?.brandName || '—'}
- Категория: ${product?.subjectName || '—'}
- Описание: ${product?.description || '—'}
- Характеристики: ${productChars || '—'}
- Габариты: ${product?.dimensions || '—'}

${altBlock}`;
}

export function buildFeedbackPrompt({
  feedback,
  product,
  alternative,
  premiumUpsell = null,
  candidates = [],
  variationSeed = null,
  regenerate = false,
  scenario = null,
}) {
  const detected = scenario || detectBuyerScenario(feedback);
  return buildFeedbackUserMessage({
    feedback,
    product,
    alternative,
    premiumUpsell,
    candidates,
    scenario: detected,
  });
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
