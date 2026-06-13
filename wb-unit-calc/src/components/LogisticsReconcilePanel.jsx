import { Fragment, useMemo, useState } from 'react';
import {
  MATCH_LABELS,
  buildLogisticsReconciliation,
} from '@lib/logistics-compare.js';
import { schemeLabel } from '@lib/unit-scheme.js';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'ok', label: 'Сходится' },
  { id: 'low', label: 'Факт выше' },
  { id: 'high', label: 'Расчёт выше' },
  { id: 'subLiter', label: '≤ 1 л' },
  { id: 'overLiter', label: '> 1 л' },
];

const SORTS = [
  { id: 'delta', label: 'Расхождение ↓' },
  { id: 'actual', label: 'Факт ↓' },
  { id: 'calc', label: 'Расчёт ↓' },
  { id: 'sales', label: 'Продажи ↓' },
  { id: 'vendor', label: 'Артикул А–Я' },
];

function MatchBadge({ match }) {
  const meta = MATCH_LABELS[match] || MATCH_LABELS.ok;
  const tones = {
    ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    low: 'bg-amber-50 text-amber-900 ring-amber-200',
    high: 'bg-violet-50 text-violet-900 ring-violet-200',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${tones[meta.tone]}`}
      title={meta.hint}
    >
      {meta.label}
    </span>
  );
}

function KpiCard({ label, value, sub, tone = 'default' }) {
  const tones = {
    default: 'text-slate-800',
    ok: 'text-emerald-700',
    warn: 'text-amber-800',
    info: 'text-sky-800',
  };
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tones[tone]}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

function DeltaBar({ deltaPct, match }) {
  const pct = Math.min(100, Math.abs(deltaPct) * 100);
  const color =
    match === 'ok' ? 'bg-emerald-500' : match === 'low' ? 'bg-amber-500' : 'bg-violet-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span
        className={`text-xs font-medium tabular-nums ${
          match === 'ok' ? 'text-emerald-700' : match === 'low' ? 'text-amber-800' : 'text-violet-800'
        }`}
      >
        {deltaPct > 0 ? '+' : ''}
        {(deltaPct * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function FormulaBreakdown({ row, cmp }) {
  const tier =
    cmp.subLiterTariff != null
      ? `фикс. ${cmp.subLiterTariff}₽ × ${fmtNum(cmp.fbsCoeff ?? row.fbsCoeff, 2)}`
      : cmp.volumeLiters > 1
        ? `(46+14×(${fmtNum(cmp.volumeLiters, 2)}−1)) × ${fmtNum(cmp.fbsCoeff ?? row.fbsCoeff, 2)}`
        : '—';

  return (
    <div className="grid gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <p className="font-semibold text-slate-800">Прямая доставка</p>
        <p className="mt-1">
          Расчёт: <strong>{fmtMoney(cmp.forwardCalc)}</strong>
          {cmp.forwardPerSale != null ? (
            <>
              {' '}
              · факт: <strong>{fmtMoney(cmp.forwardPerSale)}</strong>
            </>
          ) : null}
        </p>
        <p className="mt-0.5 text-slate-500">Тариф: {tier}</p>
      </div>
      <div>
        <p className="font-semibold text-slate-800">Обратная + выкуп</p>
        <p className="mt-1">
          Обратная расч.: {fmtMoney(cmp.returnCalc)} · выкуп{' '}
          {row.buyoutFromReport ? fmtPct(cmp.buyout) : '100% (нет аналитики)'}
        </p>
        {cmp.returnPerSale != null ? (
          <p className="mt-0.5">
            Обратная факт/прод.: {fmtMoney(cmp.returnPerSale)} · продаж FBS: {cmp.sales}
          </p>
        ) : (
          <p className="mt-0.5 text-slate-500">Продаж FBS в отчёте: {cmp.sales || 0}</p>
        )}
      </div>
      <div>
        <p className="font-semibold text-slate-800">Итог на единицу</p>
        <p className="mt-1">
          Факт <strong>{fmtMoney(cmp.actual)}</strong> vs расчёт{' '}
          <strong>{fmtMoney(cmp.calc)}</strong> ({fmtMoney(cmp.deltaRub)})
        </p>
        {cmp.reasons.length ? (
          <ul className="mt-1 list-inside list-disc text-slate-500">
            {cmp.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-emerald-700">Формула совпадает с отчётом</p>
        )}
      </div>
    </div>
  );
}

function exportCsv(items) {
  const header =
    'Артикул;nmId;Объём л;Факт ₽;Расчёт ₽;Δ ₽;Δ %;Выкуп;Продажи;Статус;Причины';
  const lines = items.map(({ row, cmp }) =>
    [
      row.vendorCode,
      row.nmId,
      row.volumeLiters ?? '',
      cmp.actual.toFixed(2),
      cmp.calc.toFixed(2),
      cmp.deltaRub.toFixed(2),
      (cmp.deltaPct * 100).toFixed(1),
      (cmp.buyout * 100).toFixed(1),
      cmp.sales,
      MATCH_LABELS[cmp.match]?.label ?? cmp.match,
      cmp.reasons.join('; '),
    ].join(';')
  );
  const blob = new Blob(['\uFEFF' + [header, ...lines].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `logistics-reconcile-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function LogisticsReconcilePanel({ rows, settings, meta, onSelectRow }) {
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('delta');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(null);

  const data = useMemo(() => buildLogisticsReconciliation(rows, settings), [rows, settings]);
  const label = schemeLabel(data.scheme);

  const filtered = useMemo(() => {
    let list = data.items;
    if (filter === 'ok' || filter === 'low' || filter === 'high') {
      list = list.filter((x) => x.cmp.match === filter);
    } else if (filter === 'subLiter' || filter === 'overLiter') {
      list = list.filter((x) => x.cmp.volumeBand === filter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (x) =>
          String(x.row.vendorCode || '').toLowerCase().includes(q) ||
          String(x.row.title || '').toLowerCase().includes(q) ||
          String(x.row.nmId || '').includes(q)
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sort === 'vendor') {
        return String(a.row.vendorCode).localeCompare(String(b.row.vendorCode), 'ru');
      }
      if (sort === 'actual') return b.cmp.actual - a.cmp.actual;
      if (sort === 'calc') return b.cmp.calc - a.cmp.calc;
      if (sort === 'sales') return (b.cmp.sales || 0) - (a.cmp.sales || 0);
      return Math.abs(b.cmp.deltaPct) - Math.abs(a.cmp.deltaPct);
    });
    return sorted;
  }, [data.items, filter, sort, query]);

  if (!rows.length) {
    return (
      <section className="panel py-12 text-center">
        <p className="text-sm font-medium text-slate-700">Нет данных для сверки</p>
        <p className="mt-2 text-sm text-slate-500">
          Сначала синхронизируйте каталог с WB — нужен отчёт реализации (Statistics API).
        </p>
      </section>
    );
  }

  if (data.withActual === 0) {
    return (
      <section className="panel">
        <h2 className="text-lg font-semibold text-slate-900">Сверка логистики {label}</h2>
        <p className="mt-2 text-sm text-amber-900">
          Факт логистики из отчёта не загружен. Нажмите «Быстро» или «Полностью» в шапке — токен должен
          включать категорию <strong>Statistics</strong>.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          С габаритами: {data.withDims} SKU · без факта в отчёте: {data.withoutActual}
        </p>
      </section>
    );
  }

  const period = meta?.realizationPeriod
    ? `${meta.realizationPeriod.dateFrom} — ${meta.realizationPeriod.dateTo}`
    : '30 дней';

  return (
    <div className="flex flex-col gap-4">
      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Сверка логистики {label}</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Сравниваем расчёт по тарифам WB с фактом из отчёта реализации. Формула:{' '}
              <span className="font-medium text-slate-800">
                (прямая + обратная × невыкуп × 1,045) / выкуп
              </span>
              . Период: {period}.
            </p>
          </div>
          <button type="button" className="btn-secondary shrink-0" onClick={() => exportCsv(filtered)}>
            CSV ({filtered.length})
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            label="Сверено SKU"
            value={data.withActual}
            sub={`из ${data.withDims} с габаритами`}
          />
          <KpiCard
            label="Сходится ±25%"
            value={`${Math.round(data.okPct * 100)}%`}
            sub={`${data.ok} позиций`}
            tone="ok"
          />
          <KpiCard
            label="Медиана факт/расчёт"
            value={data.medianRatio != null ? `${data.medianRatio.toFixed(2)}×` : '—'}
            sub="1,0 = идеально"
            tone="info"
          />
          <KpiCard
            label="Факт выше расчёта"
            value={data.calcLow}
            sub="расчёт занижен"
            tone="warn"
          />
          <KpiCard
            label="Расчёт выше факта"
            value={data.calcHigh}
            sub="расчёт завышен"
          />
          <KpiCard
            label="Продаж в отчёте"
            value={data.totalReportSales}
            sub={
              data.salesWeightedDeltaPct != null
                ? `ср. Δ ${(data.salesWeightedDeltaPct * 100).toFixed(1)}% взв.`
                : undefined
            }
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel lg:col-span-1">
          <h3 className="text-sm font-semibold text-slate-800">По объёму</h3>
          <div className="mt-3 space-y-3">
            {[
              { key: 'subLiter', title: '≤ 1 л (фикс. тариф)' },
              { key: 'overLiter', title: '> 1 л (по литрам)' },
            ].map(({ key, title }) => {
              const band = data.bandStats[key];
              if (!band.total) return null;
              return (
                <button
                  key={key}
                  type="button"
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    filter === key
                      ? 'border-brand-300 bg-brand-50 ring-1 ring-brand-200'
                      : 'border-slate-100 bg-slate-50 hover:border-slate-200'
                  }`}
                  onClick={() => setFilter(filter === key ? 'all' : key)}
                >
                  <p className="text-xs font-medium text-slate-800">{title}</p>
                  <p className="mt-1 text-[11px] text-slate-600">
                    {band.total} SKU · сходится {Math.round(band.okPct * 100)}%
                    {band.medianRatio != null ? ` · медиана ${band.medianRatio.toFixed(2)}×` : ''}
                  </p>
                  <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-200">
                    {band.ok > 0 ? (
                      <span
                        className="bg-emerald-500"
                        style={{ width: `${(band.ok / band.total) * 100}%` }}
                        title={`Сходится: ${band.ok}`}
                      />
                    ) : null}
                    {band.calcLow > 0 ? (
                      <span
                        className="bg-amber-400"
                        style={{ width: `${(band.calcLow / band.total) * 100}%` }}
                        title={`Факт выше: ${band.calcLow}`}
                      />
                    ) : null}
                    {band.calcHigh > 0 ? (
                      <span
                        className="bg-violet-400"
                        style={{ width: `${(band.calcHigh / band.total) * 100}%` }}
                        title={`Расчёт выше: ${band.calcHigh}`}
                      />
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-800">Частые причины расхождений</h3>
          {data.topReasons.length === 0 ? (
            <p className="mt-3 text-sm text-emerald-700">Явных причин нет — расхождения в пределах нормы.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.topReasons.slice(0, 8).map(({ reason, count }) => (
                <li key={reason} className="flex items-center gap-3 text-xs">
                  <span className="min-w-0 flex-1 text-slate-700">{reason}</span>
                  <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-800">
                    {count}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.closeMatches.length > 0 ? (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-emerald-800">Эталонные совпадения</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.closeMatches.slice(0, 6).map(({ row, cmp }) => (
                  <button
                    key={row.nmId}
                    type="button"
                    className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-2 py-1 text-[11px] text-emerald-900 hover:border-emerald-200"
                    onClick={() => onSelectRow?.(row)}
                  >
                    {row.vendorCode}: {fmtMoney(cmp.actual)} ≈ {fmtMoney(cmp.calc)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <section className="panel !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  filter === f.id
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <select
            className="input w-auto py-1 text-xs"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            className="input ml-auto w-48 py-1 text-xs"
            placeholder="Поиск артикула…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="text-xs text-slate-500">{filtered.length} строк</span>
        </div>

        <div className="table-scroll max-h-[calc(100vh-320px)] overflow-auto">
          <table className="min-w-max w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Артикул</th>
                <th className="px-3 py-2 font-medium">Объём</th>
                <th className="px-3 py-2 font-medium">Прямая</th>
                <th className="px-3 py-2 font-medium">Обратная</th>
                <th className="px-3 py-2 font-medium">Факт ₽</th>
                <th className="px-3 py-2 font-medium">Расчёт ₽</th>
                <th className="px-3 py-2 font-medium">Δ</th>
                <th className="px-3 py-2 font-medium">Выкуп</th>
                <th className="px-3 py-2 font-medium">Прод.</th>
                <th className="px-3 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ row, cmp }) => {
                const isOpen = expanded === row.nmId;
                const vol =
                  row.volumeLiters != null
                    ? row.subLiterTariff != null
                      ? `${fmtNum(row.volumeLiters, 2)} → ${row.subLiterTariff}₽`
                      : fmtNum(row.volumeLiters, 2)
                    : '—';

                return (
                  <Fragment key={row.nmId}>
                    <tr
                      className={`border-t border-slate-100 hover:bg-slate-50/80 ${
                        cmp.match !== 'ok' ? 'bg-amber-50/20' : ''
                      }`}
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="font-medium text-brand-700 hover:underline"
                          onClick={() => onSelectRow?.(row)}
                        >
                          {row.vendorCode}
                        </button>
                        {row.title ? (
                          <p className="max-w-[140px] truncate text-[10px] text-slate-500">{row.title}</p>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">{vol}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                        {fmtMoney(cmp.forwardCalc)}
                        {cmp.forwardPerSale != null ? (
                          <span className="text-slate-400"> / {fmtMoney(cmp.forwardPerSale)}</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                        {fmtMoney(cmp.returnCalc)}
                        {cmp.returnPerSale != null ? (
                          <span className="text-slate-400"> / {fmtMoney(cmp.returnPerSale)}</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold tabular-nums text-slate-900">
                        {fmtMoney(cmp.actual)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtMoney(cmp.calc)}</td>
                      <td className="px-3 py-2">
                        <DeltaBar deltaPct={cmp.deltaPct} match={cmp.match} />
                        <span className="text-[10px] text-slate-400">{fmtMoney(cmp.deltaRub)}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {row.buyoutFromReport ? fmtPct(cmp.buyout) : '100%*'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">
                        {cmp.sales || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <MatchBadge match={cmp.match} />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-slate-400 hover:text-brand-600"
                          title="Разбор формулы"
                          onClick={() => setExpanded(isOpen ? null : row.nmId)}
                        >
                          {isOpen ? '▲' : '▼'}
                        </button>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td colSpan={11} className="p-0">
                          <FormulaBreakdown row={row} cmp={cmp} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          * 100% — нет продаж в отчёте, для расчёта логистики без невыкупа. Прямая/обратная: расчёт / факт
          на продажу. Клик по артикулу — перейти в таблицу расчётов.
        </p>
      </section>
    </div>
  );
}
