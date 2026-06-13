/** Разделы, доступ к которым настраивает создатель команды. */
export const PERMISSION_SECTIONS = [
  { id: 'calc', label: 'Расчёты', hint: 'Таблица юнит-экономики и сводка' },
  { id: 'logistics', label: 'Логистика', hint: 'Сверка расчёта с отчётом WB' },
  { id: 'pnl', label: 'Факт P&L', hint: 'Прибыль по отчёту реализации' },
  { id: 'data', label: 'Данные', hint: 'Ключи WB, прайсы, синхронизация' },
  { id: 'settings', label: 'Настройки', hint: 'Тарифы, налоги, формулы' },
];

export const ALL_SECTION_IDS = PERMISSION_SECTIONS.map((s) => s.id);

export const DEFAULT_MEMBER_PERMISSIONS = {
  calc: true,
  logistics: true,
  pnl: false,
  data: false,
  settings: false,
};

export const FULL_PERMISSIONS = Object.fromEntries(ALL_SECTION_IDS.map((id) => [id, true]));

export function normalizeTeamAccess(raw) {
  const memberDefaults = { ...DEFAULT_MEMBER_PERMISSIONS };
  if (raw?.memberDefaults && typeof raw.memberDefaults === 'object') {
    for (const id of ALL_SECTION_IDS) {
      if (typeof raw.memberDefaults[id] === 'boolean') {
        memberDefaults[id] = raw.memberDefaults[id];
      }
    }
  }

  const members = {};
  if (raw?.members && typeof raw.members === 'object') {
    for (const [clientId, entry] of Object.entries(raw.members)) {
      if (!clientId) continue;
      members[clientId] = normalizeMemberEntry(entry);
    }
  }

  return { memberDefaults, members };
}

function normalizeMemberEntry(entry) {
  const sections = {};
  if (entry?.sections && typeof entry.sections === 'object') {
    for (const id of ALL_SECTION_IDS) {
      if (typeof entry.sections[id] === 'boolean') sections[id] = entry.sections[id];
    }
  }
  return {
    label: String(entry?.label || '').trim(),
    firstSeen: entry?.firstSeen || null,
    lastSeen: entry?.lastSeen || null,
    sections,
  };
}

export function resolveMemberPermissions(teamAccess, clientId) {
  const access = normalizeTeamAccess(teamAccess);
  const overrides = access.members[clientId]?.sections || {};
  return { ...access.memberDefaults, ...overrides };
}

export function resolveMyPermissions({ team, teamAccess, isTeamCreator, clientId }) {
  if (!team) return { ...FULL_PERMISSIONS };
  if (isTeamCreator) return { ...FULL_PERMISSIONS };
  return resolveMemberPermissions(teamAccess, clientId);
}

export function canAccessSection(sectionId, permissions) {
  if (sectionId === 'team' || sectionId === 'admin') return true;
  if (!permissions) return true;
  return permissions[sectionId] !== false;
}

export function firstAllowedSection(permissions, { includeAdmin = false, isTeamCreator = false } = {}) {
  if (includeAdmin && isTeamCreator) return 'admin';
  for (const { id } of PERMISSION_SECTIONS) {
    if (canAccessSection(id, permissions)) return id;
  }
  return 'team';
}

export function touchTeamMember(teamAccess, clientId, { label } = {}) {
  const access = normalizeTeamAccess(teamAccess);
  const now = new Date().toISOString();
  const prev = access.members[clientId] || {};
  access.members[clientId] = {
    label: label || prev.label || '',
    firstSeen: prev.firstSeen || now,
    lastSeen: now,
    sections: prev.sections || {},
  };
  return access;
}

export function setMemberPermissions(teamAccess, clientId, sections) {
  const access = touchTeamMember(teamAccess, clientId);
  const prev = access.members[clientId] || {};
  const nextSections = {};
  for (const id of ALL_SECTION_IDS) {
    if (typeof sections[id] === 'boolean') nextSections[id] = sections[id];
  }
  access.members[clientId] = { ...prev, sections: nextSections };
  return access;
}

export function setMemberDefaults(teamAccess, memberDefaults) {
  const access = normalizeTeamAccess(teamAccess);
  for (const id of ALL_SECTION_IDS) {
    if (typeof memberDefaults[id] === 'boolean') access.memberDefaults[id] = memberDefaults[id];
  }
  return access;
}

export function memberDisplayName(clientId, entry, { isSelf = false, isCreator = false } = {}) {
  if (entry?.label) return entry.label;
  if (isCreator) return 'Создатель';
  if (isSelf) return 'Вы';
  return `Участник …${String(clientId || '').slice(-4)}`;
}

export function listTeamMembers(teamAccess, { ownerClientId, myClientId } = {}) {
  const access = normalizeTeamAccess(teamAccess);
  const ids = new Set(Object.keys(access.members));
  if (ownerClientId) ids.add(ownerClientId);
  if (myClientId) ids.add(myClientId);

  return [...ids]
    .filter(Boolean)
    .map((clientId) => {
      const entry = access.members[clientId] || {};
      const isCreator = ownerClientId === clientId;
      const isSelf = myClientId === clientId;
      return {
        clientId,
        entry,
        isCreator,
        isSelf,
        name: memberDisplayName(clientId, entry, { isSelf, isCreator }),
        permissions: isCreator
          ? { ...FULL_PERMISSIONS }
          : resolveMemberPermissions(access, clientId),
        lastSeen: entry.lastSeen,
        firstSeen: entry.firstSeen,
      };
    })
    .sort((a, b) => {
      if (a.isCreator !== b.isCreator) return a.isCreator ? -1 : 1;
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      return String(b.lastSeen || '').localeCompare(String(a.lastSeen || ''));
    });
}
