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
  negative_expectation: 'Расхождение с ожиданиями',
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
  'Начни с конкретики из отзыва — не с «Спасибо за отзыв».',
  'Вплети слово покупателя в первое предложение.',
  'Заверши живой фразой про товар или линейку — без пустых призывов.',
  'Разговорный тон — как другу в мессенджере, на «ты».',
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

export function formatCharacteristics(characteristics) {
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
    negative_material: `Товар мог не подойти по материалу. ${mirrorHint} Поясни материал из характеристик карточки — без извинений за «ошибку». Обязательно предложи премиум-артикул с другим материалом (артикул из контекста).`,
    negative_size: `${mirrorHint} Ссылайся на размерную сетку/габариты из карточки. Товар мог не подойти по посадке — предложи другую модель в линейке с артикулом.`,
    negative_quality: `${mirrorHint} Без признания вины. Уточни, что это базовая модель; предложи более дорогой вариант с артикулом и лучшими характеристиками.`,
    negative_defect: `${mirrorHint} Эмпатия, но не «наша вина/брак». Предложи альтернативу из линейки с артикулом. Чат заказа — только если покупатель сам спрашивает, как связаться.`,
    negative_expectation: `${mirrorHint} Товар мог не подойти под задачу — опирайся на описание и характеристики. Предложи модель из линейки с артикулом.`,
    negative_delivery: `${mirrorHint} Сочувствие по доставке/упаковке, без обещаний компенсации. Верни разговор к товару и его характеристикам.`,
    negative_wrong_item: `${mirrorHint} Предложи уточнить детали — без признания ошибки склада. Чат — только если покупатель спрашивает контакт.`,
    negative_price: `${mirrorHint} Объясни ценность базовой модели через характеристики; предложи апгрейд с артикулом.`,
    negative_color: `${mirrorHint} Цвет на экране может отличаться — ссылайся на характеристики. При необходимости — другой артикул.`,
    negative_weight: `${mirrorHint} Вес/прочность заложены в спецификацию — предложи другой вариант по массе/усилению с артикулом.`,
    negative_general: `${mirrorHint} Товар мог не подойти под задачу. Характеристики + премиум-альтернатива с артикулом.`,
    neutral_mixed: `${mirrorHint} Отметь плюсы словами покупателя и мягко поясни минусы через характеристики. Опционально — апгрейд с артикулом.`,
    neutral_middle: `${mirrorHint} Нейтрально-дружелюбно: поясни назначение товара из карточки, предложи апгрейд при необходимости.`,
    positive_praise: `${mirrorHint} Тёплое спасибо — процитируй, что именно понравилось. Мягко упомяни старшую модель с артикулом.`,
    positive_repeat: `${mirrorHint} Поблагодари за лояльность и повторный заказ — тепло, без шаблонов.`,
    positive_photo: `${mirrorHint} Отметь, что рад, что товар выглядит как надо. Мягкий апселл с артикулом.`,
    positive_wow: `${mirrorHint} Живая благодарность на «ты» — энергично, но искренне. Опционально — апгрейд одной фразой с артикулом.`,
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

/** Шаблонные фразы — автоматически отклоняются validateDraftQuality. */
export const BANNED_PHRASES = [
  'спасибо, что написал честно',
  'спасибо что написал честно',
  'ожидания не совпали',
  'жаль, что ожидания',
  'жаль что ожидания',
  'жаль, что не совпали',
  'жаль что не совпали',
  'напиши в чат заказа',
  'напиши в чат',
  'поможем с выбором',
  'подберём точнее',
  'подберем точнее',
  'благодарим за обратную связь',
  'благодарим за отзыв',
  'спасибо за отзыв',
  'спасибо за обратную связь',
  'наша ошибка',
  'наша вина',
  'признаём ошибку',
  'признаем ошибку',
  'благодарим вас',
  'уважаемый покупатель',
  'дорогой покупатель',
];

const CONTACT_REQUEST_WORDS = [
  'как связаться',
  'куда написать',
  'контакт',
  'написать продавц',
  'связаться с продав',
  'как написать',
];

/** Покупатель сам спрашивает, как связаться — тогда «чат» допустим. */
export function reviewAsksContact(feedback = {}) {
  const hay = normalizeText(feedback.text, feedback.cons, feedback.pros);
  return CONTACT_REQUEST_WORDS.some((w) => hay.includes(w));
}

function extractMirrorTokens(scenario, feedback) {
  const tokens = new Set();
  for (const phrase of [...(scenario?.mirrorPhrases || []), ...(scenario?.keywords || [])]) {
    for (const word of String(phrase).toLowerCase().split(/[\s,.:;—–-]+/)) {
      const w = word.replace(/[^а-яёa-z0-9]/gi, '');
      if (w.length >= 4) tokens.add(w);
    }
  }
  const parsed = scenario?.parsed || parseFeedbackContent(feedback);
  for (const part of [parsed.text, parsed.pros, parsed.cons]) {
    for (const word of String(part || '').toLowerCase().split(/[\s,.:;—–-]+/)) {
      const w = word.replace(/[^а-яёa-z0-9]/gi, '');
      if (w.length >= 5) tokens.add(w);
    }
  }
  return [...tokens];
}

function hasMirrorEcho(answerHay, tokens) {
  if (!tokens.length) return true;
  return tokens.some((t) => answerHay.includes(t));
}

function hasArticleMention(answerHay, article) {
  if (!article) return true;
  const art = String(article).trim().toLowerCase();
  if (!art) return true;
  return answerHay.includes(art) || /арт\.?\s*\S+/i.test(answerHay);
}

/**
 * Пост-валидация качества черновика: бан-лист, зеркалирование, артикул на негативе.
 * @returns {{ ok: boolean, score: number, issues: string[], templateLike: boolean }}
 */
export function validateDraftQuality(text, {
  scenario = null,
  feedback = null,
  alternative = null,
  premiumUpsell = null,
  reviewAsksContact: allowChat = false,
  managerStyle = false,
} = {}) {
  const answer = String(text || '').trim();
  const hay = normalizeText(answer);
  const issues = [];
  const rating = Number(feedback?.rating) || 0;
  const upsell = rating >= 4 ? premiumUpsell || alternative : alternative;
  const tone = scenario?.tone || (rating <= 2 ? 'negative' : rating >= 4 ? 'positive' : 'neutral');

  for (const phrase of BANNED_PHRASES) {
    if (!hay.includes(phrase.toLowerCase())) continue;
    const isChatPhrase = /чат|напиши|подбер/i.test(phrase);
    if (isChatPhrase && (allowChat || reviewAsksContact(feedback))) continue;
    issues.push(`Шаблон: «${phrase}»`);
  }

  if (!managerStyle) {
    const mirrorTokens = extractMirrorTokens(scenario, feedback);
    if (mirrorTokens.length && !hasMirrorEcho(hay, mirrorTokens)) {
      issues.push('Нет слов из отзыва — ответ не персональный');
    }
  }

  if (tone === 'negative' && upsell?.article && !hasArticleMention(hay, upsell.article)) {
    issues.push('Негативный отзыв без артикула альтернативы');
  }

  const minLength = managerStyle ? 40 : 80;
  if (answer.length < minLength) issues.push(`Слишком коротко (< ${minLength} символов)`);
  if (answer.length > 950) issues.push('Слишком длинно (> 950 символов)');

  const wbCheck = validateFeedbackAnswer(answer);
  if (!wbCheck.ok) issues.push(...wbCheck.errors);

  const templateLike = issues.some((i) => i.startsWith('Шаблон'));
  const score = Math.max(0, Math.min(100, 100 - issues.length * 18 - (templateLike ? 15 : 0)));

  return { ok: issues.length === 0, score, issues, templateLike, text: answer };
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

const FEW_SHOT_BY_SCENARIO = {
  negative_material: [
    'Отзыв: 2★ «Думал металл, а пришёл пластик, для огорода слабовато»\nОтвет: Понял тебя — когда ждёшь металл, пластик кажется хлипким. У этой модели корпус из пластика, в карточке так и указано: она для лёгких работ на грядках. Если нужна прочность под тяжёлую почву — глянь арт. MG-STEEL («Грабли стальные усиленные»), там стальная рама и зубья потолще.',
    'Отзыв: 1★ «Пластиковые, ожидал алюминий, гнутся»\nОтвет: Да, «гнутся» — потому что эта линейка из полипропилена, не из алюминия. В характеристиках материал прописан: базовый вариант для лёгкого рыхления. Для жёстких задач есть арт. ALU-PRO — алюминиевая рама, держит нагрузку заметно лучше.',
    'Отзыв: 2★ «Металл тонкий, ржавеет»\nОтвет: Слышу про «тонкий металл» — у этой модели сталь 0,8 мм, она рассчитана на умеренные нагрузки. Если нужна антикоррозийная обработка и толще стенка — арт. STEEL-2MM с порошковым покрытием, там другой класс прочности.',
    'Отзыв: 3★ «Деревянная ручка, хотел цельный металл»\nОтвет: Ручка из бука — так задумано: меньше вес в руках, в карточке «материал ручки: дерево». Если нужен монолитный металл от головки до конца — арт. MONO-MET, цельная конструкция без вставок.',
    'Отзыв: 1★ «Не тот материал совсем»\nОтвет: Похоже, формат не попал в задачу — у этой позиции материал [из характеристик], она для [назначение]. Чтобы не промахнуться в следующий раз — арт. [PREMIUM] с [другой материал], ближе к тому, что ты описываешь.',
  ],
  negative_size: [
    'Отзыв: 2★ «Маломерит, на размер больше заказывайте»\nОтвет: Вижу, «маломерит» — у этой модели посадка slim, в таблице размеров это отмечено. Если нужен запас по обхвату — арт. RELAX-L, там линейка на полразмера свободнее.',
    'Отзыв: 3★ «Длинноват рукав, рост 165»\nОтвет: Для роста 165 рукав действительно длинный — эта модель под стандарт 170–175. Есть арт. PETITE-S с укороченным рукавом, как раз под твой рост.',
    'Отзыв: 1★ «Велик, болтается»\nОтвет: «Болтается» — значит, сетка рассчитана на более плотную посадку. Глянь арт. FIT-M, там обхват на 4 см меньше в той же линейке.',
    'Отзыв: 2★ «Узкий в плечах»\nОтвет: Плечевой шов у этой модели узкий — в описании «athletic fit». Если нужен свободный крой — арт. WIDE-XL с расширенной линией плеча.',
    'Отзыв: 2★ «Короткий, хотел длиннее»\nОтвет: Длина 68 см — как в карточке, это укороченный крой. Для полной длины 74 см есть арт. LONG-74 в той же серии.',
  ],
  negative_quality: [
    'Отзыв: 2★ «Качество так себе, швы кривые»\nОтвет: Про «швы кривые» — это базовая линейка, швы машинные стандартные. Если нужна ровная строчка и плотнее ткань — арт. PRO-STITCH, там усиленные швы и контроль ОТК.',
    'Отзыв: 1★ «Дешёвый вид, нитки торчат»\nОтвет: «Дешёвый вид» часто у эконом-сегмента — у этой модели ткань 180 г/м². Для плотнее и аккуратнее отделки — арт. PREM-240, ткань 240 г/м² и оверлок по всем швам.',
    'Отзыв: 3★ «Норм, но хотелось бы получше»\nОтвет: «Норм» — уже неплохо для стартовой модели. Если хочешь апгрейд по фурнитуре и ткани — арт. UPGRADE-01, там YKK-молнии и плотнее материал.',
    'Отзыв: 2★ «Хлипкий, тонкий»\nОтвет: Толщина как в характеристиках — 1,2 мм, для лёгких задач. Если «хлипкий» не устраивает — арт. HEAVY-3 с толщиной 3 мм и усиленным каркасом.',
    'Отзыв: 1★ «Неаккуратно сделано»\nОтвет: Эта позиция — массовый сегмент, допуски шире. Для аккуратной отделки и ручной проверки каждой единицы — арт. CRAFT-ELITE в премиум-линейке.',
  ],
  negative_defect: [
    'Отзыв: 1★ «Пришло сломанное, крышка треснула»\nОтвет: Неприятно, что «крышка треснула» — такое иногда случается в пути. По характеристикам корпус рассчитан на бережную эксплуатацию. Если нужна модель с металлическим корпусом — арт. METAL-BODY, там прочнее конструкция.',
    'Отзыв: 2★ «Не работает с первого дня»\nОтвет: «Не работает с первого дня» — давай разберёмся в деталях. Эта модель требует [из инструкции]. Альтернатива попроще — арт. PLUG-PLAY, включается без настройки.',
    'Отзыв: 1★ «Отвалилась деталь»\nОтвет: Про «отвалилась деталь» — у базовой версии крепления стандартные. Если нужны усиленные фиксаторы — арт. LOCK-PRO с металлическими защёлками.',
    'Отзыв: 2★ «Скол на поверхности»\nОтвет: Скол на покрытии — неприятно видеть при распаковке. У этой линейки покрытие базовое; для более стойкого — арт. POWDER-COAT с порошковой окраской.',
    'Отзыв: 1★ «Брак, пятно на ткани»\nОтвет: Пятно при получении — обидно. Эта модель из светлой ткани, маркость выше. Если хочешь менее маркий вариант — арт. DARK-CHAR в тёмном цвете той же серии.',
  ],
  negative_expectation: [
    'Отзыв: 2★ «На фото выглядело иначе, разочарован»\nОтвет: «На фото выглядело иначе» — понимаю. У этой модели [характеристика из карточки], она для [назначение]. Если нужен другой формат — арт. VISUAL-PRO, там [отличие] и ближе к тому, что ты описываешь.',
    'Отзыв: 1★ «Ожидал больше, не соответствует описанию»\nОтвет: Про «не соответствует» — в карточке заложено [факт из характеристик], это базовый сегмент. Для более насыщенного варианта — арт. PLUS-01 с [улучшение].',
    'Отзыв: 2★ «Не то что думал, слабовато»\nОтвет: «Слабовато» — у этой позиции [материал/мощность из карточки], она рассчитана на лёгкие задачи. Если нужна мощнее — арт. HEAVY-DUTY, там [отличие].',
    'Отзыв: 3★ «Не подошло под мои задачи»\nОтвет: Похоже, формат не попал в задачу — у этой модели [характеристика]. Для более серьёзных нагрузок — арт. PRO-LINE с [отличие].',
    'Отзыв: 1★ «Обман, на деле совсем другое»\nОтвет: «На деле другое» — давай по фактам: в карточке [характеристика], это [назначение]. Если нужен иной уровень — арт. UPGRADE-X в той же линейке.',
  ],
  positive_praise: [
    'Отзыв: 5★ «Качество отличное, удобно в руке»\nОтвет: Круто, что «удобно в руке» и качество зашло! Именно эргономику закладывали в эту модель. Если захочешь ещё плотнее материал — есть старшая арт. GRIP-PRO.',
    'Отзыв: 5★ «Прочный, не гнётся»\nОтвет: «Прочный, не гнётся» — лучший комплимент для этой линейки! Рад, что попали в задачу. Кстати, есть арт. ULTRA-FORT с ещё толще стенкой — на будущее.',
    'Отзыв: 4★ «Стильный, смотрится дорого»\nОтвет: Приятно слышать про «стильный» вид — дизайн как раз обновляли в этом сезоне. Если понравится линейка — глянь арт. DESIGN-MAX, там премиум-отделка.',
    'Отзыв: 5★ «Мягкий, приятный на ощупь»\nОтвет: «Мягкий, приятный на ощупь» — про нашу ткань с двойным плетением. Хороших носок! Есть ещё арт. SILK-TOUCH с добавлением модала, если захочешь ещё мягче.',
    'Отзыв: 5★ «Лёгкий, не устаёшь держать»\nОтвет: «Лёгкий» — фишка этой модели, вес 280 г как в карточке. Рад, что ощущения совпали. На будущее — арт. CARBON-LITE ещё на 40 г легче.',
  ],
  positive_wow: [
    'Отзыв: 5★ «Супер! Лучшая покупка за год!»\nОтвет: Ого, «лучшая покупка за год» — это мощно! Спасибо, что поделился эмоцией. Если захочешь ещё круче — в линейке есть арт. FLAGSHIP-01.',
    'Отзыв: 5★ «Огонь! Всем советую»\nОтвет: «Огонь» и рекомендация друзьям — лучшее, что можно услышать! Кайф, что зашло. Удачи с использованием!',
    'Отзыв: 5★ «Превзошло ожидания, шикарно»\nОтвет: «Превзошло ожидания» — именно за этим и работаем! Рад, что «шикарно» совпало с реальностью.',
    'Отзыв: 5★ «Идеально, 10 из 10»\nОтвет: Десятка из десяти — принято! Спасибо за такой отзыв, приятно читать.',
    'Отзыв: 5★ «Класс, буду заказывать ещё»\nОтвет: «Буду заказывать ещё» — это про лояльность, ценим! Если в следующий раз захочешь апгрейд — арт. PLUS-V2 ждёт.',
  ],
  neutral_mixed: [
    'Отзыв: 3★ «+ удобно держать − маловат для моих задач»\nОтвет: «Удобно держать» — рад слышать! По размеру эта модель компактная, в карточке габариты 30 см. Если нужен запас — арт. SIZE-L, там 42 см рабочей части.',
    'Отзыв: 3★ «+ быстрая доставка − цвет бледнее фото»\nОтвет: Доставка — плюс, согласен. «Бледнее фото» бывает из-за экрана — в характеристиках оттенок «пастельный». Если нужен насыщеннее — арт. COLOR-VIVID.',
    'Отзыв: 3★ «Нормальный товар, но дороговато»\nОтвет: «Дороговато» понимаю — это средний сегмент с [характеристика]. За эти деньги даём [факт из карточки]. Бюджетнее в линейке — арт. ECO-BASE.',
    'Отзыв: 3★ «+ качество ок − тяжеловат»\nОтвет: «Качество ок» — спасибо! «Тяжеловат» — вес 1,2 кг заложен для устойчивости. Легче в серии — арт. LITE-800, 800 г.',
    'Отзыв: 3★ «Пойдёт, но не восторг»\nОтвет: «Пойдёт» — честная оценка. Эта модель базовая, для повседневных задач. Если захочешь вау-эффект — арт. PRO-MAX с расширенным функционалом.',
  ],
};

const FEW_SHOT_DEFAULT = [
  'Отзыв: 2★ «Не подошло под мои задачи»\nОтвет: Похоже, формат не попал в задачу — у этой позиции [характеристика из карточки]. Для более серьёзных нагрузок — арт. [SKU] с [отличие].',
  'Отзыв: 5★ «Всё понравилось»\nОтвет: Рад, что «всё понравилось»! Если в будущем захочешь апгрейд — в линейке есть старшая модель.',
  'Отзыв: 4★ «Хороший товар за свои деньги»\nОтвет: «Хороший за свои деньги» — про эту модель как раз. В карточке [факт]. Удачи с использованием!',
  'Отзыв: 1★ «Разочарован полностью»\nОтвет: «Разочарован» — слышу тебя. Эта модель рассчитана на [назначение из описания]. Ближе к твоей задаче — арт. [SKU].',
  'Отзыв: 5★ «Быстро пришло, упаковка целая»\nОтвет: Целая упаковка и скорость — отлично! Надеюсь, сам товар тоже порадует в деле.',
];

function fewShotForScenario(type) {
  const examples = FEW_SHOT_BY_SCENARIO[type] || FEW_SHOT_DEFAULT;
  return examples
    .slice(0, 5)
    .map((ex, i) => `Пример ${i + 1}:\n${ex}`)
    .join('\n\n');
}

const BANNED_LIST_PROMPT = BANNED_PHRASES.map((p) => `«${p}»`).join(', ');

const COMPOSE_CHECKLIST = `Перед финальным текстом мысленно пройди чеклист (в ответ НЕ пиши чеклист):
1. СЦЕНАРИЙ — какой тип покупателя и тон ответа?
2. ЗЕРКАЛО — какие 1–2 фразы/слова из отзыва встроить?
3. ФАКТ — какая характеристика товара из карточки объясняет ситуацию?
4. АПСЕЛЛ — какой артикул предложить (если есть в контексте)?
5. СБОРКА — 2–8 предложений, 400–900 символов, только готовый ответ.`;

export function buildFeedbackSystemPrompt({
  scenario,
  variationSeed = null,
  regenerate = false,
  buyerName = null,
} = {}) {
  const regenNote = regenerate
    ? 'ПЕРЕГЕНЕРАЦИЯ: полностью другие обороты и структура. Запрещено повторять шаблонные фразы из прошлого варианта.'
    : '';
  const keywordsLine =
    scenario?.keywords?.length > 0
      ? `Ключевые слова из отзыва (встрой в ответ): ${scenario.keywords.join(', ')}.`
      : '';
  const mirrorLine =
    scenario?.mirrorPhrases?.length > 0
      ? `Фразы для отражения: ${scenario.mirrorPhrases.map((p) => `«${p}»`).join(', ')}.`
      : '';
  const nameHint = buyerName
    ? `Имя покупателя: ${buyerName}. Используй ОДИН раз естественно (например «${buyerName}, понял тебя»), не начинай с «Спасибо, что написал честно».`
    : 'Имя покупателя неизвестно — не выдумывай.';

  return `Ты — живой менеджер магазина на Wildberries. Пишешь ответы на отзывы на «ты».

СЦЕНАРИЙ: ${scenario?.label || 'Общий'} (${scenario?.type || 'general'}, тон: ${scenario?.tone || 'neutral'})
СТРАТЕГИЯ: ${scenario?.strategy || 'Отзеркаль слова покупателя и ответь по существу.'}
${keywordsLine}
${mirrorLine}
${nameHint}

${variationHint(variationSeed)}
${regenNote}

${COMPOSE_CHECKLIST}

ЖЁСТКИЕ ПРАВИЛА:
- Обращайся на «ты». Разговорно, по-человечески, с характером.
- НЕ признавай вину продавца, НЕ извиняйся за «брак» или «ошибку».
- ОБЯЗАТЕЛЬНО отзеркаль 1–2 конкретных слова/фразы из отзыва (в кавычках или перефраз).
- Ссылайся на характеристики товара из контекста пользователя.
- На негативных отзывах — если в контексте есть артикул альтернативы, ОБЯЗАТЕЛЬНО упомяни его.
- Без телефонов, ссылок, скидок, промокодов. Без CAPS LOCK.
- 2–8 предложений, ~400–900 символов. Только готовый текст ответа.

ЗАПРЕЩЁННЫЕ ФРАЗЫ (никогда не используй): ${BANNED_LIST_PROMPT}.
«Напиши в чат заказа» — ТОЛЬКО если покупатель сам спрашивает, как связаться.

ПРИМЕРЫ ДЛЯ ЭТОГО СЦЕНАРИЯ (стиль, не копируй дословно):

${fewShotForScenario(scenario?.type)}`;
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
  const buyerName = feedback?.userName ? String(feedback.userName).trim() : null;

  return `Составь ответ на отзыв. Сначала мысленно: сценарий → слова для отражения → факт из карточки → артикул апселла → финальный текст.

СЦЕНАРИЙ: «${scenario?.label || 'Общий'}» (${scenario?.type || 'general'})

ОТЗЫВ:
- Рейтинг: ${parsed.productValuation}/5
- Текст: ${parsed.text || '—'}
- Плюсы: ${parsed.pros || '—'}
- Минусы: ${parsed.cons || '—'}
${buyerName ? `- Имя: ${buyerName}\n` : ''}${bablesLine ? `- ${bablesLine}\n` : ''}${sizeLine ? `- ${sizeLine}\n` : ''}- Фразы для отражения: ${parsed.mirrorPhrases.length ? parsed.mirrorPhrases.map((p) => `«${p}»`).join('; ') : '—'}

ТОВАР:
- Название: ${product?.title || feedback?.productName || '—'}
- Артикул: ${product?.article || feedback?.article || '—'}
- Цена: ${product?.priceLabel || '—'}
- Бренд: ${product?.brand || feedback?.brandName || '—'}
- Категория: ${product?.subjectName || '—'}
- Описание: ${product?.description || '—'}
- Характеристики: ${productChars || '—'}
- Габариты: ${product?.dimensions || '—'}

${altBlock}

Верни ТОЛЬКО готовый текст ответа покупателю (без чеклиста и пояснений).`;
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

function pickFromSeed(arr, seed) {
  const n = Math.abs(Number(seed) || Date.now());
  return arr[n % arr.length];
}

const TEMPLATE_OPENERS_NEGATIVE = [
  (name) => `Понял тебя${name} —`,
  (name) => `Вижу, в чём дело${name} —`,
  (name) => `Слышу тебя${name}:`,
  (name) => `Вижу расхождение${name} —`,
];

function formatAltHint(alternative) {
  if (!alternative?.article) return '';
  const pricePart =
    alternative.priceLabel && alternative.priceDelta
      ? ` (~${alternative.priceLabel}, +${formatPriceRub(alternative.priceDelta)})`
      : alternative.priceLabel
        ? ` (~${alternative.priceLabel})`
        : '';
  const typeHint =
    alternative.analogyType === 'material'
      ? 'другой материал'
      : alternative.analogyType === 'size'
        ? 'другая посадка'
        : 'продвинутее по характеристикам';
  return ` Загляни на арт. ${alternative.article} — «${alternative.title}»${pricePart}, там ${typeHint}.`;
}

function formatCharHint(product, maxParts = 2) {
  const chars = formatCharacteristics(product?.characteristics);
  if (chars) {
    return ` По карточке: ${chars.split(';').slice(0, maxParts).join('; ')}.`;
  }
  if (product?.title) return ` «${product.title}» — базовый вариант в линейке.`;
  return '';
}

function mirrorWords(snippet, maxWords = 5) {
  if (!snippet) return '';
  return ` «${snippet.split(/\s+/).slice(0, maxWords).join(' ')}»`;
}

function buildNegativeTemplate({ scenarioType, firstName, consSnippet, product, alternative, seed }) {
  const opener = pickFromSeed(TEMPLATE_OPENERS_NEGATIVE, seed)(firstName);
  const altHint = formatAltHint(alternative);
  const charHint = formatCharHint(product);
  const mirror = mirrorWords(consSnippet);

  switch (scenarioType) {
    case SCENARIO_TYPES.NEGATIVE_MATERIAL:
      return `${opener} когда ждёшь один материал, а в карточке другой — это сбивает.${mirror ? ` Про${mirror} —` : ''}${charHint}${altHint}`;
    case SCENARIO_TYPES.NEGATIVE_SIZE:
      return `${opener} посадка не попала${mirror ? ` —${mirror}` : ''}.${charHint} Если нужен другой размерный ряд —${altHint || ' глянь соседние артикулы в линейке.'}`;
    case SCENARIO_TYPES.NEGATIVE_QUALITY:
      return `${opener} по качеству отделки${mirror ? `${mirror}` : ''} — это базовая линейка.${charHint}${altHint || ' В премиум-серии плотнее материал и ровнее швы.'}`;
    case SCENARIO_TYPES.NEGATIVE_DEFECT:
      return `${opener} неприятно, что${mirror || ' товар пришёл не в идеале'}.${charHint}${altHint}`;
    case SCENARIO_TYPES.NEGATIVE_EXPECTATION:
      return `${opener} формат не попал в задачу${mirror ? ` —${mirror}` : ''}.${charHint} Для другого уровня —${altHint || ' посмотри старшие модели в линейке.'}`;
    case SCENARIO_TYPES.NEGATIVE_DELIVERY:
      return `${opener} доставка/упаковка подвели${mirror ? ` —${mirror}` : ''}. По самому товару:${charHint}${altHint}`;
    case SCENARIO_TYPES.NEGATIVE_WRONG_ITEM:
      return `${opener} похоже, пришло не то${mirror ? ` —${mirror}` : ''}. Уточни артикул на этикетке — сверим с заказом.${charHint}${altHint}`;
    case SCENARIO_TYPES.NEGATIVE_PRICE:
      return `${opener} по цене/ценности${mirror ? `${mirror}` : ''} — это стартовый сегмент.${charHint}${altHint}`;
    case SCENARIO_TYPES.NEGATIVE_COLOR:
      return `${opener} оттенок на экране может отличаться${mirror ? ` —${mirror}` : ''}.${charHint}${altHint}`;
    case SCENARIO_TYPES.NEGATIVE_WEIGHT:
      return `${opener} по весу/прочности${mirror ? `${mirror}` : ''} — заложено в спецификацию.${charHint}${altHint}`;
    default:
      return `${opener}${mirror ? ` слышу${mirror}.` : ''}${charHint}${altHint}`;
  }
}

/** Шаблон без AI — сценарный, без бан-фраз. Только когда AI не настроен. */
export function buildTemplateDraft({
  feedback,
  product,
  alternative,
  premiumUpsell = null,
  variationSeed = null,
  scenario = null,
}) {
  const rating = Number(feedback?.rating) || 0;
  const seed = variationSeed ?? Date.now();
  const firstName = feedback?.userName ? `, ${String(feedback.userName).split(/\s+/)[0]}` : '';
  const consSnippet = [feedback?.cons, feedback?.text].filter(Boolean).join(' ').slice(0, 55).trim();
  const prosSnippet = [feedback?.pros, feedback?.text].filter(Boolean).join(' ').slice(0, 55).trim();
  const scenarioType = scenario?.type || detectBuyerScenario(feedback).type;

  if (rating >= 4) {
    const opener = pickFromSeed(TEMPLATE_OPENERS_POSITIVE, seed)(firstName);
    const mirror = prosSnippet ? ` Особенно${mirrorWords(prosSnippet, 6)} — приятно слышать.` : '';
    const premium = premiumUpsell?.article
      ? ` Если захочешь апгрейд — глянь арт. ${premiumUpsell.article} («${premiumUpsell.title}»${
          premiumUpsell.priceLabel ? `, ~${premiumUpsell.priceLabel}` : ''
        }), там поинтереснее по характеристикам.`
      : '';
    return `${opener}${mirror}${premium} Удачи с покупками!`;
  }

  if (rating >= 3) {
    const mirror = prosSnippet ? `${mirrorWords(prosSnippet, 4)} отмечу.` : '';
    const charHint = formatCharHint(product, 1);
    const alt = formatAltHint(alternative);
    return `Смешанные впечатления${firstName} —${mirror ? ` ${mirror}` : ''}${charHint} У этой модели своя специализация.${alt}`;
  }

  return buildNegativeTemplate({ scenarioType, firstName, consSnippet, product, alternative, seed });
}

export {
  MANAGER_SYSTEM_PROMPT,
  buildManagerSystemPrompt,
  buildReviewUserMessage,
  mapManagerScenarioLabel,
} from './feedback-manager-prompt.js';
