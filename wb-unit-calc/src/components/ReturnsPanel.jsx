import { Fragment, useMemo, useState } from 'react';
import { buildReturnsStats, filterReturnsSkuLines } from '@lib/wb-returns-stats.js';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format';
import { HintIcon, KpiWithHint, TabDescription } from './RegionsPlannerHints';

const RETURNS_HINTS = {
  returnRate: 'Доля возвратов от всех операций (продажи + возвраты) за период отчёта реализации.',
  returnCost:
    'Сумма обратной логистики — строки «Логистика» с bonus_type_name «от клиента» / «возврат» в отчёте WB.',
  retailReturn: 'Сумма retail_amount по операциям «Возврат» — сколько денег покупателей вернули.',
  buyoutRate: 'Выкуп = продажи / (продажи + возвраты). Чем ниже — тем больше возвратов.',
  returnCostPerSale: 'Обратная логистика на одну продажу — скрытый налог на юнит при низком выкупе.',
  avgReturnLogistics: 'Средняя стоимость обратной доставки на один возврат.',
  reasonNote:
    'WB не публикует причины возврата (брак, не подошёл размер и т.д.) в отчёте реализации. Ниже — типы финансовых операций.',
};

const SORT_OPTIONS = [
  { id: 'returns', label: 'Возвраты, шт' },
  { id: 'returnCost', label: 'Стоимость логистики' },
  { id: 'returnRate', label: 'Доля возвратов' },
  { id: 'retailReturn', label: 'Retail возвратов' },
  { id: 'vendor', label: 'Артикул' },
];

function ReasonBar({ items }) {
  const totalRub = items.reduce((s, x) => s + (x.rub || 0), 0);
  if (!items.length) return <p className="text-sm text-slate-500">Нет данных за период.</p>;

  return (
    <div className="space-y-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
        {items.map((item, i) => (
          <div
            key={item.key}
            className="h-full"
            style={{
              width: `${Math.max(2, totalRub > 0 ? (item.rub / totalRub) * 100 : 100 / items.length)}%`,
              backgroundColor: ['#f43f5e', '#fb923c', '#a78bfa', '#38bdf8'][i % 4],
            }}
            title={`${item.label}: ${fmtMoney(item.rub)}`}
          />
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.key} className="flex items-start gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-800">{item.label}</p>
              <p className="mt-0.5 text-slate-500">
                {item.qty > 0 ? `${fmtNum(item.qty)} шт` : '—'}
                {item.factual === false ? ' · оценка' : ' · факт'}
              </p>
            </div>
            <div className="text-right tabular-nums">
              <p className="font-semibold text-slate-800">{fmtMoney(item.rub)}</p>
              {item.sharePct != null ? <p className="text-slate-400">{fmtPct(item.sharePct)}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function periodLabel(period) {
  if (!period?.dateFrom || !period?.dateTo) return 'период неизвестен';
  return `${period.dateFrom} — ${period.dateTo}`;
}

function sortSkuLines(lines, sortId) {
  const sorted = [...lines];
  sorted.sort((a, b) => {
    switch (sortId) {
      case 'returnCost':
        return (b.returnLogisticsRub || 0) - (a.returnLogisticsRub || 0);
      case 'returnRate':
        return (b.returnRate || 0) - (a.returnRate || 0);
      case 'retailReturn':
        return (b.retailReturnRub || 0) - (a.retailReturnRub || 0);
      case 'vendor':
        return String(a.vendorCode).localeCompare(String(b.vendorCode), 'ru');
      default:
        return (b.returns || 0) - (a.returns || 0);
    }
  });
  return sorted;
}

export default function ReturnsPanel({ rows = [], meta = {}, realizationSnapshot = null }) {
  const [query, setQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [sortId, setSortId] = useState('returns');
  const [onlyWithCost, setOnlyWithCost] = useState(false);
  const [expandedNm, setExpandedNm] = useState(null);

  const stats = useMemo(
    () =>
      buildReturnsStats({
        realizationSnapshot: realizationSnapshot || meta?.realizationSnapshot || null,
        rows,
        period: meta?.realizationPeriod,
        source: meta?.realizationSource,
        realizationError: meta?.realizationError,
      }),
    [rows, meta, realizationSnapshot]
  );

  const brands = useMemo(
    () => [...new Set(stats.bySku.map((r) => r.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
    [stats.bySku]
  );

  const subjects = useMemo(
    () =>
      [...new Set(stats.bySku.map((r) => r.subjectName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
    [stats.bySku]
  );

  const filtered = useMemo(
    () =>
      sortSkuLines(
        filterReturnsSkuLines(stats.bySku, {
          query,
          brand: brandFilter,
          subject: subjectFilter,
          onlyWithCost,
        }),
        sortId
      ),
    [stats.bySku, query, brandFilter, subjectFilter, onlyWithCost, sortId]
  );

  const { totals } = stats;
  const noData = !stats.loaded || (!totals.returns && !totals.returnLogisticsRub);

  return (
    <div className="flex flex-col gap-5">
      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Возвраты</h2>
            <p className="mt-1 text-xs text-slate-500">
              Факт из отчёта реализации WB ({periodLabel(stats.period)}).
              {stats.source ? ` Источник: ${stats.source}.` : ''}
            </p>
          </div>
          {totals.skuWithReturns > 0 ? (
            <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700">
              {fmtNum(totals.skuWithReturns)} SKU с возвратами
            </span>
          ) : null}
        </div>

        {stats.error ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {stats.error}
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiWithHint
            label="Доля возвратов"
            hint={RETURNS_HINTS.returnRate}
            value={totals.returnRate != null ? fmtPct(totals.returnRate) : '—'}
            sub={
              totals.buyoutRate != null
                ? `Выкуп ${fmtPct(totals.buyoutRate)} · ${fmtNum(totals.returns)} из ${fmtNum(totals.sales + totals.returns)}`
                : undefined
            }
          />
          <KpiWithHint
            label="Обратная логистика"
            hint={RETURNS_HINTS.returnCost}
            value={fmtMoney(totals.returnLogisticsRub)}
            sub={
              totals.returnCostPerSaleRub != null
                ? `${fmtMoney(totals.returnCostPerSaleRub)} на продажу`
                : undefined
            }
          />
          <KpiWithHint
            label="Retail возвратов"
            hint={RETURNS_HINTS.retailReturn}
            value={fmtMoney(totals.retailReturnRub)}
            sub="сумма retail_amount"
          />
          <KpiWithHint
            label="Логистика / возврат"
            hint={RETURNS_HINTS.avgReturnLogistics}
            value={totals.avgReturnLogisticsRub != null ? fmtMoney(totals.avgReturnLogisticsRub) : '—'}
            sub={`${fmtNum(totals.returns)} возвратов`}
          />
        </div>
      </section>

      <section className="panel">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Структура возвратов</h3>
          <HintIcon text={RETURNS_HINTS.reasonNote} />
        </div>
        <TabDescription hint={stats.reasonNote} />
        <div className="mt-4">
          <ReasonBar items={stats.reasonBreakdown} />
        </div>
      </section>

      {stats.bySubject.length > 1 ? (
        <section className="panel">
          <h3 className="text-sm font-semibold text-slate-800">По категориям</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Категория</th>
                  <th className="py-2 pr-3 font-medium">SKU</th>
                  <th className="py-2 pr-3 font-medium">Возвраты</th>
                  <th className="py-2 pr-3 font-medium">Доля</th>
                  <th className="py-2 pr-3 font-medium">Логистика</th>
                  <th className="py-2 font-medium">Retail</th>
                </tr>
              </thead>
              <tbody>
                {stats.bySubject.slice(0, 12).map((row) => (
                  <tr key={row.label} className="border-b border-slate-50">
                    <td className="py-2 pr-3 font-medium text-slate-800">{row.label}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.skuCount || 1}</td>
                    <td className="py-2 pr-3 tabular-nums">{fmtNum(row.returns)}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.returnRate != null ? fmtPct(row.returnRate) : '—'}</td>
                    <td className="py-2 pr-3 tabular-nums">{fmtMoney(row.returnLogisticsRub)}</td>
                    <td className="py-2 tabular-nums">{fmtMoney(row.retailReturnRub)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">По артикулам</h3>
            <p className="mt-1 text-xs text-slate-500">Возвраты, стоимость логистики и выкуп по SKU.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder="Поиск…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
            />
            {brands.length > 1 ? (
              <select
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
              >
                <option value="">Все бренды</option>
                {brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            ) : null}
            {subjects.length > 1 ? (
              <select
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
              >
                <option value="">Все категории</option>
                {subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              value={sortId}
              onChange={(e) => setSortId(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={onlyWithCost}
                onChange={(e) => setOnlyWithCost(e.target.checked)}
              />
              С логистикой
            </label>
          </div>
        </div>

        {noData ? (
          <p className="mt-6 text-center text-sm text-slate-500">
            Нет возвратов за период. Запустите «Быстро» — данные подтянутся из отчёта реализации (уже синхронизированного).
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Артикул</th>
                  <th className="py-2 pr-3 font-medium">Прод.</th>
                  <th className="py-2 pr-3 font-medium">Возвр.</th>
                  <th className="py-2 pr-3 font-medium">
                    <span className="inline-flex items-center gap-1">
                      Доля
                      <HintIcon text={RETURNS_HINTS.returnRate} />
                    </span>
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    <span className="inline-flex items-center gap-1">
                      Выкуп
                      <HintIcon text={RETURNS_HINTS.buyoutRate} />
                    </span>
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    <span className="inline-flex items-center gap-1">
                      Логистика
                      <HintIcon text={RETURNS_HINTS.returnCost} />
                    </span>
                  </th>
                  <th className="py-2 pr-3 font-medium">Retail</th>
                  <th className="py-2 pr-3 font-medium">
                    <span className="inline-flex items-center gap-1">
                      ₽/продажу
                      <HintIcon text={RETURNS_HINTS.returnCostPerSale} />
                    </span>
                  </th>
                  <th className="py-2 font-medium">Операции</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const key = row.nmId || row.vendorCode;
                  const expanded = expandedNm === key;
                  const hasReasons = (row.reasonBreakdown || []).length > 0;
                  return (
                    <Fragment key={key}>
                      <tr
                        className={`border-b border-slate-50 ${hasReasons ? 'cursor-pointer hover:bg-slate-50/80' : ''}`}
                        onClick={() => hasReasons && setExpandedNm(expanded ? null : key)}
                      >
                        <td className="py-2 pr-3">
                          <p className="font-medium text-slate-800">{row.vendorCode || '—'}</p>
                          {row.title ? <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{row.title}</p> : null}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">{fmtNum(row.sales)}</td>
                        <td className="py-2 pr-3 tabular-nums font-medium text-rose-700">{fmtNum(row.returns)}</td>
                        <td className="py-2 pr-3 tabular-nums">{row.returnRate != null ? fmtPct(row.returnRate) : '—'}</td>
                        <td className="py-2 pr-3 tabular-nums">{row.buyoutRate != null ? fmtPct(row.buyoutRate) : '—'}</td>
                        <td className="py-2 pr-3 tabular-nums">{fmtMoney(row.returnLogisticsRub)}</td>
                        <td className="py-2 pr-3 tabular-nums">{fmtMoney(row.retailReturnRub)}</td>
                        <td className="py-2 pr-3 tabular-nums">{fmtMoney(row.returnCostPerSaleRub)}</td>
                        <td className="py-2 text-slate-400">{hasReasons ? (expanded ? '▾' : '▸') : '—'}</td>
                      </tr>
                      {expanded && hasReasons ? (
                        <tr className="bg-slate-50/60">
                          <td colSpan={9} className="px-3 py-2">
                            <div className="flex flex-wrap gap-3">
                              {row.reasonBreakdown.map((r) => (
                                <span
                                  key={r.key}
                                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600"
                                >
                                  {r.label}: {r.qty > 0 ? `${fmtNum(r.qty)} шт · ` : ''}
                                  {fmtMoney(r.rub)}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">Ничего не найдено по фильтрам.</p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
