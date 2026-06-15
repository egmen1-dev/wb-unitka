import { useMemo, useState } from 'react';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format';
import { regionEmptyMessage, regionSourceLabel } from '../lib/region-empty-message';

const VIEWS = [
  { id: 'region', label: 'Регионы' },
  { id: 'fo', label: 'Округа' },
  { id: 'city', label: 'Города' },
  { id: 'warehouse', label: 'Склады WB' },
];

function Kpi({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-slate-800">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

function ShareBar({ sharePct }) {
  const width = Math.max(4, Math.round((sharePct || 0) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full bg-brand-500" style={{ width: `${width}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-600">{fmtPct(sharePct)}</span>
    </div>
  );
}

export default function RegionsPanel({ rows = [], meta = {} }) {
  const [view, setView] = useState('region');
  const [query, setQuery] = useState('');

  const periodLabel = meta?.regionSalesPeriod
    ? `${meta.regionSalesPeriod.dateFrom} — ${meta.regionSalesPeriod.dateTo}`
    : '30 дней';

  const snapshot = meta?.regionSalesSnapshot || null;

  const titleByNmId = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      if (row.nmId) map.set(Number(row.nmId), row.title || row.vendorCode || String(row.nmId));
    }
    return map;
  }, [rows]);

  const list = useMemo(() => {
    if (!snapshot) return [];
    if (view === 'fo') return snapshot.byFo || [];
    if (view === 'city') return snapshot.byCity || [];
    if (view === 'warehouse') return snapshot.warehouses || [];
    return snapshot.byRegion || [];
  }, [snapshot, view]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => {
      const hay = [
        item.label,
        item.regionName,
        item.foName,
        item.cityName,
        item.warehouseName,
        ...(item.regions || []),
        ...(item.suggestedWarehouses || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [list, query]);

  const topRegion = snapshot?.byRegion?.[0];
  const topWarehouse = snapshot?.warehouses?.[0];

  if (!snapshot?.totalQty) {
    const hint = regionEmptyMessage(meta, rows.length);
    return (
      <section className="panel py-10 text-center">
        <p className="text-sm font-medium text-slate-700">Нет данных по регионам</p>
        <p className="mt-2 text-sm text-slate-500">{hint}</p>
        {meta?.regionSalesPeriod ? (
          <p className="mt-3 text-xs text-slate-400">
            Период: {meta.regionSalesPeriod.dateFrom} — {meta.regionSalesPeriod.dateTo}
            {meta.regionSalesSource ? ` · ${regionSourceLabel(meta.regionSalesSource)}` : ''}
          </p>
        ) : null}
        {!meta?.regionSalesPeriod ? (
          <p className="mt-3 text-xs text-slate-400">
            Раздел обновляется при синхронизации — отдельный доступ Analytics не обязателен.
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="panel border-brand-100 bg-gradient-to-br from-brand-50/40 via-white to-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Спрос по географии</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-800">Куда уходят заказы покупателей</h2>
            <p className="mt-1 text-sm text-slate-500">
              Период: {periodLabel} · источник: {regionSourceLabel(meta?.regionSalesSource)}
              {snapshot.filteredByCatalog ? ' · только ваш каталог' : ' · весь кабинет'}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Заказов (шт.)" value={fmtNum(snapshot.totalQty, 0)} sub={`строк отчёта: ${snapshot.rowCount}`} />
          <Kpi label="Сумма retail" value={fmtMoney(snapshot.totalRevenue)} />
          <Kpi
            label="Топ регион"
            value={topRegion?.label || '—'}
            sub={topRegion ? `${fmtNum(topRegion.qty, 0)} шт. · ${fmtPct(topRegion.sharePct)}` : undefined}
          />
          <Kpi
            label="Склад для поставки"
            value={topWarehouse?.warehouseName || topRegion?.suggestedWarehouses?.[0] || '—'}
            sub={
              topWarehouse
                ? `~${fmtNum(topWarehouse.qty, 0)} шт. спроса · ${fmtPct(topWarehouse.sharePct)}`
                : 'Оценка по регионам спроса'
            }
          />
        </div>

        {topRegion?.suggestedWarehouses?.length ? (
          <div className="mt-4 rounded-lg border border-sky-100 bg-sky-50/70 px-4 py-3 text-sm text-sky-900">
            <span className="font-medium">Рекомендация:</span> для региона «{topRegion.label}» чаще всего логичны
            поставки на склады{' '}
            <span className="font-semibold">{topRegion.suggestedWarehouses.join(', ')}</span>. Сверяйте с остатками FBO
            и тарифами в разделе «Расчёты».
          </div>
        ) : null}
      </section>

      <section className="panel overflow-hidden p-0">
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {VIEWS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    view === item.id
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  onClick={() => setView(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <input
              className="input w-56 py-1.5 text-xs"
              placeholder="Поиск…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="table-scroll max-h-[calc(100vh-420px)] overflow-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">
                  {view === 'warehouse' ? 'Склад WB' : view === 'city' ? 'Город' : view === 'fo' ? 'Округ' : 'Регион'}
                </th>
                {view === 'city' ? <th className="px-4 py-2 font-medium">Регион</th> : null}
                {view === 'region' ? <th className="px-4 py-2 font-medium">Округ</th> : null}
                {view === 'warehouse' ? <th className="px-4 py-2 font-medium">Регионы спроса</th> : null}
                {view === 'region' ? <th className="px-4 py-2 font-medium">Склады WB</th> : null}
                <th className="px-4 py-2 font-medium">Заказы</th>
                <th className="px-4 py-2 font-medium">Доля</th>
                <th className="px-4 py-2 font-medium">Retail</th>
                <th className="px-4 py-2 font-medium">SKU</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, index) => (
                <tr key={`${item.key || item.label}-${index}`} className="border-t border-slate-100 hover:bg-brand-50/40">
                  <td className="px-4 py-2 text-slate-400">{index + 1}</td>
                  <td className="px-4 py-2 font-medium text-slate-800">{item.label || item.warehouseName}</td>
                  {view === 'city' ? <td className="px-4 py-2 text-slate-600">{item.regionName || '—'}</td> : null}
                  {view === 'region' ? <td className="px-4 py-2 text-slate-600">{item.foName || '—'}</td> : null}
                  {view === 'warehouse' ? (
                    <td className="px-4 py-2 text-slate-600">{(item.regions || []).join(', ') || '—'}</td>
                  ) : null}
                  {view === 'region' ? (
                    <td className="px-4 py-2 text-slate-600">
                      {(item.suggestedWarehouses || []).join(', ') || '—'}
                    </td>
                  ) : null}
                  <td className="px-4 py-2 tabular-nums text-slate-700">{fmtNum(item.qty, 0)}</td>
                  <td className="px-4 py-2">
                    <ShareBar sharePct={item.sharePct} />
                  </td>
                  <td className="px-4 py-2 tabular-nums text-slate-700">{fmtMoney(item.revenue)}</td>
                  <td className="px-4 py-2 text-slate-500">{item.skuCount ?? '—'}</td>
                </tr>
              ))}
              {!filtered.length ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    Ничего не найдено
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {snapshot.byNmId?.length ? (
        <section className="panel">
          <h3 className="text-sm font-semibold text-slate-800">Топ артикулов по заказам в регионах</h3>
          <p className="mt-1 text-xs text-slate-500">По данным отчёта WB за выбранный период</p>
          <div className="mt-3 overflow-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Артикул</th>
                  <th className="py-2 pr-4 font-medium">Название</th>
                  <th className="py-2 pr-4 font-medium">Заказы</th>
                  <th className="py-2 pr-4 font-medium">Доля</th>
                  <th className="py-2 font-medium">Retail</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.byNmId.slice(0, 15).map((item) => (
                  <tr key={item.key} className="border-t border-slate-100">
                    <td className="py-2 pr-4 font-medium text-brand-700">{item.label}</td>
                    <td className="py-2 pr-4 text-slate-600">
                      {titleByNmId.get(Number(item.key)) || '—'}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{fmtNum(item.qty, 0)}</td>
                    <td className="py-2 pr-4">{fmtPct(item.sharePct)}</td>
                    <td className="py-2 tabular-nums">{fmtMoney(item.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
