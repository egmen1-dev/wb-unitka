import { useMemo, useState } from 'react';
import { fmtMoney, fmtPct, profitClass } from '../lib/format';
import { buildLogisticsReconciliation } from '@lib/logistics-compare.js';
import { primaryMargin, primaryProfit, resolveScheme, schemeLabel } from '@lib/unit-scheme.js';
import {
  MARGIN_BUCKETS,
  buildMarginBucketStats,
  diagnoseRow,
  topRiskRows,
} from '../lib/margin-insights';

export default function SummaryDashboard({ rows, settings, meta, marginFilter, onMarginFilter, onSelectRow, onOpenLogistics }) {
  const [open, setOpen] = useState(true);
  const scheme = resolveScheme(settings);
  const label = schemeLabel(scheme);

  const stats = useMemo(() => {
    const withData = rows.filter((r) => r.salePrice > 0 && primaryProfit(r, scheme) != null);
    const withPurchase = withData.filter((r) => r.purchasePrice > 0);
    const profitable = withPurchase.filter((r) => primaryProfit(r, scheme) > 0);
    const unprofitable = withPurchase.filter((r) => primaryProfit(r, scheme) < 0);
    const lowMargin = withPurchase.filter(
      (r) => primaryMargin(r, scheme) != null && primaryMargin(r, scheme) < 0.05
    );

    const sumProfit = withPurchase.reduce((s, r) => s + primaryProfit(r, scheme), 0);
    const avgMargin =
      withPurchase.length > 0
        ? withPurchase.reduce((s, r) => s + primaryMargin(r, scheme), 0) / withPurchase.length
        : null;

    const missingPurchase = rows.filter((r) => !r.purchasePrice).length;
    const bucketStats = buildMarginBucketStats(rows, scheme);
    const risks = topRiskRows(rows, 8, scheme);
    const logisticsBrief = buildLogisticsReconciliation(rows, settings);

    return {
      total: rows.length,
      withPurchase: withPurchase.length,
      profitable: profitable.length,
      unprofitable: unprofitable.length,
      lowMargin: lowMargin.length,
      sumProfit,
      avgMargin,
      missingPurchase,
      bucketStats,
      risks,
      logisticsBrief,
    };
  }, [rows, settings, scheme]);

  if (!rows.length) return null;

  function handleBucketClick(bucketId) {
    onMarginFilter?.(marginFilter === bucketId ? null : bucketId);
  }

  return (
    <section className="panel py-3">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="font-semibold text-slate-800">Сводка · {label}</span>
          <span className="text-slate-600">
            {stats.withPurchase} с закупкой · прибыль {fmtMoney(stats.sumProfit)} · маржа{' '}
            {fmtPct(stats.avgMargin)}
          </span>
          <span className="text-emerald-700">+{stats.profitable}</span>
          <span className="text-rose-700">−{stats.unprofitable}</span>
          {stats.lowMargin > 0 ? (
            <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-800 ring-1 ring-rose-200">
              &lt;5% маржи: {stats.lowMargin}
            </span>
          ) : null}
          {stats.missingPurchase > 0 ? (
            <span className="text-amber-700">без закупки: {stats.missingPurchase}</span>
          ) : null}
          {stats.logisticsBrief.withActual > 0 ? (
            <button
              type="button"
              className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100"
              onClick={(e) => {
                e.stopPropagation();
                onOpenLogistics?.();
              }}
            >
              логистика: {Math.round(stats.logisticsBrief.okPct * 100)}% сходится →
            </button>
          ) : null}
        </div>
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>

      {open ? (
        <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Товаров', value: stats.total },
              { label: 'С закупкой', value: stats.withPurchase },
              {
                label: `Прибыль ${label} (сумма)`,
                value: fmtMoney(stats.sumProfit),
                className: profitClass(stats.sumProfit),
              },
              { label: `Средняя маржа ${label}`, value: fmtPct(stats.avgMargin) },
            ].map((card) => (
              <div key={card.label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">{card.label}</p>
                <p className={`mt-1 text-lg font-semibold ${card.className || 'text-slate-800'}`}>
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Распределение маржи {label}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Клик по сегменту — фильтр в таблице ниже
                  </p>
                </div>
                <button
                  type="button"
                  className={`text-xs ${marginFilter ? 'text-brand-700 underline' : 'text-slate-400'}`}
                  disabled={!marginFilter}
                  onClick={() => onMarginFilter?.(null)}
                >
                  Сбросить фильтр
                </button>
              </div>

              <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-slate-200">
                {MARGIN_BUCKETS.map((bucket) => {
                  const count = stats.bucketStats.counts[bucket.id] || 0;
                  if (!count) return null;
                  const pct = (count / stats.bucketStats.eligible.length) * 100;
                  return (
                    <button
                      key={bucket.id}
                      type="button"
                      title={`${bucket.label}: ${count}`}
                      className={`h-full transition-opacity hover:opacity-80 ${
                        marginFilter === bucket.id ? 'ring-2 ring-brand-500 ring-offset-1' : ''
                      }`}
                      style={{ width: `${pct}%`, backgroundColor: bucket.color }}
                      onClick={() => handleBucketClick(bucket.id)}
                    />
                  );
                })}
              </div>

              <div className="space-y-2">
                {MARGIN_BUCKETS.map((bucket) => {
                  const count = stats.bucketStats.counts[bucket.id] || 0;
                  const width = (count / stats.bucketStats.max) * 100;
                  const active = marginFilter === bucket.id;

                  return (
                    <button
                      key={bucket.id}
                      type="button"
                      className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition ${
                        active ? 'bg-white ring-1 ring-brand-300' : 'hover:bg-white/70'
                      }`}
                      onClick={() => handleBucketClick(bucket.id)}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: bucket.color }}
                      />
                      <span className="w-24 shrink-0 text-xs text-slate-700">{bucket.label}</span>
                      <span className="w-10 shrink-0 text-xs text-slate-400">{bucket.hint}</span>
                      <span className="relative h-2 min-w-0 flex-1 rounded-full bg-slate-200">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: `${width}%`, backgroundColor: bucket.color }}
                        />
                      </span>
                      <span className="w-8 shrink-0 text-right text-xs font-semibold text-slate-800">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className={`mt-3 w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                  marginFilter === 'attention'
                    ? 'border-rose-300 bg-rose-50 text-rose-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-rose-200'
                }`}
                onClick={() => onMarginFilter?.(marginFilter === 'attention' ? null : 'attention')}
              >
                Показать все позиции с маржой &lt; 5% ({stats.lowMargin})
              </button>
            </div>

            <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-4">
              <h3 className="text-sm font-semibold text-slate-800">Что подправить в первую очередь</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Позиции с маржой {label} ниже 5% — клик откроет строку в таблице
              </p>

              {stats.risks.length === 0 ? (
                <p className="mt-4 text-sm text-emerald-700">
                  Нет позиций с маржой ниже 5% среди товаров с закупкой.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {stats.risks.map((row) => (
                    <li key={row.nmId}>
                      <button
                        type="button"
                        className="w-full rounded-lg border border-slate-100 bg-white px-3 py-2 text-left hover:border-brand-200"
                        onClick={() => onSelectRow?.(row)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {row.vendorCode}
                              {row.title ? (
                                <span className="font-normal text-slate-500"> · {String(row.title).slice(0, 42)}</span>
                              ) : null}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-600">{diagnoseRow(row, settings)}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-xs font-semibold text-rose-800">
                              {fmtPct(primaryMargin(row, scheme))}
                            </p>
                            <p className={`text-[11px] ${profitClass(primaryProfit(row, scheme))}`}>
                              {fmtMoney(primaryProfit(row, scheme))}
                            </p>
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {stats.missingPurchase > 0 ? (
                <p className="mt-3 text-xs text-amber-800">
                  Ещё {stats.missingPurchase} без закупки — расчёт маржи неполный.
                </p>
              ) : null}
            </div>
          </div>

          <p className="text-xs text-slate-500">
            {meta?.globalAcquiringRate
              ? `Эквайринг: ${(meta.globalAcquiringRate * 100).toFixed(2)}%`
              : `Эквайринг: ${(settings.acquiringRate * 100).toFixed(2)}%`}
            {meta?.sellerAvgDeliveryHours
              ? ` · ср. доставка ${Number(meta.sellerAvgDeliveryHours).toFixed(1)} ч`
              : ''}
            {meta?.fbsShipmentWarehouse ? (
              <>
                {' · '}
                FBS склад: <span className="font-medium text-slate-700">{meta.fbsShipmentWarehouse}</span>
                {meta.fbsShipmentOrders > 0
                  ? ` (${meta.fbsShipmentOrders} отгрузок за 30 дн)`
                  : meta.fbsShipmentSource === 'fallback'
                    ? ' (запасной выбор)'
                    : ''}
              </>
            ) : null}
            {meta?.fbsShipmentError ? ` · FBS склады: ${meta.fbsShipmentError}` : ''}
            {' · '}
            {stats.bucketStats.eligible.length} позиций в диаграмме (с закупкой и ценой)
          </p>
        </div>
      ) : null}
    </section>
  );
}
