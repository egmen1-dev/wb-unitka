const MATERIAL_TERMS = [
  { key: 'metal', words: ['металл', 'металлич', 'сталь', 'желез'], label: 'металл' },
  { key: 'plastic', words: ['пластик', 'пластмасс', 'полипропилен', 'abs'], label: 'пластик' },
  { key: 'wood', words: ['дерев', 'деревян'], label: 'дерево' },
  { key: 'aluminum', words: ['алюмин', 'алюминий'], label: 'алюминий' },
  { key: 'fabric', words: ['ткан', 'текстил', 'хлопок', 'полиэстер'], label: 'ткань' },
];

const SIZE_TERMS = ['размер', 'маломер', 'большемер', 'велик', 'мал', 'длин', 'коротк', 'ширин', 'узк'];

function normalizeText(...parts) {
  return parts
    .flat()
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
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

export function catalogRowToProductContext(row, extra = {}) {
  if (!row) return null;
  return {
    nmId: row.nmId,
    article: String(row.vendorCode || row.article || '').trim(),
    title: row.title || '',
    brand: row.brand || '',
    subjectId: row.subjectId,
    subjectName: row.subjectName || '',
    description: extra.description || row.description || row.title || '',
    characteristics: extra.characteristics || row.characteristics || [],
    dimensions:
      row.lengthCm || row.widthCm || row.heightCm
        ? `${row.lengthCm || '?'}×${row.widthCm || '?'}×${row.heightCm || '?'} см, ${row.weightKg || '?'} кг`
        : '',
  };
}

/**
 * Подбор альтернативного SKU из каталога продавца.
 * @returns {{ article: string, title: string, nmId: number, reason: string } | null}
 */
export function pickAlternativeProduct(rows = [], feedback = {}, currentNmId = null) {
  const nmId = Number(currentNmId || feedback.nmId) || 0;
  const complaint = normalizeText(feedback.text, feedback.cons, feedback.pros);
  const current = rows.find((r) => Number(r.nmId) === nmId) || null;

  const samePool = rows.filter((row) => {
    const rowNm = Number(row.nmId);
    if (!rowNm || rowNm === nmId) return false;
    if (current?.brand && row.brand && row.brand === current.brand) return true;
    if (current?.subjectId && row.subjectId && row.subjectId === current.subjectId) return true;
    return false;
  });

  if (!samePool.length) return null;

  const materialComplaint = detectMaterialKey(complaint);
  const sizeComplaint = SIZE_TERMS.some((w) => complaint.includes(w));

  if (materialComplaint) {
    const currentMaterial = detectMaterialKey(rowHaystack(current));
    const candidates = samePool
      .map((row) => {
        const rowMaterial = detectMaterialKey(rowHaystack(row));
        let score = 0;
        if (rowMaterial && rowMaterial !== currentMaterial) score += 5;
        if (current?.brand && row.brand === current.brand) score += 2;
        if (current?.subjectId && row.subjectId === current.subjectId) score += 2;
        if (!rowHaystack(row).includes(materialLabel(materialComplaint))) score += 1;
        return { row, score, rowMaterial };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = candidates[0]?.row;
    if (best) {
      return {
        nmId: best.nmId,
        article: String(best.vendorCode || '').trim(),
        title: best.title || '',
        reason: `в отзыве упомянут материал — предложен другой SKU (${materialLabel(candidates[0].rowMaterial) || 'другие характеристики'})`,
      };
    }
  }

  if (sizeComplaint) {
    const best = samePool.find((row) => row.title && row.title !== current?.title) || samePool[0];
    if (best) {
      return {
        nmId: best.nmId,
        article: String(best.vendorCode || '').trim(),
        title: best.title || '',
        reason: 'по размеру/посадке — другая модель из той же линейки',
      };
    }
  }

  const fallback = samePool[0];
  return {
    nmId: fallback.nmId,
    article: String(fallback.vendorCode || '').trim(),
    title: fallback.title || '',
    reason: current?.subjectName
      ? `другой товар из категории «${current.subjectName}»`
      : 'другой товар из вашего каталога',
  };
}

export function listAlternativeCandidates(rows = [], feedback = {}, currentNmId = null, limit = 5) {
  const nmId = Number(currentNmId || feedback.nmId) || 0;
  const current = rows.find((r) => Number(r.nmId) === nmId) || null;
  const complaint = normalizeText(feedback.text, feedback.cons, feedback.pros);
  const materialComplaint = detectMaterialKey(complaint);

  const pool = rows
    .filter((row) => Number(row.nmId) && Number(row.nmId) !== nmId)
    .map((row) => {
      let score = 0;
      if (current?.brand && row.brand === current.brand) score += 3;
      if (current?.subjectId && row.subjectId === current.subjectId) score += 3;
      if (materialComplaint) {
        const rowMaterial = detectMaterialKey(rowHaystack(row));
        const currentMaterial = detectMaterialKey(rowHaystack(current));
        if (rowMaterial && rowMaterial !== currentMaterial) score += 4;
      }
      return { row, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return pool.map(({ row, score }) => ({
    nmId: row.nmId,
    article: String(row.vendorCode || '').trim(),
    title: row.title || '',
    brand: row.brand || '',
    subjectName: row.subjectName || '',
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

function ratingStrategy(rating) {
  if (rating >= 5) {
    return 'Поблагодари тепло и кратко. Можно упомянуть, что рады, что товар подошёл.';
  }
  if (rating >= 3) {
    return 'Нейтрально-позитивный тон: поблагодари за честность, мягко поясни характеристики товара без оправданий.';
  }
  return 'Эмпатия без признания вины продавца. Согласись, что товар мог не подойти под задачу покупателя. Сошлись на характеристики из описания. Предложи альтернативный артикул из каталога, если он есть.';
}

export function buildFeedbackPrompt({ feedback, product, alternative, candidates = [] }) {
  const rating = Number(feedback?.rating) || 0;
  const productChars = formatCharacteristics(product?.characteristics);
  const altBlock = alternative
    ? `Альтернатива для рекомендации: артикул ${alternative.article}, «${alternative.title}». Причина: ${alternative.reason}.`
    : candidates.length
      ? `Кандидаты на альтернативу:\n${candidates
          .map((c) => `- арт. ${c.article}: ${c.title}`)
          .join('\n')}`
      : 'Подходящей альтернативы в каталоге нет — не выдумывай артикул.';

  return `Ты — менеджер магазина на Wildberries. Напиши ответ на отзыв покупателя на русском.

СТРАТЕГИЯ (рейтинг ${rating}/5): ${ratingStrategy(rating)}

ЖЁСТКИЕ ПРАВИЛА:
- Обращайся на «ты», тепло и по-человечески. Никогда не груби.
- НЕ признавай вину продавца («наша ошибка», «виноваты», «извините за брак»). Вместо этого: товар мог не подойти под задачу/ожидания.
- Ссылайся на характеристики товара из контекста (материал, назначение, размер).
- Для негативных отзывов (1–2★) предложи альтернативный артикул из каталога, если указан.
- Без телефонов, ссылок, скидок, промокодов. Без CAPS LOCK.
- Длина ответа: 2–1000 символов. Только текст ответа, без кавычек и пояснений.

ОТЗЫВ:
Рейтинг: ${rating}/5
Текст: ${feedback?.text || '—'}
Плюсы: ${feedback?.pros || '—'}
Минусы: ${feedback?.cons || '—'}

ТОВАР:
Название: ${product?.title || feedback?.productName || '—'}
Артикул: ${product?.article || feedback?.article || '—'}
Бренд: ${product?.brand || feedback?.brandName || '—'}
Категория: ${product?.subjectName || '—'}
Описание: ${product?.description || '—'}
Характеристики: ${productChars || '—'}
Габариты: ${product?.dimensions || '—'}

${altBlock}`;
}

/** Шаблон без OpenAI — fallback и демо. */
export function buildTemplateDraft({ feedback, product, alternative }) {
  const rating = Number(feedback?.rating) || 0;
  const name = feedback?.userName ? `, ${feedback.userName}` : '';

  if (rating >= 5) {
    return `Спасибо за отзыв${name}! Рады, что товар тебе подошёл — приятных покупок!`;
  }

  if (rating >= 3) {
    const hint = product?.subjectName ? ` Это ${product.subjectName.toLowerCase()}` : '';
    const chars = formatCharacteristics(product?.characteristics);
    const charHint = chars ? ` (${chars.split(';').slice(0, 2).join('; ')})` : '';
    return `Спасибо, что поделился мнением${name}!${hint}${charHint} — важно понимать ожидания. Если что-то не устроило, напиши в чат заказа — подскажем по характеристикам.`;
  }

  const chars = formatCharacteristics(product?.characteristics);
  const fitHint = chars
    ? ` По описанию: ${chars.split(';').slice(0, 2).join('; ')} — возможно, под твою задачу лучше другой вариант.`
    : product?.title
      ? ` «${product.title}» рассчитан на конкретные задачи — возможно, тебе нужен другой формат.`
      : '';

  const altHint = alternative?.article
    ? ` Можешь посмотреть артикул ${alternative.article} — «${alternative.title}».`
    : '';

  return `Жаль, что покупка не оправдала ожиданий${name}.${fitHint}${altHint} Напиши в чат заказа, если нужна подсказка по выбору.`;
}
