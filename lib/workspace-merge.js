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
      token: profile.token || prev.token,
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
