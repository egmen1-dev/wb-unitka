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

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, ' ').slice(0, 120);
    if (response.status >= 500) {
      throw new Error('Облако временно недоступно. Данные сохранены локально.');
    }
    throw new Error(preview || `Ошибка ${response.status}`);
  }
}

const WORKSPACE_FETCH_MS = 12000;

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
      throw new Error('Облако не ответило за 12 с — показаны локальные данные');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(data.error || `Ошибка ${response.status}`);
    error.needsTeam = data.needsTeam;
    throw error;
  }
  return data;
}

export async function createWorkspace({ name, payload }) {
  const response = await fetch(apiUrl('/api/unit-calc/workspace'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', name, payload }),
  });

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(apiUrl('/api/unit-calc/workspace'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team, payload }),
      signal: controller.signal,
    });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
    return data;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Облако не ответило за 15 с — данные сохранены локально');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

import { slimRowsForCache } from '@lib/unit-economics/row-cache.js';
import { normalizeTeamAccess } from '@lib/team-permissions.js';

export function buildWorkspacePayload({
  profiles,
  activeProfileId,
  wbFeedbacksToken,
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
    wbFeedbacksToken: String(wbFeedbacksToken || '').trim() || null,
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
