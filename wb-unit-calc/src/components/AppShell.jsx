import Logo from './Logo';
import { canAccessSection } from '@lib/team-permissions.js';

const NAV = [
  { id: 'calc', label: 'Расчёты', hint: 'Таблица и сводка' },
  { id: 'logistics', label: 'Логистика', hint: 'Сверка расчёта с отчётом WB' },
  { id: 'pnl', label: 'Факт P&L', hint: 'Прибыль по отчёту WB' },
  { id: 'data', label: 'Данные', hint: 'WB, прайс, ключи' },
  { id: 'team', label: 'Команда', hint: 'Общий доступ' },
  { id: 'admin', label: 'Админка', hint: 'Права участников', creatorOnly: true },
  { id: 'settings', label: 'Настройки', hint: 'Тарифы и налоги' },
];

function NavIcon({ id }) {
  const cls = 'h-4 w-4';
  if (id === 'calc') {
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M8 6v12M16 6v12" />
      </svg>
    );
  }
  if (id === 'logistics') {
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 17h8M8 11h8M6 3h12l2 7H4l2-7zM5 21h14a1 1 0 001-1v-1H4v1a1 1 0 001 1z" />
      </svg>
    );
  }
  if (id === 'pnl') {
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V6m0 12v-2M4 7h4m8 0h4M6 19h12a2 2 0 002-2V9a2 2 0 00-2-2h-3.5L13 4H6a2 2 0 00-2 2v11a2 2 0 002 2z" />
      </svg>
    );
  }
  if (id === 'data') {
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5 5 5M12 5v12" />
      </svg>
    );
  }
  if (id === 'team') {
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m8-4a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    );
  }
  if (id === 'admin') {
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
        />
      </svg>
    );
  }
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h3M12 3v3M6 10.5h12M4.5 19.5h15a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0019.5 6h-15A1.5 1.5 0 003 7.5v9a1.5 1.5 0 001.5 1.5z" />
    </svg>
  );
}

export default function AppShell({
  section,
  onSectionChange,
  permissions,
  isTeamCreator = false,
  hasTeam = false,
  headerActions,
  syncBar,
  children,
}) {
  const navItems = NAV.filter((item) => {
    if (item.creatorOnly) return hasTeam && isTeamCreator;
    if (item.id === 'team') return true;
    if (!hasTeam) return true;
    return canAccessSection(item.id, permissions);
  });

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="app-header">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-4 px-4 py-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-6">
            <Logo />
            <nav className="hidden items-center gap-1 md:flex" aria-label="Разделы">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={item.hint}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    section === item.id ? 'app-header-nav-active' : 'app-header-nav'
                  }`}
                  onClick={() => onSectionChange(item.id)}
                >
                  <NavIcon id={item.id} />
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          {headerActions}
        </div>
        <div className="border-t border-brand-700/60 md:hidden">
          <nav className="mx-auto flex max-w-[1680px] gap-1 overflow-x-auto px-4 py-2" aria-label="Разделы">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
                  section === item.id ? 'bg-white/15 text-white' : 'text-brand-100'
                }`}
                onClick={() => onSectionChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {syncBar ? (
        <div className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-[1680px] px-4 py-2 text-xs text-slate-600 lg:px-6">{syncBar}</div>
        </div>
      ) : null}

      <main className="mx-auto max-w-[1680px] px-4 py-5 lg:px-6">{children}</main>
    </div>
  );
}
