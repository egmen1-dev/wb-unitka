/** Подсказки к метрикам планировщика — формулы из wb-region-supply-plan.js */

export const PLANNER_HINTS = {
  kpi: {
    atRiskOrders:
      'Заказы в регионах, где нет остатка FBO в ФО спроса — уходят нелокально и увеличивают ИЛ/ИРП.',
    lostRevenue:
      'Оценка retail под риском: средний чек по строке отчёта × заказы под риском.',
    indexPenalty:
      'Сумма штрафов ИЛ (прямая логистика × (Ктр−1)) и ИРП (цена × Крп) по заказам без локального остатка.',
    localizationIndex:
      'Текущий индекс локализации кабинета (ИЛ). Чем выше — тем дороже логистика FBO.',
    shipTotal:
      'Сумма рекомендуемых отгрузок по всем SKU×складам (см. вкладку «Отгрузить»).',
    topImprove:
      'Сумма потенциала ИЛ % по топ-20 строкам SKU×регион при локальной отгрузке.',
  },
  tabs: {
    ilImpact:
      'Вклад SKU×регион в ИЛ кабинета: доля заказов × Ктр / ИЛ. Потенциал — снижение ИЛ при отгрузке на рекомендованный склад.',
    shortage:
      'Позиции без локального остатка в ФО спроса: заказы под риском, потерянный retail и штрафы ИЛ/ИРП.',
    ship:
      'Сколько отгрузить на склад WB: спрос + буфер 15% (мин. 2 шт.) минус остаток на целевом складе. Приоритет — по влиянию на ИЛ.',
  },
  columns: {
    ilImpactPct: 'Доля заказов региона × Ктр текущий / ИЛ кабинета × 100%.',
    ilImprovePct:
      'Доля × (Ктр до − Ктр после локализации) / ИЛ × 100% — оценка улучшения при отгрузке в ФО.',
    targetWarehouse: 'Склад из плана поставок или подсказка тарифов WB для региона спроса.',
    localStock: 'Остаток FBO на складах в федеральном округе спроса.',
    sharePct: 'Доля заказов региона от всех заказов кабинета за период.',
    atRiskOrders: 'Заказы в регионе при отсутствии остатка в ФО спроса.',
    lostRevenue: 'Средний retail на заказ × заказы под риском.',
    ilPenalty: 'Прямая логистика × (Ктр−1) × заказы под риском.',
    irpPenalty: 'Цена товара × Крп(доля локализации) × заказы под риском.',
    totalPenalty: 'Итого штраф ИЛ + штраф ИРП за период по строке.',
    reason: 'Нет остатка FBO вообще или только в других ФО.',
    demandQty: 'Заказы в регионе спроса (без локального остатка в ФО).',
    currentStock: 'Текущий остаток FBO на целевом складе WB.',
    shipQty: 'Спрос + буфер (15%, мин. 2 шт.) − остаток на складе.',
    warehouse: 'Склад WB для отгрузки по рекомендации плана.',
    regionsCount: 'Число регионов спроса по артикулу.',
    warehousesCount: 'Число складов отгрузки по артикулу.',
  },
};

export function HintIcon({ text, className = '' }) {
  if (!text) return null;
  return (
    <span
      className={`ml-1 inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-slate-300 text-[9px] font-bold leading-none text-slate-400 hover:border-slate-400 hover:text-slate-600 ${className}`}
      title={text}
      aria-label={text}
      role="img"
    >
      ?
    </span>
  );
}

export function ThHint({ children, hint, className = '' }) {
  return (
    <th className={`px-4 py-2 font-medium ${className}`} title={hint || undefined}>
      <span className="inline-flex items-center gap-0.5">
        {children}
        {hint ? <HintIcon text={hint} className="ml-0.5" /> : null}
      </span>
    </th>
  );
}

export function KpiWithHint({ label, hint, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
      <p className="inline-flex items-center text-xs text-slate-500">
        {label}
        {hint ? <HintIcon text={hint} /> : null}
      </p>
      <p className="mt-1 text-xl font-bold tabular-nums text-slate-800">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

export function TabDescription({ hint }) {
  if (!hint) return null;
  return (
    <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
      <HintIcon text={hint} className="mt-0.5" />
      <span>{hint}</span>
    </p>
  );
}
