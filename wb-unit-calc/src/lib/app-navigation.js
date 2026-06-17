export const APP_SECTIONS = [
  'calc',
  'fbs',
  'feedbacks',
  'regions',
  'returns',
  'logistics',
  'pnl',
  'data',
  'team',
  'admin',
  'settings',
];

const TAB_ALIASES = { reviews: 'feedbacks' };

const SECTION_KEY = 'wb-unit-calc:section';

function isValidSection(id) {
  return APP_SECTIONS.includes(id);
}

function resolveTabId(tab) {
  const normalized = tab?.trim().toLowerCase();
  if (!normalized) return null;
  const resolved = TAB_ALIASES[normalized] || normalized;
  return isValidSection(resolved) ? resolved : null;
}

/** Активный раздел из ?tab= в URL. */
export function readSectionFromUrl() {
  const tab = new URLSearchParams(window.location.search).get('tab');
  return resolveTabId(tab);
}

export function loadStoredSection() {
  try {
    const stored = localStorage.getItem(SECTION_KEY)?.trim().toLowerCase();
    return isValidSection(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function saveStoredSection(section) {
  try {
    if (isValidSection(section)) localStorage.setItem(SECTION_KEY, section);
  } catch {
    // private mode
  }
}

/** Синхронизирует ?tab= с текущим разделом (calc — без параметра). */
export function writeSectionToUrl(section, { replace = true } = {}) {
  const url = new URL(window.location.href);
  if (section && section !== 'calc') url.searchParams.set('tab', section);
  else url.searchParams.delete('tab');
  const fn = replace ? 'replaceState' : 'pushState';
  window.history[fn]({}, '', url);
}

export function resolveInitialSection() {
  return readSectionFromUrl() || loadStoredSection() || 'calc';
}
