import { Fragment, useMemo, useState } from 'react';
import { buildFactualPnlReport } from '@lib/factual-pnl.js';
import { fmtMoney, fmtNum, fmtPct, marginClass, profitClass } from '../lib/format';

const FILTERS = [
  { id: 'all', label: 'Все с продажами' },
  { id: 'profit', label: 'В плюсе' },
  { id: 'loss', label: 'В минусе' },
  { id: 'noPurchase', label: 'Без закупки' },
];

const COLUMNS = [
  { key: 'vendorCode', label: 'Артикул', sticky: true },
  { key: 'sales', label: 'Прод.' },
  { key: 'retailSum', label: 'Оплачено', hint: 'Сумма retail покупателей' },
  { key: 'forPayNet', label: 'К перечислению', hint: 'ppvz_for_pay из отчёта WB' },
  { key: 'commissionRub', label: 'Комиссия' },
  { key: 'logisticsRub', label: 'Логистика' },
  { key: 'acquiringRub', label: 'Эквайринг' },
  { key: 'storageRub', label: 'Хранение' },
  { key: 'taxRub', label: 'Налоги', hint: 'УСН + НДС от retail (минус возвраты)' },
  { key: 'cogsRub', label: 'Закупка' },
  { key: 'adRub', label: 'Реклама' },
  { key: 'advertisingDrr', label: 'ДРР', hint: 'Доля рекламы от retail; факт из API Продвижение или оценка по ДРР' },
  { key: 'otherRub', label: 'Прочее', hint: 'Приёмка, обработка, штрафы, удержания' },
  { key: 'profitRub', label: 'Прибыль', sortable: true },
  { key: 'marginPct', label: 'Маржа' },
];

function Kpi({ label, value, sub, className = '' }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-white to-slate-50 px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${className || 'text-slate-900'}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

function CostBar({ breakdown, totalRetail }) {
  const positiveItems = breakdown.filter((x) => x.rub > 0);
  const compensation = breakdown.filter((x) => x.rub < 0);
  if (!positiveItems.length || totalRetail <= 0) return null;
  const totalCosts = positiveItems.reduce((s, x) => s + x.rub, 0);
  const adItem = positiveItems.find((x) => x.key === 'ad');
  return (
    <div className="space-y-3">
      {adItem?.drrPct != null ? (
        <p className="text-xs text-slate-600">
          Средний <span className="font-semibold text-pink-700">ДРР {fmtPct(adItem.drrPct)}</span> от retail
          {adItem.rub > 0 ? ` · реклама ${fmtMoney(adItem.rub)}` : ''}
        </p>
      ) : null}
      <div className="flex h-4 overflow-hidden rounded-full bg-slate-100 shadow-inner">
        {positiveItems.map((item) => (
          <div
            key={item.key}
            className="h-full transition-all"
            style={{
              width: `${Math.max(0.5, (item.rub / totalCosts) * 100)}%`,
              backgroundColor: item.color,
            }}
            title={`${item.label}: ${fmtMoney(item.rub)}`}
          />
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {positiveItems.map((item) => (
          <div key={item.key} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="flex-1 text-slate-600">{item.label}</span>
            <span className="font-semibold tabular-nums text-slate-800">{fmtMoney(item.rub)}</span>
            <span className="text-slate-400">
              {item.key === 'ad' && item.drrPct != null ? `${fmtPct(item.drrPct)} · ` : ''}
              {((item.rub / totalRetail) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
        {compensation.map((item) => (
          <div key={item.key} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="flex-1 text-slate-600">{item.label}</span>
            <span className="font-semibold tabular-nums text-emerald-700">{fmtMoney(Math.abs(item.rub))}</span>
            <span className="text-emerald-600">+{((Math.abs(item.rub) / totalRetail) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function exportCsv(items) {
  const header = COLUMNS.map((c) => c.label).join(';');
  const lines = items.map(({ pnl }) =>
    [
      pnl.vendorCode,
      pnl.sales,
      pnl.retailSum.toFixed(0),
      pnl.forPayNet.toFixed(0),
      pnl.commissionRub.toFixed(0),
      pnl.logisticsRub.toFixed(0),
      pnl.acquiringRub.toFixed(0),
      pnl.storageRub.toFixed(0),
      pnl.taxRub.toFixed(0),
      pnl.cogsRub.toFixed(0),
      pnl.adRub.toFixed(0),
      pnl.advertisingDrr != null ? (pnl.advertisingDrr * 100).toFixed(1) : '',
      (
        pnl.acceptanceRub +
        pnl.processingRub +
        pnl.penaltyRub +
        pnl.deductionRub -
        pnl.additionalPaymentRub
      ).toFixed(0),
      pnl.profitRub.toFixed(0),
      pnl.marginPct != null ? (pnl.marginPct * 100).toFixed(1) : '',
    ].join(';')
  );
  const blob = new Blob(['\uFEFF' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `factual-pnl-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ActualPnlPanel({ rows, settings, meta, syncActive = false, onSelectRow }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(null);

  const report = useMemo(() => buildFactualPnlReport(rows, settings, meta), [rows, settings, meta]);
  const taxPct = ((settings.taxRate ?? 0.06) * 100).toFixed(0);
  const vatPct = ((settings.vatRate ?? 0.05) * 100).toFixed(0);
  const taxLabel =
    settings.includeVat !== false && Number(settings.vatRate) > 0
      ? `УСН ${taxPct}% + НДС ${vatPct}%`
      : `УСН ${taxPct}%`;

  const filtered = useMemo(() => {
    let list = report.items;
    if (filter === 'profit') list = list.filter((x) => x.pnl.profitRub > 0);
    if (filter === 'loss') list = list.filter((x) => x.pnl.profitRub < 0);
    if (filter === 'noPurchase') list = list.filter((x) => !x.pnl.hasPurchase);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (x) =>
          String(x.pnl.vendorCode).toLowerCase().includes(q) ||
          String(x.row.title || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [report.items, filter, query]);

  const period = meta?.realizationPeriod
    ? `${meta.realizationPeriod.dateFrom} — ${meta.realizationPeriod.dateTo}`
    : null;

  const rowsWithReportSales = useMemo(() => {
    const vendorSales = meta?.realizationVendorSales;
    return rows.filter((row) => {
      if (Number(row.reportSales) > 0) return true;
      if (!vendorSales || !row.vendorCode) return false;
      for (const key of [row.vendorCode, `${row.vendorCode}.0`, String(row.vendorCode).replace(/\.0$/, '')]) {
        if (vendorSales[key]?.sales > 0) return true;
      }
      return false;
    }).length;
  }, [rows, meta?.realizationVendorSales]);

  if (!rows.length) {
    return (
      <section className="panel py-12 text-center">
        <p className="text-sm font-medium text-slate-700">Нет данных</p>
        <p className="mt-2 text-sm text-slate-500">Синхронизируйте каталог и загрузите закупочные цены.</p>
      </section>
    );
  }

  if (report.items.length === 0) {
    const reportPending =
      syncActive ||
      meta?.realizationLoaded === false ||
      meta?.syncMode === 'bootstrap';
    const reportAttempted =
      meta?.realizationLoaded === true ||
      meta?.realizationError ||
      meta?.realizationPeriod ||
      meta?.realizationRowCount > 0;

    return (
      <section className="panel">
        <h2 className="text-lg font-semibold text-slate-900">Факт · P&L по артикулам</h2>
        {meta?.realizationError ? (
          <p className="mt-2 text-sm text-rose-800">{meta.realizationError}</p>
        ) : meta?.realizationFinanceWarning ? (
          <p className="mt-2 text-sm text-amber-800">
            Finance API недоступен — данные из Statistics (legacy). Добавьте категорию{' '}
            <strong>Finance</strong> в токен для еженедельных отчётов как в ЛК.
          </p>
        ) : reportPending ? (
          <p className="mt-2 text-sm text-amber-900">
            {syncActive
              ? 'Загружаем еженедельный отчёт реализации WB — обычно 30–90 сек…'
              : 'Отчёт реализации ещё не загружен — нажмите «Быстро» в шапке или дождитесь автозагрузки.'}{' '}
            Токен WB: категории <strong>Finance</strong> (основной) и <strong>Statistics</strong> (запасной).
          </p>
        ) : period ? (
          meta?.realizationCatalogMismatch ? (
            <p className="mt-2 text-sm text-amber-900">
              Отчёт реализации ({meta.realizationTotalSales} продаж) не совпадает с каталогом — вероятно,
              каталог загружен от другого API-ключа или устарел. Нажмите <strong>«Полностью»</strong> в шапке,
              чтобы перечитать карточки с текущим токеном.
            </p>
          ) : meta?.realizationCatalogVendorInReport > 0 &&
            meta?.realizationCatalogVendorWithSales === 0 ? (
            <p className="mt-2 text-sm text-amber-900">
              За {period} ваши артикулы есть в отчёте WB, но без строк «Продажа» — только логистика,
              хранение или возвраты. Продаж за период: 0.
            </p>
          ) : (
            <p className="mt-2 text-sm text-amber-900">
              За {period} нет продаж по артикулам из каталога
              {meta?.realizationTotalSales > 0
                ? ` (в отчёте ${meta.realizationTotalSales} продаж по другим товарам кабинета)`
                : meta?.realizationRowCount > 0
                  ? ' (отчёт есть, но без продаж — только логистика/хранение)'
                  : ''}
              .
            </p>
          )
        ) : reportAttempted ? (
          <p className="mt-2 text-sm text-amber-900">
            Отчёт реализации пуст за последние 30 дней или нет доступа по токену. Проверьте категории{' '}
            <strong>Finance</strong> и <strong>Statistics</strong> в{' '}
            <a
              className="underline"
              href="https://seller.wildberries.ru/supplier-settings/access-to-api"
              target="_blank"
              rel="noreferrer"
            >
              настройках API WB
            </a>
            .
          </p>
        ) : (
          <p className="mt-2 text-sm text-amber-900">
            Нет данных отчёта реализации. Нажмите «Быстро» — токен должен включать{' '}
            <strong>Finance</strong> и/или <strong>Statistics</strong>.
          </p>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Источник:{' '}
          {meta?.realizationSource === 'finance-weekly'
            ? 'Finance API · еженедельные отчёты (как в ЛК «Отчёты реализации»)'
            : meta?.realizationSource === 'statistics-v5'
              ? 'Statistics API · reportDetailByPeriod (legacy)'
              : 'отчёт реализации WB'}
          {meta?.realizationSource === 'finance-weekly' ? null : (
            <>
              {' · '}
              для полных данных добавьте категорию <strong>Finance</strong> в токен
            </>
          )}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          В каталоге {rows.length} SKU · с продажами в отчёте: {rowsWithReportSales}
          {meta?.realizationCatalogVendorWithSales > 0 &&
          meta?.realizationCatalogNmWithSales !== meta?.realizationCatalogVendorWithSales
            ? ` (по артикулу: ${meta.realizationCatalogVendorWithSales})`
            : ''}
          {meta?.realizationRowCount != null ? ` · строк отчёта: ${meta.realizationRowCount}` : ''}
          {meta?.realizationTotalSales != null ? ` · продаж в отчёте: ${meta.realizationTotalSales}` : ''}
          {meta?.realizationCatalogNmInReport != null
            ? ` · совпадений nmId: ${meta.realizationCatalogNmInReport}/${rows.length}`
            : ''}
          {meta?.catalogPricesOverlapPct != null
            ? ` · каталог↔Prices: ${Math.round(meta.catalogPricesOverlapPct * 100)}%`
            : ''}
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="panel overflow-hidden border-brand-100 bg-gradient-to-br from-brand-50/40 via-white to-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Факт · P&L</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">Сколько заработали по отчёту WB</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              {period || 'период отчёта WB'} · {report.totals.skuCount} артикулов ·{' '}
              {fmtNum(report.totals.sales, 0)} продаж
              {meta?.realizationSource === 'finance-weekly' ? ' · еженедельный отчёт WB' : ''}.
              {taxLabel} от retail (минус возвраты). Реклама — факт из Продвижения или ДРР × retail.
              {report.totals.adFromFactCount > 0
                ? ` · факт ДРР: ${report.totals.adFromFactCount} арт.`
                : ''}
              {report.totals.adEstimatedCount > 0
                ? ` · оценка ДРР: ${report.totals.adEstimatedCount} арт.`
                : ''}
              {report.totals.adAllocatedCount > 0
                ? ` · распределено по retail: ${report.totals.adAllocatedCount} арт.`
                : ''}
            </p>
            {meta?.advertError ? (
              <p className="mt-2 text-sm text-amber-900">
                {meta.advertError} — колонка ДРР может быть пустой. Добавьте категорию{' '}
                <strong>Продвижение</strong> в токен WB или задайте «ДРР по умолчанию» в настройках.
              </p>
            ) : report.totals.withDrrCount === 0 && settings.includeAdvertising !== false ? (
              <p className="mt-2 text-sm text-amber-900">
                Нет данных рекламы — нажмите «Быстро» (нужен токен с категорией{' '}
                <strong>Продвижение</strong>) или задайте «ДРР по умолчанию» в настройках.
                {meta?.totalAdSpend > 0
                  ? ` В кабинете реклама ${fmtMoney(meta.totalAdSpend)} — после синхронизации распределим по артикулам.`
                  : ''}
              </p>
            ) : null}
          </div>
          <button type="button" className="btn-secondary" onClick={() => exportCsv(filtered)}>
            Экспорт CSV
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi
            label="Выручка (retail)"
            value={fmtMoney(report.totals.retailSum)}
            sub={`${fmtNum(report.totals.sales, 0)} шт.`}
          />
          <Kpi
            label="ДРР · реклама"
            value={report.totals.advertisingDrr != null ? fmtPct(report.totals.advertisingDrr) : '—'}
            sub={
              report.totals.adRub > 0
                ? `${fmtMoney(report.totals.adRub)} за период`
                : meta?.totalAdSpend > 0
                  ? `${fmtMoney(meta.totalAdSpend)} в кабинете`
                  : 'нет данных — «Быстро»'
            }
            className={report.totals.advertisingDrr != null ? 'text-pink-700' : 'text-slate-500'}
          />
          <Kpi
            label="К перечислению WB"
            value={fmtMoney(report.totals.forPayNet)}
            sub="ppvz_for_pay − возвраты"
          />
          <Kpi
            label="Чистая прибыль"
            value={fmtMoney(report.totals.profitRub)}
            sub={
              report.totals.profitPerUnit != null
                ? `${fmtMoney(report.totals.profitPerUnit)} / шт. · маржа ${fmtPct(report.totals.marginPct)}`
                : undefined
            }
            className={profitClass(report.totals.profitRub)}
          />
          <Kpi
            label="Без закупки"
            value={report.totals.withoutPurchase}
            sub={`из ${report.totals.skuCount} — прибыль неполная`}
            className={report.totals.withoutPurchase > 0 ? 'text-amber-800' : 'text-emerald-700'}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="panel lg:col-span-3">
          <h3 className="text-sm font-semibold text-slate-800">Куда ушли деньги</h3>
          <p className="mt-0.5 text-xs text-slate-500">Доля от retail-выручки за период</p>
          <div className="mt-4">
            <CostBar breakdown={report.costBreakdown} totalRetail={report.totals.retailSum} />
          </div>
        </section>

        <section className="panel lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-800">Лидеры и аутсайдеры</h3>
          <div className="mt-3 space-y-3">
            {report.topProfit.length > 0 ? (
              <div>
                <p className="text-[11px] font-medium uppercase text-emerald-700">Топ прибыли</p>
                <ul className="mt-1 space-y-1">
                  {report.topProfit.map(({ pnl, row }) => (
                    <li key={pnl.nmId}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left text-xs hover:text-brand-700"
                        onClick={() => onSelectRow?.(row)}
                      >
                        <span className="truncate font-medium">{pnl.vendorCode}</span>
                        <span className="shrink-0 font-semibold text-emerald-700">{fmtMoney(pnl.profitRub)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {report.topLoss.length > 0 ? (
              <div>
                <p className="text-[11px] font-medium uppercase text-rose-700">Убытки</p>
                <ul className="mt-1 space-y-1">
                  {report.topLoss.map(({ pnl, row }) => (
                    <li key={pnl.nmId}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left text-xs hover:text-brand-700"
                        onClick={() => onSelectRow?.(row)}
                      >
                        <span className="truncate font-medium">{pnl.vendorCode}</span>
                        <span className="shrink-0 font-semibold text-rose-700">{fmtMoney(pnl.profitRub)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="panel !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                filter === f.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
          <input
            className="input ml-auto w-44 py-1 text-xs"
            placeholder="Поиск…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="text-xs text-slate-500">{filtered.length} строк</span>
        </div>

        <div className="table-scroll max-h-[calc(100vh-280px)] overflow-auto">
          <table className="min-w-max w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-800 text-slate-200">
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`whitespace-nowrap px-3 py-2.5 font-medium ${col.sticky ? 'sticky left-0 z-20 bg-slate-800' : ''}`}
                    title={col.hint}
                  >
                    {col.label}
                  </th>
                ))}
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ row, pnl }) => {
                const isOpen = expanded === pnl.nmId;
                const otherRub =
                  pnl.acceptanceRub +
                  pnl.processingRub +
                  pnl.penaltyRub +
                  pnl.deductionRub -
                  pnl.additionalPaymentRub;
                const cells = {
                  vendorCode: (
                    <button
                      type="button"
                      className="font-semibold text-brand-700 hover:underline"
                      onClick={() => onSelectRow?.(row)}
                    >
                      {pnl.vendorCode}
                    </button>
                  ),
                  sales: fmtNum(pnl.sales, 0),
                  retailSum: fmtMoney(pnl.retailSum),
                  forPayNet: fmtMoney(pnl.forPayNet),
                  commissionRub: fmtMoney(pnl.commissionRub),
                  logisticsRub: fmtMoney(pnl.logisticsRub),
                  acquiringRub: fmtMoney(pnl.acquiringRub),
                  storageRub: pnl.storageRub > 0 ? fmtMoney(pnl.storageRub) : '—',
                  taxRub: fmtMoney(pnl.taxRub),
                  cogsRub: pnl.hasPurchase ? fmtMoney(pnl.cogsRub) : '—',
                  adRub: pnl.adRub > 0 ? fmtMoney(pnl.adRub) : pnl.advertisingDrr != null ? '0 ₽' : '—',
                  advertisingDrr:
                    pnl.advertisingDrr != null ? (
                      <span
                        title={
                          pnl.adAllocated
                            ? 'Распределено пропорционально retail из общего рекламного бюджета кабинета'
                            : pnl.adFromFact
                              ? 'Факт из API Продвижение'
                              : 'Оценка по ДРР артикула, среднему по кабинету или настройке'
                        }
                      >
                        {fmtPct(pnl.advertisingDrr)}
                        {pnl.adAllocated ? '‡' : !pnl.adFromFact ? '*' : ''}
                      </span>
                    ) : (
                      '—'
                    ),
                  otherRub: otherRub !== 0 ? fmtMoney(otherRub) : '—',
                  profitRub: fmtMoney(pnl.profitRub),
                  marginPct: fmtPct(pnl.marginPct),
                };

                return (
                  <Fragment key={pnl.nmId}>
                    <tr
                      className={`border-t border-slate-100 hover:bg-slate-50/80 ${
                        pnl.profitRub < 0 ? 'bg-rose-50/30' : ''
                      }`}
                    >
                      {COLUMNS.map((col) => (
                        <td
                          key={col.key}
                          className={`whitespace-nowrap px-3 py-2 tabular-nums ${
                            col.sticky ? 'sticky left-0 bg-white shadow-[1px_0_0_#e2e8f0]' : ''
                          } ${col.key === 'profitRub' ? profitClass(pnl.profitRub) : ''} ${
                            col.key === 'marginPct' ? marginClass(pnl.marginPct) : 'text-slate-700'
                          } ${col.key === 'cogsRub' && !pnl.hasPurchase ? 'text-amber-600' : ''}`}
                        >
                          {col.key === 'vendorCode' ? (
                            <div>
                              {cells.vendorCode}
                              {row.title ? (
                                <p className="max-w-[120px] truncate text-[10px] font-normal text-slate-400">
                                  {row.title}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            cells[col.key]
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          className="text-slate-400 hover:text-brand-600"
                          onClick={() => setExpanded(isOpen ? null : pnl.nmId)}
                        >
                          {isOpen ? '▲' : '▼'}
                        </button>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="bg-slate-50/80">
                        <td colSpan={COLUMNS.length + 1} className="px-4 py-3 text-xs text-slate-600">
                          <div className="grid gap-2 sm:grid-cols-3">
                            <p>
                              <span className="font-medium text-slate-800">Приёмка:</span>{' '}
                              {fmtMoney(pnl.acceptanceRub)}
                            </p>
                            <p>
                              <span className="font-medium text-slate-800">Обработка:</span>{' '}
                              {fmtMoney(pnl.processingRub)}
                            </p>
                            <p>
                              <span className="font-medium text-slate-800">Штрафы / удержания:</span>{' '}
                              {fmtMoney(pnl.penaltyRub + pnl.deductionRub)}
                            </p>
                            {pnl.additionalPaymentRub > 0 ? (
                              <p>
                                <span className="font-medium text-emerald-800">Компенсации WB:</span>{' '}
                                +{fmtMoney(pnl.additionalPaymentRub)}
                              </p>
                            ) : null}
                            <p>
                              <span className="font-medium text-slate-800">После WB (до закупки, налога, рекламы):</span>{' '}
                              {fmtMoney(pnl.wbNetPayout)}
                            </p>
                            <p>
                              <span className="font-medium text-slate-800">На единицу:</span>{' '}
                              {fmtMoney(pnl.profitPerUnit)}
                            </p>
                            <p>
                              <span className="font-medium text-slate-800">Возвраты:</span> {pnl.returns} шт.
                              {pnl.retailReturnSum > 0 ? ` (−${fmtMoney(pnl.retailReturnSum)} retail)` : ''}
                            </p>
                            <p>
                              <span className="font-medium text-slate-800">Налоги:</span> УСН {fmtMoney(pnl.usnRub)}
                              {pnl.vatRub > 0 ? ` + НДС ${fmtMoney(pnl.vatRub)}` : ''} = {fmtMoney(pnl.taxRub)}
                              {pnl.retailReturnSum > 0 ? (
                                <span className="text-slate-500"> · база {fmtMoney(pnl.taxBase)}</span>
                              ) : null}
                            </p>
                          </div>
                          {!pnl.hasPurchase ? (
                            <p className="mt-2 text-amber-800">Нет закупочной цены — добавьте в таблице расчётов.</p>
                          ) : null}
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
          Прибыль = к перечислению − логистика − хранение − приёмка − обработка − штрафы − удержания + компенсации WB −
          закупка − налоги (УСН + НДС) − реклама. Комиссия и эквайринг уже в «к перечислению». НДС = retail × 5/105.
          {' '}
          ДРР без пометки — факт из Продвижения; * — оценка; ‡ — распределено по retail из общего бюджета кабинета.
        </p>
      </section>
    </div>
  );
}
