import { useMemo, useState } from 'react';
import {
  PERMISSION_SECTIONS,
  listTeamMembers,
  normalizeTeamAccess,
  setMemberDefaults,
  setMemberPermissions,
} from '@lib/team-permissions.js';
import { getClientId } from '../lib/team-access';

function PermGrid({ permissions, onChange, disabled }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {PERMISSION_SECTIONS.map((section) => (
        <label
          key={section.id}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
            disabled ? 'border-slate-100 bg-slate-50 text-slate-500' : 'border-slate-200 bg-white'
          }`}
        >
          <input
            type="checkbox"
            className="mt-0.5"
            checked={permissions[section.id] !== false}
            disabled={disabled}
            onChange={(e) => onChange(section.id, e.target.checked)}
          />
          <span>
            <span className="font-medium text-slate-800">{section.label}</span>
            <span className="mt-0.5 block text-xs text-slate-500">{section.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export default function TeamPermissionsPanel({
  teamAccess,
  ownerClientId,
  isTeamCreator,
  onTeamAccessChange,
}) {
  const myClientId = getClientId();
  const access = useMemo(() => normalizeTeamAccess(teamAccess), [teamAccess]);
  const members = useMemo(
    () => listTeamMembers(access, { ownerClientId, myClientId }),
    [access, ownerClientId, myClientId]
  );

  const [selectedId, setSelectedId] = useState(() => members.find((m) => !m.isCreator)?.clientId || '');

  const selected = members.find((m) => m.clientId === selectedId) || members[0];

  if (!isTeamCreator) {
    const mine = members.find((m) => m.isSelf);
    return (
      <section className="panel">
        <h2 className="text-sm font-semibold text-slate-800">Ваши права в команде</h2>
        <p className="mt-1 text-xs text-slate-500">Настраивает создатель команды в разделе «Админка».</p>
        {mine ? (
          <div className="mt-4">
            <PermGrid permissions={mine.permissions} disabled />
          </div>
        ) : null}
      </section>
    );
  }

  function updateDefaults(sectionId, allowed) {
    onTeamAccessChange(setMemberDefaults(access, { ...access.memberDefaults, [sectionId]: allowed }));
  }

  function updateMember(sectionId, allowed) {
    if (!selected || selected.isCreator) return;
    const next = {
      ...selected.permissions,
      [sectionId]: allowed,
    };
    onTeamAccessChange(setMemberPermissions(access, selected.clientId, next));
  }

  function updateMemberLabel(clientId, label) {
    const entry = access.members[clientId] || {};
    onTeamAccessChange({
      ...access,
      members: {
        ...access.members,
        [clientId]: { ...entry, label: String(label || '').trim() },
      },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="panel border-violet-200 bg-violet-50/40">
        <h2 className="text-sm font-semibold text-slate-900">Админка · права доступа</h2>
        <p className="mt-1 text-xs text-slate-600">
          Вы создатель команды. Настройте, какие разделы видят участники. Изменения сохраняются в облаке для всей
          команды.
        </p>
      </section>

      <section className="panel">
        <h3 className="text-sm font-semibold text-slate-800">Права по умолчанию для новых участников</h3>
        <p className="mt-1 text-xs text-slate-500">Применяются, пока вы не настроите участника отдельно.</p>
        <div className="mt-4">
          <PermGrid permissions={access.memberDefaults} onChange={updateDefaults} />
        </div>
      </section>

      <section className="panel !p-0 overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">Участники</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Появляются после входа по коду команды. Создатель всегда имеет полный доступ.
          </p>
        </div>

        <div className="grid gap-0 lg:grid-cols-[240px_1fr]">
          <ul className="border-b border-slate-100 lg:border-b-0 lg:border-r">
            {members.map((member) => (
              <li key={member.clientId}>
                <button
                  type="button"
                  className={`flex w-full flex-col items-start px-4 py-3 text-left text-sm transition ${
                    selected?.clientId === member.clientId ? 'bg-brand-50 text-brand-800' : 'hover:bg-slate-50'
                  }`}
                  onClick={() => setSelectedId(member.clientId)}
                >
                  <span className="font-medium">{member.name}</span>
                  <span className="text-[11px] text-slate-500 font-mono">{member.clientId.slice(0, 8)}…</span>
                  {member.lastSeen ? (
                    <span className="text-[10px] text-slate-400">
                      {member.isSelf ? 'Этот браузер' : 'Был(а)'} ·{' '}
                      {new Date(member.lastSeen).toLocaleString('ru-RU')}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          {selected ? (
            <div className="px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-slate-900">{selected.name}</h4>
                {selected.isCreator ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                    Создатель
                  </span>
                ) : null}
              </div>

              {!selected.isCreator ? (
                <label className="mt-3 block text-sm">
                  <span className="mb-1 block text-slate-600">Имя в списке (необязательно)</span>
                  <input
                    className="input max-w-xs"
                    placeholder="Менеджер, бухгалтер…"
                    value={access.members[selected.clientId]?.label || ''}
                    onChange={(e) => updateMemberLabel(selected.clientId, e.target.value)}
                  />
                </label>
              ) : null}

              <div className="mt-4">
                <PermGrid
                  permissions={selected.permissions}
                  onChange={updateMember}
                  disabled={selected.isCreator}
                />
              </div>
              {selected.isCreator ? (
                <p className="mt-3 text-xs text-slate-500">Права создателя изменить нельзя.</p>
              ) : null}
            </div>
          ) : (
            <div className="px-4 py-8 text-sm text-slate-500">Пока нет участников кроме вас.</div>
          )}
        </div>
      </section>
    </div>
  );
}
