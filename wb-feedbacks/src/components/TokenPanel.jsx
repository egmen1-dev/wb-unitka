import { useState } from 'react';
import WbTokenScopesHint from './WbTokenScopesHint';

function maskToken(token) {
  if (!token || token.length < 12) return '••••';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

export default function TokenPanel({ token, onTokenChange }) {
  const [draft, setDraft] = useState(token);
  const [editing, setEditing] = useState(!token);

  function save(event) {
    event.preventDefault();
    const trimmed = draft.trim();
    onTokenChange(trimmed);
    setEditing(false);
  }

  function clearToken() {
    onTokenChange('');
    setDraft('');
    setEditing(true);
  }

  return (
    <section className="panel">
      <h2 className="text-sm font-semibold text-slate-800">Токен WB для отзывов</h2>
      <p className="mt-1 text-xs text-slate-500">
        Категория «Вопросы и отзывы». Хранится только в браузере (localStorage), не отправляется на наш
        сервер кроме прокси-запросов к WB.
      </p>

      {token && !editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-mono text-xs text-emerald-800">
            {maskToken(token)}
          </span>
          <button type="button" className="btn-secondary text-xs" onClick={() => setEditing(true)}>
            Изменить
          </button>
          <button type="button" className="text-xs text-rose-600 hover:underline" onClick={clearToken}>
            Удалить
          </button>
        </div>
      ) : (
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={save}>
          <input
            className="input font-mono text-xs"
            placeholder="Вставьте WB API токен"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
          />
          <button type="submit" className="btn-primary shrink-0">
            Сохранить
          </button>
        </form>
      )}

      {token ? (
        <WbTokenScopesHint
          token={token}
          collapsible
          defaultOpen={false}
          showCheckButton
          className="mt-3"
        />
      ) : null}
    </section>
  );
}
