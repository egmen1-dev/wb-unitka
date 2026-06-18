const TEAM_KEY = 'wb-unit-calc:team';

/** Облако хранится на API магазина (там Postgres). */
const STORAGE_API_BASE = import.meta.env.VITE_STORAGE_API_BASE || '';

function apiUrl(path) {
  return `${STORAGE_API_BASE}${path}`;
}

export function getTeamFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('team')?.trim().toUpperCase() || '';
}

export function isTeamInUrl(teamCode) {
  const normalized = String(teamCode || '').trim().toUpperCase();
  if (!normalized) return false;
  return getTeamFromUrl() === normalized;
}

/** Добавляет ?team= в адресную строку, если код есть в сессии, но пропал из URL. */
export function ensureTeamInUrl(teamCode) {
  const normalized = String(teamCode || '').trim().toUpperCase();
  if (!normalized || isTeamInUrl(normalized)) return false;
  const url = new URL(window.location.href);
  url.searchParams.set('team', normalized);
  window.history.replaceState({}, '', url);
  return true;
}

export function removeTeamFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('team')) return false;
  url.searchParams.delete('team');
  window.history.replaceState({}, '', url);
  return true;
}

export function loadStoredTeam() {
  return localStorage.getItem(TEAM_KEY) || '';
}

export function saveStoredTeam(teamCode) {
  if (teamCode) localStorage.setItem(TEAM_KEY, teamCode);
  else localStorage.removeItem(TEAM_KEY);
}

export function buildShareUrl(teamCode) {
  const url = new URL(window.location.href);
  url.searchParams.set('team', teamCode);
  return url.toString();
}

function wrapFetchError(err, fallback) {
  if (err?.name === 'AbortError') return err;
  const msg = String(err?.message || '');
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return new Error('Нет связи с облаком — данные сохранены на устройстве');
  }
  return new Error(fallback || msg || 'Не удалось связаться с облаком');
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, ' ').slice(0, 120);
    if (response.status === 413) {
      throw new Error('Слишком большой объём данных для облака');
    }
    if (response.status >= 500) {
      throw new Error('Облако временно недоступно. Данные сохранены локально.');
    }
    throw new Error(preview || `Ошибка ${response.status}`);
  }
}

const WORKSPACE_FETCH_MS = 30000;

export async function fetchWorkspace(team) {
  const code = String(team || '').trim();
  if (!code) {
    const error = new Error('Укажите код команды');
    error.needsTeam = true;
    throw error;
  }

  const url = new URL(apiUrl('/api/unit-calc/workspace'), STORAGE_API_BASE || window.location.origin);
  url.searchParams.set('team', code);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKSPACE_FETCH_MS);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Облако не ответило за 30 с — показаны локальные данные');
    }
    throw wrapFetchError(err, 'Не удалось загрузить облако');
  } finally {
    clearTimeout(timeout);
  }
  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(data.error || `Ошибка ${response.status}`);
    error.needsTeam = data.needsTeam;
    if (response.status === 404) error.needsTeam = true;
    throw error;
  }
  return data;
}

export async function createWorkspace({ name, payload }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKSPACE_FETCH_MS);
  let response;
  try {
    response = await fetch(apiUrl('/api/unit-calc/workspace'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', name, payload }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Облако не ответило за 30 с — попробуйте ещё раз');
    }
    throw wrapFetchError(err, 'Не удалось создать команду');
  } finally {
    clearTimeout(timeout);
  }

  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(data.error || `Ошибка ${response.status}`);
  }
  if (!data.teamCode) {
    throw new Error('Код команды не получен — попробуйте ещё раз');
  }
  return data;
}

export async function saveWorkspaceRemote(team, payload) {
  const code = String(team || '').trim();
  if (!code) {
    const error = new Error('Нет кода команды — войдите в команду или создайте новую');
    error.needsTeam = true;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKSPACE_FETCH_MS);
  try {
    const response = await fetch(apiUrl('/api/unit-calc/workspace'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: code, payload }),
      signal: controller.signal,
    });
    const data = await readJson(response);
    if (!response.ok) {
      const error = new Error(data.error || `Ошибка ${response.status}`);
      if (response.status === 404) error.needsTeam = true;
      throw error;
    }
    return data;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Облако не ответило за 30 с — данные сохранены локально');
    }
    if (err?.needsTeam) throw err;
    throw wrapFetchError(err, 'Не удалось сохранить в облако');
  } finally {
    clearTimeout(timeout);
  }
}

import { slimRowsForCache } from '@lib/unit-economics/row-cache.js';
import { normalizeTeamAccess } from '@lib/team-permissions.js';

export function buildWorkspacePayload({
  profiles,
  activeProfileId,
  purchases,
  settings,
  settingsUpdatedAt,
  supplierCatalogs,
  productOverrides,
  baseRows,
  meta,
  syncedAt,
  wbProductCache,
  ownerClientId,
  teamAccess,
}) {
  return {
    ownerClientId: ownerClientId || null,
    teamAccess: normalizeTeamAccess(teamAccess),
    profiles,
    activeProfileId,
    purchases,
    settings,
    settingsUpdatedAt: settingsUpdatedAt || null,
    supplierCatalogs,
    productOverrides: productOverrides || {},
    cache:
      baseRows?.length > 0
        ? {
            rows: slimRowsForCache(baseRows),
            meta: meta || {},
            syncedAt: syncedAt || '',
            wbProductCache: wbProductCache || null,
          }
        : null,
  };
}
