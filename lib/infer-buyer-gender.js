/** @typedef {'female'|'male'|'unknown'} BuyerGender */
/** @typedef {'api'|'name'|'unknown'} BuyerGenderSource */

export const GENDER = {
  FEMALE: 'female',
  MALE: 'male',
  UNKNOWN: 'unknown',
};

const AMBIGUOUS_NAMES = new Set(['саша', 'женя', 'валя']);

const MALE_A_ENDING = new Set([
  'никита',
  'илья',
  'кузьма',
  'фома',
  'савва',
  'лука',
  'платон',
  'данила',
]);

const FEMALE_NAMES = new Set([
  'ирина',
  'мария',
  'анна',
  'елена',
  'ольга',
  'наталья',
  'наталия',
  'татьяна',
  'светлана',
  'екатерина',
  'катерина',
  'юлия',
  'алина',
  'дарья',
  'дария',
  'виктория',
  'полина',
  'ксения',
  'оксана',
  'людмила',
  'любовь',
  'валентина',
  'галина',
  'надежда',
  'вероника',
  'марина',
  'анастасия',
  'настя',
  'софия',
  'софья',
  'александра',
  'евгения',
  'кристина',
  'диана',
  'валерия',
  'лариса',
  'инна',
  'жанна',
  'зоя',
  'раиса',
  'майя',
  'нина',
  'лидия',
  'тамара',
  'вера',
  'алла',
  'зинаида',
  'клавдия',
  'антонина',
  'маргарита',
  'регина',
  'ульяна',
  'яна',
  'алёна',
  'алена',
  'василиса',
  'милана',
  'арина',
  'карина',
  'елизавета',
  'лилия',
  'нелли',
  'роза',
  'снежана',
  'стелла',
  'эмилия',
]);

const MALE_NAMES = new Set([
  'александр',
  'дмитрий',
  'сергей',
  'андрей',
  'алексей',
  'михаил',
  'иван',
  'николай',
  'максим',
  'евгений',
  'владимир',
  'павел',
  'роман',
  'игорь',
  'константин',
  'артем',
  'артём',
  'данил',
  'даниил',
  'кирилл',
  'олег',
  'виктор',
  'юрий',
  'антон',
  'денис',
  'станислав',
  'борис',
  'григорий',
  'федор',
  'фёдор',
  'леонид',
  'василий',
  'петр',
  'пётр',
  'владислав',
  'георгий',
  'тимофей',
  'матвей',
  'ярослав',
  'никита',
  'илья',
  'рустам',
  'арсен',
  'артур',
  'валерий',
  'виталий',
  'вячеслав',
  'глеб',
  'данила',
  'егор',
  'захар',
  'ильдар',
  'марк',
  'назар',
  'прохор',
  'родион',
  'руслан',
  'семен',
  'семён',
  'степан',
  'тимур',
  'филипп',
  'эдуард',
  'яков',
]);

/** @param {string|null|undefined} userName */
export function extractFirstName(userName) {
  const raw = String(userName || '').trim();
  if (!raw) return '';
  return raw.split(/\s+/)[0];
}

function normalizeNameToken(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

/** @param {unknown} raw */
export function normalizeApiGender(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    if (raw === 0 || raw === 2) return GENDER.MALE;
    if (raw === 1) return GENDER.FEMALE;
    return null;
  }
  const s = String(raw).toLowerCase().trim();
  if (['f', 'female', 'woman', 'w', 'женский', 'ж', 'жен', '1'].includes(s)) return GENDER.FEMALE;
  if (['m', 'male', 'man', 'мужской', 'м', 'муж', '0', '2'].includes(s)) return GENDER.MALE;
  return null;
}

/** @param {string} firstName */
export function inferGenderFromRussianName(firstName) {
  const name = normalizeNameToken(firstName);
  if (!name || name.length < 2) return GENDER.UNKNOWN;

  if (FEMALE_NAMES.has(name)) return GENDER.FEMALE;
  if (MALE_NAMES.has(name)) return GENDER.MALE;
  if (AMBIGUOUS_NAMES.has(name)) return GENDER.UNKNOWN;

  if (/(овна|евна|ична|инична)$/.test(name)) return GENDER.FEMALE;
  if (/(ович|евич|ич)$/.test(name)) return GENDER.MALE;

  if (MALE_A_ENDING.has(name)) return GENDER.MALE;

  if (name.endsWith('а') || name.endsWith('я')) {
    return GENDER.FEMALE;
  }

  if (/[бвгджзклмнпрстфхцчшщйь]$/.test(name)) {
    return GENDER.MALE;
  }

  return GENDER.UNKNOWN;
}

/** @param {BuyerGender} gender */
export function genderLabelRu(gender) {
  if (gender === GENDER.FEMALE) return 'женский';
  if (gender === GENDER.MALE) return 'мужской';
  return 'неизвестен';
}

/** @param {BuyerGender} gender */
export function genderBadgeLabel(gender) {
  if (gender === GENDER.FEMALE) return 'ж';
  if (gender === GENDER.MALE) return 'м';
  return null;
}

/** @param {BuyerGender} gender */
export function formatGenderPromptLine(gender) {
  if (gender === GENDER.FEMALE) {
    return 'Пол покупателя: женский — согласуй прилагательные и глаголы от лица менеджера (рада, поняла, уверена, обратила внимание). Обращение к покупателю остаётся на «ты».';
  }
  if (gender === GENDER.MALE) {
    return 'Пол покупателя: мужской — согласуй прилагательные и глаголы от лица менеджера (рад, понял, уверен, обратил внимание). Обращение к покупателю остаётся на «ты».';
  }
  return 'Пол покупателя: неизвестен — избегай форм «рад/рада», «понял/поняла» от лица менеджера; пиши нейтрально или без родовых окончаний.';
}

/**
 * @param {{ userName?: string|null, sex?: unknown, gender?: unknown, buyerSex?: unknown, buyerGender?: unknown }} input
 * @returns {{ gender: BuyerGender, source: BuyerGenderSource, label: string }}
 */
export function resolveBuyerGender(input = {}) {
  const apiGender = normalizeApiGender(
    input.sex ?? input.gender ?? input.buyerSex ?? input.buyerGender
  );
  if (apiGender) {
    return { gender: apiGender, source: 'api', label: genderLabelRu(apiGender) };
  }

  const firstName = extractFirstName(input.userName);
  const inferred = inferGenderFromRussianName(firstName);
  if (inferred !== GENDER.UNKNOWN) {
    return { gender: inferred, source: 'name', label: genderLabelRu(inferred) };
  }

  return { gender: GENDER.UNKNOWN, source: 'unknown', label: genderLabelRu(GENDER.UNKNOWN) };
}
