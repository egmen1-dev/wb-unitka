import { useEffect, useState } from 'react';
import { buildShareUrl } from '../lib/workspace-api';

function toUpperName(value) {
  return String(value || '').toUpperCase();
}

export default function TeamPanel({
  team,
  teamName,
  isOwner = true,
  onTeamChange,
  onStartNewTeam,
  onCreateTeam,
  onJoinTeam,
  cloudStatus,
  updatedAt,
}) {
  const [mode, setMode] = useState(team ? 'connected' : 'create');
  const [joinCode, setJoinCode] = useState('');
  const [createName, setCreateName] = useState('НАША КОМАНДА');
  const [freshStart, setFreshStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [justCreatedCode, setJustCreatedCode] = useState('');

  useEffect(() => {
    if (!team) setMode('create');
  }, [team]);

  async function handleCreate(event) {
    event.preventDefault();
    setBusy(true);
    setLocalError('');
    setJustCreatedCode('');
    try {
      const created = await onCreateTeam({
        name: toUpperName(createName) || 'КОМАНДА',
        fresh: freshStart,
      });
      if (created?.teamCode) {
        setJustCreatedCode(created.teamCode);
      }
      setMode('connected');
    } catch (error) {
      setLocalError(error.message || 'Не удалось создать команду');
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(event) {
    event.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      await onJoinTeam(joinCode);
      setMode('connected');
    } catch (error) {
      setLocalError(error.message || 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text, setCopied) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (team && mode === 'connected') {
    const displayCode = team || justCreatedCode;

    return (
      <section className="panel border-brand-200 bg-brand-50/40">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-800">Общая команда</h2>
            {teamName ? (
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-600">{teamName}</p>
            ) : null}

            <div className="mt-3 rounded-lg border border-brand-300 bg-white p-3">
              <p className="text-xs font-medium text-slate-500">Код для входа коллег</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-2xl font-bold tracking-widest text-brand-700">
                  {displayCode}
                </span>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => copyText(displayCode, setCopiedCode)}
                >
                  {copiedCode ? 'Скопировано' : 'Копировать код'}
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Коллеги входят только по коду или ссылке — пароль не нужен.
              </p>
            </div>

            <p className="mt-2 text-xs text-slate-500">
              Токены, закупки и таблица общие для всех.
              {updatedAt ? ` Обновлено: ${new Date(updatedAt).toLocaleString('ru-RU')}.` : ''}
              {isOwner
                ? ' Вы создатель — настройте права в разделе «Админка».'
                : ' Ваши права настраивает создатель команды.'}
            </p>
            {cloudStatus ? <p className="mt-1 text-xs text-emerald-700">{cloudStatus}</p> : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => copyText(buildShareUrl(displayCode), setCopiedLink)}
            >
              {copiedLink ? 'Ссылка скопирована' : 'Ссылка для команды'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                onStartNewTeam?.();
                setMode('create');
                setLocalError('');
              }}
            >
              Создать новую
            </button>
            <button type="button" className="btn-secondary" onClick={() => onTeamChange()}>
              Выйти
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2 className="text-sm font-semibold text-slate-800">Работа в команде</h2>
      <p className="mt-1 text-xs text-slate-500">
        Вход только по коду или ссылке — без пароля и регистрации.
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={`btn ${mode === 'create' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setMode('create')}
        >
          Создать команду
        </button>
        <button
          type="button"
          className={`btn ${mode === 'join' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setMode('join')}
        >
          Войти по коду
        </button>
      </div>

      {localError ? <p className="mt-3 text-sm text-rose-700">{localError}</p> : null}

      {mode === 'join' ? (
        <form className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]" onSubmit={handleJoin}>
          <input
            className="input font-mono uppercase"
            placeholder="КОД КОМАНДЫ"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            required
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? '…' : 'Войти'}
          </button>
        </form>
      ) : (
        <form className="mt-4 grid gap-3" onSubmit={handleCreate}>
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Будет создан <strong>новый</strong> 8-символьный код команды. Старая команда останется в облаке —
            коллеги по старому коду не потеряют доступ.
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Название команды</span>
            <input
              className="input uppercase"
              placeholder="НАЗВАНИЕ КОМАНДЫ"
              value={createName}
              onChange={(e) => setCreateName(toUpperName(e.target.value))}
              style={{ textTransform: 'uppercase' }}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={freshStart}
              onChange={(e) => setFreshStart(e.target.checked)}
            />
            Пустая команда (без ключей WB, таблицы и закупок из текущей сессии)
          </label>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Создание…' : 'Создать команду — получить код'}
          </button>
        </form>
      )}
    </section>
  );
}
