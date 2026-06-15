import { fmtMoney, fmtNum, fmtPct } from '../lib/format';

function IndexGauge({ label, value, suffix, sub, tone = 'brand' }) {
  const tones = {
    brand: 'from-brand-500 to-brand-600',
    amber: 'from-amber-500 to-orange-500',
    emerald: 'from-emerald-500 to-teal-500',
  };
  return (
    <div className="rounded-2xl border border-white/60 bg-white/80 p-4 shadow-sm backdrop-blur">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
        {value}
        {suffix ? <span className="ml-1 text-base font-semibold text-slate-500">{suffix}</span> : null}
      </p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full bg-gradient-to-r ${tones[tone]}`} style={{ width: '72%' }} />
      </div>
    </div>
  );
}

function VerdictBadge({ verdict }) {
  if (verdict === 'recommend') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
        Рекомендуем
      </span>
    );
  }
  if (verdict === 'index_first') {
    return (
      <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
        ИЛ/ИРП важнее
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-800">
      Не выгодно
    </span>
  );
}

function WarehouseBadge({ coeff }) {
  const n = Number(coeff) || 0;
  let cls = 'bg-slate-100 text-slate-700';
  if (n > 0 && n <= 1.4) cls = 'bg-emerald-100 text-emerald-800';
  else if (n > 1.4 && n <= 1.9) cls = 'bg-amber-100 text-amber-800';
  else if (n > 1.9) cls = 'bg-rose-100 text-rose-800';
  return (
    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${cls}`}>
      коэфф. {n.toFixed(2)}
    </span>
  );
}

function ActionCard({ action, rank }) {
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:border-brand-200 hover:shadow-md">
      <div className="absolute right-3 top-3 text-4xl font-black text-slate-100 transition group-hover:text-brand-50">
        {rank}
      </div>
      <div className="relative flex flex-wrap items-center gap-2">
        <VerdictBadge verdict={action.verdict} />
        {action.isLocal ? (
          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
            локальный ФО
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
            нелокально
          </span>
        )}
        <WarehouseBadge coeff={action.warehouseCoeff} />
      </div>

      <h3 className="relative mt-3 text-sm font-semibold text-slate-900">
        {action.regionLabel}
        <span className="font-normal text-slate-500"> · {fmtPct(action.sharePct)} спроса</span>
      </h3>

      <p className="relative mt-2 text-sm leading-relaxed text-slate-600">{action.reason}</p>

      <div className="relative mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Куда везти</p>
          <p className="mt-0.5 text-sm font-semibold text-brand-700">{action.warehouseName}</p>
          <p className="text-[11px] text-slate-500">~{fmtNum(action.demandQty, 0)} заказов/мес</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Логистика с ИЛ/ИРП</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-800">
            {fmtMoney(action.costPerUnit)}/ед.
          </p>
          {action.projectedIl ? (
            <p className="text-[11px] text-slate-500">
              ИЛ → ×{action.projectedIl}
              {action.projectedIrp != null ? ` · ИРП → ${action.projectedIrp}%` : ''}
            </p>
          ) : null}
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Альтернатива</p>
          <p className="mt-0.5 text-sm font-medium text-slate-700">{action.altWarehouseName || '—'}</p>
          <p className="text-[11px] text-slate-500">
            {action.altCostPerUnit != null ? `${fmtMoney(action.altCostPerUnit)}/ед.` : '—'}
            {action.savingsPerUnit > 0 ? (
              <span className="text-emerald-700"> · −{fmtMoney(action.savingsPerUnit)}</span>
            ) : null}
          </p>
        </div>
      </div>
    </article>
  );
}

export default function RegionRecommendations({ plan }) {
  if (!plan?.indices) return null;

  const { indices, actions, supplyPlan, profile, currentWarehouse, currentCostPerUnit, hasTariffs } = plan;

  return (
    <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-2xl border border-brand-200/60 bg-gradient-to-br from-brand-600 via-brand-700 to-slate-900 p-5 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-100">
              Стратегия поставок
            </p>
            <h2 className="mt-1 text-xl font-bold leading-snug">
              Куда везти товар с учётом коэфф. складов, ИЛ и ИРП
            </h2>
            <p className="mt-2 text-sm text-brand-100/90">
              Сравниваем не только тариф склада, но и надбавки WB за нелокальные продажи. Иногда
              дешевле улучшить ИЛ/ИРП, чем грузить на склад с высоким коэффициентом.
            </p>
          </div>
          {indices.targetSavingsPerUnit > 0 ? (
            <div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
              <p className="text-[11px] uppercase tracking-wide text-brand-100">Потенциал</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                −{fmtMoney(indices.targetSavingsPerUnit)}
                <span className="text-sm font-medium text-brand-100">/ед.</span>
              </p>
              <p className="text-xs text-brand-100/80">
                ≈ {fmtMoney(indices.targetSavingsMonthly)}/мес при {fmtNum(profile?.volumeLiters, 2)} л
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <IndexGauge
            label="Индекс локализации"
            value={`×${indices.localizationIndex.toFixed(2)}`}
            sub={
              indices.avgLocalizationSharePct != null
                ? `~${indices.avgLocalizationSharePct.toFixed(0)}% локальных заказов`
                : 'Цель: ×1.0–1.1'
            }
            tone={indices.localizationIndex > 1.1 ? 'amber' : 'emerald'}
          />
          <IndexGauge
            label="ИРП"
            value={`${(indices.salesDistributionIndex * 100).toFixed(2)}%`}
            sub={`≈ ${fmtMoney(indices.indexCostPerUnit - (indices.targetSavingsPerUnit || 0))} только индексы`}
            tone={indices.salesDistributionIndex > 0.018 ? 'amber' : 'emerald'}
          />
          <IndexGauge
            label="Текущий склад"
            value={currentWarehouse || 'не указан'}
            suffix=""
            sub={
              currentCostPerUnit != null
                ? `~${fmtMoney(currentCostPerUnit)}/ед. с ИЛ/ИРП`
                : `тип. коэфф. ${profile?.currentWarehouseCoeff?.toFixed(2)}`
            }
            tone="brand"
          />
          <IndexGauge
            label="Цель после раскладки"
            value={`×${indices.targetIl}`}
            suffix={` · ${indices.targetIrpPct}%`}
            sub="Оценка при покрытии топ-регионов"
            tone="emerald"
          />
        </div>
      </section>

      {indices.tips?.length ? (
        <section className="grid gap-3 md:grid-cols-2">
          {indices.tips.map((tip) => (
            <div
              key={tip.id}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <p className="text-sm font-semibold text-slate-800">{tip.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{tip.body}</p>
              {tip.impactPerUnit > 0 ? (
                <p className="mt-2 text-xs font-medium text-emerald-700">
                  Эффект: до {fmtMoney(tip.impactPerUnit)}/ед.
                </p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {actions.length ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Рекомендации по регионам</h3>
              <p className="text-xs text-slate-500">
                Учтены коэфф. склада, локальность ФО и влияние на ИЛ/ИРП
              </p>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {actions.map((action, index) => (
              <ActionCard key={action.id} action={action} rank={index + 1} />
            ))}
          </div>
        </section>
      ) : null}

      {supplyPlan.length ? (
        <section className="panel overflow-hidden p-0">
          <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-800">План поставок по складам</h3>
            <p className="text-xs text-slate-500">
              Суммарный спрос по регионам · ориентир на 30 дней
              {!hasTariffs ? ' · тарифы WB из кэша, обновите синхронизацию для точности' : ''}
            </p>
          </div>
          <div className="overflow-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-white text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Склад WB</th>
                  <th className="px-4 py-2 font-medium">Коэфф.</th>
                  <th className="px-4 py-2 font-medium">Заказы</th>
                  <th className="px-4 py-2 font-medium">Доля плана</th>
                  <th className="px-4 py-2 font-medium">₽/ед.</th>
                  <th className="px-4 py-2 font-medium">Регионы</th>
                  <th className="px-4 py-2 font-medium">Оценка</th>
                </tr>
              </thead>
              <tbody>
                {supplyPlan.map((row) => (
                  <tr key={row.warehouseName} className="border-t border-slate-100 hover:bg-brand-50/30">
                    <td className="px-4 py-3 font-semibold text-slate-800">{row.warehouseName}</td>
                    <td className="px-4 py-3">
                      <WarehouseBadge coeff={row.warehouseCoeff} />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">{fmtNum(row.totalQty, 0)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{fmtPct(row.sharePct)}</td>
                    <td className="px-4 py-3 tabular-nums font-medium text-slate-800">
                      {fmtMoney(row.costPerUnit)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.regions
                        .slice(0, 3)
                        .map((r) => r.label)
                        .join(', ')}
                      {row.regions.length > 3 ? ` +${row.regions.length - 3}` : ''}
                    </td>
                    <td className="px-4 py-3">
                      {row.badge === 'best' ? (
                        <span className="text-emerald-700 font-medium">Оптимально</span>
                      ) : row.badge === 'expensive' ? (
                        <span className="text-rose-700 font-medium">Дорогой коэфф.</span>
                      ) : (
                        <span className="text-slate-600">Баланс</span>
                      )}
                    </td>
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
