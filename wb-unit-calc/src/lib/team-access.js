const CLIENT_ID_KEY = 'wb-unit-calc:client-id';

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function ownerMarkerKey(teamCode) {
  return `wb-unit-calc:owner-of:${String(teamCode || '').trim().toUpperCase()}`;
}

/** Стабильный идентификатор браузера (для роли создателя команды). */
export function getClientId() {
  if (typeof localStorage === 'undefined') return randomId();
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

/** Запоминает создателя команды в этом браузере. */
export function markTeamOwner(teamCode, ownerId = getClientId()) {
  if (typeof localStorage === 'undefined' || !teamCode || !ownerId) return;
  try {
    localStorage.setItem(ownerMarkerKey(teamCode), ownerId);
  } catch {
    // private mode
  }
}

function isClaimedTeamOwner(teamCode, ownerClientId) {
  if (!teamCode || !ownerClientId || typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(ownerMarkerKey(teamCode)) === ownerClientId;
  } catch {
    return false;
  }
}

/** Создатель команды (для будущих прав админа). */
export function isTeamCreator({ team, ownerClientId }) {
  if (!team || !ownerClientId) return false;
  if (ownerClientId === getClientId()) return true;
  return isClaimedTeamOwner(team, ownerClientId);
}

/** Доступ к «Факт P&L» — у всех участников команды и без команды. */
export function canAccessOwnerSections() {
  return true;
}

export function ownerClientIdForPayload(existingOwnerId) {
  return existingOwnerId || getClientId();
}
