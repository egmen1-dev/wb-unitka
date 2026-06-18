import { useState } from 'react';
import { createProfileId } from '../lib/storage';
import { readJsonResponse } from '../lib/http';

function maskToken(token) {
  if (!token || token.length < 12) return '••••';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

function normalizeInputToken(token) {
  return String(token || '')
    .trim()
    .replace(/^Bearer\s+/i, '');
}

async function validateWbToken(token) {
  const response = await fetch('/api/unit-calc/validate-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  const { data } = await readJsonResponse(response);
  return { ok: response.ok, status: response.status, data };
}

export default function ApiKeyPanel({
  profiles,
  activeProfileId,
  onProfilesChange,
  onActiveChange,
  onProfileAdded,
  onProfileRemove,
  teamMode = false,
  tokenInvalid = false,
  tokenInvalidMessage = '',
}) {
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [showForm, setShowForm] = useState(profiles.length === 0);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const active = profiles.find((p) => p.id === activeProfileId) || profiles[0];

  async function addProfile(event) {
    event.preventDefault();
    const trimmedToken = normalizeInputToken(token);
    if (!trimmedToken) return;

    setSaving(true);
    setFormError('');

    try {
      const check = await validateWbToken(trimmedToken);
      if (!check.ok) {
        setFormError(check.data?.error || 'Токен не прошёл проверку WB');
        return;
      }

      const now = new Date().toISOString();
      const profile = {
        id: createProfileId(),
        name: name.trim() || `Кабинет ${profiles.length + 1}`,
        token: trimmedToken,
        createdAt: now,
        tokenUpdatedAt: now,
      };

      const next = [...profiles, profile];
      onProfilesChange(next);
      onActiveChange(profile.id);
      onProfileAdded?.(profile);
      setName('');
      setToken('');
      setShowForm(false);
    } catch (err) {
      setFormError(err.message || 'Не удалось проверить токен');
    } finally {
      setSaving(false);
    }
  }

  function removeProfile(id, event) {
    event?.stopPropagation();
    if (onProfileRemove) {
      onProfileRemove(id);
      return;
    }
    const target = profiles.find((p) => p.id === id);
    if (!target) return;
    if (!window.confirm(`Удалить ключ «${target.name}»?`)) return;

    const next = profiles.filter((p) => p.id !== id);
    onProfilesChange(next);
    if (activeProfileId === id) {
      onActiveChange(next[0]?.id || '');
    }
  }

  return (
    <section className={`panel ${tokenInvalid ? 'border-rose-400 ring-2 ring-rose-200' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">API-ключи WB</h2>
          {tokenInvalid ? (
            <p className="mt-1 text-xs font-medium text-rose-700">
              {tokenInvalidMessage || 'Токен отклонён WB — замените ключ ниже'}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-slate-500">
            {teamMode
              ? 'Общие для команды — видны всем по ссылке. После сохранения ключ автоматически запускает загрузку.'
              : 'Создайте команду выше, чтобы коллеги видели те же ключи.'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Нужны категории: Контент, Цены и скидки, Маркетплейс, Тарифы. Для ответов на отзывы —{' '}
            <a
              href="https://wb-feedbacks.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-700 underline"
            >
              отдельный сервис
            </a>{' '}
            со своим токеном «Вопросы и отзывы».
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Скрыть' : tokenInvalid ? 'Заменить токен' : '+ Добавить ключ'}
        </button>
      </div>

      {profiles.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                profile.id === active?.id
                  ? tokenInvalid && profile.id === active?.id
                    ? 'border-rose-500 bg-rose-50'
                    : 'border-brand-500 bg-brand-50'
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
                onClick={(event) => removeProfile(profile.id, event)}
              >
                удалить
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-amber-700">Добавьте WB API токен, чтобы загрузить каталог.</p>
      )}

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
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Проверка…' : 'Сохранить'}
          </button>
          {formError ? (
            <p className="md:col-span-3 text-xs font-medium text-rose-700">{formError}</p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
