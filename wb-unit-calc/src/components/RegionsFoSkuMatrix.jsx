import { useMemo, useState } from 'react';
import { fmtNum } from '../lib/format';
import { HintIcon, TabDescription, ThHint, PLANNER_HINTS } from './RegionsPlannerHints';

const STATUS_LABELS = {
  ship: { label: 'Отгрузить', className: 'bg-emerald-100 text-emerald-800' },
  ok: { label: 'OK', className: 'bg-slate-100 text-slate-700' },
  skip: { label: 'Не везти', className: 'bg-violet-100 text-violet-800' },
};

export default function RegionsFoSkuMatrix({ matrix, horizonDays }) {
  const [foFilter, setFoFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');

  const foOptions = useMemo(
    () => [...new Set((matrix?.rows || []).map((r) => r.foName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
    [matrix]
  );

  const filtered = useMemo(() => {
    let rows = matrix?.rows || [];
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          String(r.vendorCode).toLowerCase().includes(q) ||
          String(r.regionLabel).toLowerCase().includes(q) ||
          String(r.foName).toLowerCase().includes(q)
      );
    }
    if (foFilter) rows = rows.filter((r) => r.foName === foFilter);
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    return rows;
  }, [matrix, query, foFilter, statusFilter]);

  const summary = matrix?.summary;

  return (
    <div className="p-4">
      <TabDescription hint={PLANNER_HINTS.tabs.matrix} />

      {summary ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-medium text-emerald-800">
            Отгрузить: {summary.shipCount}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-700">
            OK: {summary.okCount}
          </span>
          <span className="rounded-full bg-violet-100 px-2.5 py-0.5 font-medium text-violet-800">
            Не везти: {summary.skipCount}
          </span>
          <span className="text-slate-400">· горизонт {horizonDays} дн.</span>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className="input w-44 py-1.5 text-xs"
          placeholder="Артикул или регион…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="input w-40 py-1.5 text-xs" value={foFilter} onChange={(e) => setFoFilter(e.target.value)}>
          <option value="">Все округа</option>
          {foOptions.map((fo) => (
            <option key={fo} value={fo}>
              {fo}
            </option>
          ))}
        </select>
        <select
          className="input w-32 py-1.5 text-xs"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Все статусы</option>
          <option value="ship">Отгрузить</option>
          <option value="ok">OK</option>
          <option value="skip">Не везти</option>
        </select>
        <span className="self-center text-xs text-slate-400">{filtered.length} строк</span>
      </div>

      <div className="table-scroll mt-3 max-h-[calc(100vh-480px)] overflow-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
            <tr>
              <th className="px-4 py-2 font-medium">Артикул</th>
              <th className="px-4 py-2 font-medium">ФО</th>
              <th className="px-4 py-2 font-medium">Регион</th>
              <ThHint hint={PLANNER_HINTS.columns.demandQty}>Спрос</ThHint>
              <ThHint hint={PLANNER_HINTS.columns.foStock}>Остаток ФО</ThHint>
              <ThHint hint={PLANNER_HINTS.matrix.daysOfCover}>Дней покрытия</ThHint>
              <ThHint hint={PLANNER_HINTS.matrix.status}>Статус</ThHint>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const st = STATUS_LABELS[row.status] || STATUS_LABELS.ok;
              return (
                <tr key={row.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                  <td className="px-4 py-2 font-medium text-brand-700">{row.vendorCode}</td>
                  <td className="px-4 py-2 text-slate-600">{row.foName}</td>
                  <td className="px-4 py-2 text-slate-500">{row.regionLabel}</td>
                  <td className="px-4 py-2 tabular-nums">{fmtNum(row.demandQty, 0)}</td>
                  <td className="px-4 py-2 tabular-nums">{fmtNum(row.foStockQty, 0)}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {row.daysOfCover >= 999 ? '∞' : fmtNum(row.daysOfCover, 1)}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.className}`}>
                      {st.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!filtered.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Нет строк по фильтрам
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
