import { useState } from 'react';
import { createProfileId } from '../lib/storage';
import WbTokenScopesHint from './WbTokenScopesHint';

function maskToken(token) {
  if (!token || token.length < 12) return '••••';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

export default function ApiKeyPanel({
  profiles,
  activeProfileId,
  onProfilesChange,
  onActiveChange,
  onProfileAdded,
  teamMode = false,
}) {
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [showForm, setShowForm] = useState(profiles.length === 0);

  const active = profiles.find((p) => p.id === activeProfileId) || profiles[0];

  function addProfile(event) {
    event.preventDefault();
    const trimmedToken = token.trim();
    if (!trimmedToken) return;

    const profile = {
      id: createProfileId(),
      name: name.trim() || `Кабинет ${profiles.length + 1}`,
      token: trimmedToken,
      createdAt: new Date().toISOString(),
    };

    const next = [...profiles, profile];
    onProfilesChange(next);
    onActiveChange(profile.id);
    onProfileAdded?.(profile);
    setName('');
    setToken('');
    setShowForm(false);
  }

  function removeProfile(id) {
    const next = profiles.filter((p) => p.id !== id);
    onProfilesChange(next);
    if (activeProfileId === id) {
      onActiveChange(next[0]?.id || '');
    }
  }

  return (
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">API-ключи WB</h2>
          <p className="mt-1 text-xs text-slate-500">
            {teamMode
              ? 'Общие для команды — видны всем по ссылке. После сохранения ключ автоматически запускает загрузку.'
              : 'Создайте команду выше, чтобы коллеги видели те же ключи.'}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Скрыть' : '+ Добавить ключ'}
        </button>
      </div>

      {profiles.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                profile.id === active?.id
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-slate-200 bg-slate-50'
              }`}
            >
              <button
                type="button"
                className="font-medium text-slate-800"
                onClick={() => onActiveChange(profile.id)}
              >
                {profile.name}
              </button>
              <span className="font-mono text-xs text-slate-500">{maskToken(profile.token)}</span>
              <button
                type="button"
                className="text-xs text-rose-600 hover:underline"
                onClick={() => removeProfile(profile.id)}
              >
                удалить
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-amber-700">Добавьте WB API токен, чтобы загрузить каталог.</p>
      )}

      <div className="mt-3">
        <WbTokenScopesHint token={active?.token} compact showCheckButton={Boolean(active?.token)} />
      </div>

      {showForm ? (
        <form className="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto]" onSubmit={addProfile}>
          <input
            className="input"
            placeholder="Название (напр. Основной)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input font-mono text-xs"
            placeholder="WB API токен"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
          <button type="submit" className="btn-primary">
            Сохранить
          </button>
        </form>
      ) : null}
    </section>
  );
}
