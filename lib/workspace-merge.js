function profileTokenTimestamp(profile) {
  const raw = profile?.tokenUpdatedAt || profile?.createdAt || '';
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Более свежий токен побеждает; при равенстве — локальный (existing). */
export function pickProfileToken(prev = {}, incoming = {}) {
  const prevToken = String(prev.token || '').trim();
  const incomingToken = String(incoming.token || '').trim();
  if (!incomingToken) return prevToken;
  if (!prevToken) return incomingToken;

  const prevAt = profileTokenTimestamp(prev);
  const incomingAt = profileTokenTimestamp(incoming);
  if (prevAt > incomingAt) return prevToken;
  if (incomingAt > prevAt) return incomingToken;
  return prevToken;
}

/**
 * При pull из облака: локальный список — источник правды по составу профилей.
 * Удалённые локально id (tombstones) не возвращаются из облака до успешного push.
 * Профили только из облака (коллега добавил ключ) по-прежнему подмешиваются.
 */
export function reconcileProfilesForPull(local = [], remote = [], { deletedIds = new Set(), preferLocalTokens = false } = {}) {
  if (!local?.length) {
    return mergeWorkspaceProfiles([], remote).filter((profile) => !deletedIds.has(profile?.id));
  }

  const remoteById = new Map();
  for (const profile of remote || []) {
    if (profile?.id) remoteById.set(profile.id, profile);
  }

  const localIds = new Set();
  const merged = (local || []).map((localProfile) => {
    if (!localProfile?.id) return localProfile;
    localIds.add(localProfile.id);
    const remoteProfile = remoteById.get(localProfile.id);
    if (!remoteProfile) return localProfile;
    const localToken = String(localProfile.token || '').trim();
    return {
      ...localProfile,
      ...remoteProfile,
      token:
        preferLocalTokens && localToken
          ? localProfile.token
          : pickProfileToken(localProfile, remoteProfile),
      name: remoteProfile.name || localProfile.name,
    };
  });

  for (const remoteProfile of remote || []) {
    if (!remoteProfile?.id || localIds.has(remoteProfile.id) || deletedIds.has(remoteProfile.id)) {
      continue;
    }
    merged.push(remoteProfile);
  }

  return merged;
}

/** Объединяем профили команды: не теряем токен при пустом сохранении. */
export function mergeWorkspaceProfiles(existing = [], incoming = []) {
  const byId = new Map();
  for (const profile of existing || []) {
    if (profile?.id) byId.set(profile.id, profile);
  }
  for (const profile of incoming || []) {
    if (!profile?.id) continue;
    const prev = byId.get(profile.id);
    if (!prev) {
      byId.set(profile.id, profile);
      continue;
    }
    byId.set(profile.id, {
      ...prev,
      ...profile,
      token: pickProfileToken(prev, profile),
      name: profile.name || prev.name,
    });
  }
  return [...byId.values()];
}

/** Не затираем таблицу и ключи пустым сохранением от участника без данных. */
export function mergeWorkspacePayload(existing = {}, incoming = {}) {
  const next = { ...existing, ...incoming };

  const inCache = incoming.cache;
  const exCache = existing.cache;
  if (inCache?.rows?.length) {
    next.cache = inCache;
  } else if (exCache?.rows?.length) {
    next.cache = exCache;
  } else {
    next.cache = inCache ?? exCache ?? null;
  }

  next.profiles = mergeWorkspaceProfiles(existing.profiles, incoming.profiles);
  if (!next.profiles?.length) next.profiles = [];

  if (incoming.activeProfileId && next.profiles.some((p) => p.id === incoming.activeProfileId)) {
    next.activeProfileId = incoming.activeProfileId;
  } else if (existing.activeProfileId && next.profiles.some((p) => p.id === existing.activeProfileId)) {
    next.activeProfileId = existing.activeProfileId;
  } else {
    next.activeProfileId = next.profiles[0]?.id || '';
  }

  next.purchases = { ...(existing.purchases || {}), ...(incoming.purchases || {}) };

  if (incoming.supplierCatalogs?.items?.length) {
    next.supplierCatalogs = incoming.supplierCatalogs;
  } else if (existing.supplierCatalogs?.items?.length) {
    next.supplierCatalogs = existing.supplierCatalogs;
  }

  next.productOverrides = {
    ...(existing.productOverrides || {}),
    ...(incoming.productOverrides || {}),
  };

  if (incoming.settings && Object.keys(incoming.settings).length) {
    next.settings = incoming.settings;
  } else if (existing.settings) {
    next.settings = existing.settings;
  }

  if (incoming.teamAccess) next.teamAccess = incoming.teamAccess;
  else if (existing.teamAccess) next.teamAccess = existing.teamAccess;

  if (incoming.ownerClientId) next.ownerClientId = incoming.ownerClientId;
  else if (existing.ownerClientId) next.ownerClientId = existing.ownerClientId;

  return next;
}
