/** Подсказки к метрикам планировщика — формулы из wb-region-supply-plan.js */

import { useEffect, useId, useRef, useState } from 'react';

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

/** Подсказки к блоку «Стратегия поставок» — логика из region-supply-recommendations.js */
export const STRATEGY_HINTS = {
  localizationIndex:
    'ИЛ (индекс локализации) — множитель к литровой логистике FBO. ×1.0 без надбавки; выше — доплата за нелокальные заказы (Ктр по таблице WB).',
  irp:
    'ИРП (индекс распределения продаж) — процент от цены товара за низкую долю локальных заказов. Снижается при отгрузке ближе к покупателям.',
  currentWarehouse:
    'Склад WB, на который чаще всего отгружаются ваши SKU в таблице. От него считается текущая логистика с учётом ИЛ и ИРП.',
  target:
    'Оценка ИЛ и ИРП после отгрузки на рекомендованные региональные склады (топ регионов спроса).',
  potential:
    'Разница в ₽/ед. между текущими штрафами ИЛ/ИРП и оценкой после улучшения локализации.',
};

export function HintIcon({ text, className = '', variant = 'light', placement = 'bottom' }) {
  const [visible, setVisible] = useState(false);
  const wrapRef = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!visible) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setVisible(false);
      }
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [visible]);

  if (!text) return null;

  const isDark = variant === 'onDark';
  const btnCls = isDark
    ? 'border-white/40 text-white/70 hover:border-white/60 hover:text-white'
    : 'border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600';

  const tipCls =
    placement === 'top'
      ? 'bottom-full left-1/2 mb-1.5 -translate-x-1/2'
      : 'top-full left-1/2 mt-1.5 -translate-x-1/2';

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex align-middle ${className}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <button
        type="button"
        className={`inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border text-[9px] font-bold leading-none focus:outline-none focus:ring-1 focus:ring-brand-400 ${btnCls}`}
        aria-label="Показать подсказку"
        aria-describedby={visible ? id : undefined}
        aria-expanded={visible}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setVisible((v) => !v);
        }}
      >
        ?
      </button>
      {visible ? (
        <span
          id={id}
          role="tooltip"
          className={`absolute z-[100] w-56 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-slate-600 shadow-lg ${tipCls}`}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

export function ThHint({ children, hint, className = '' }) {
  return (
    <th className={`px-4 py-2 font-medium ${className}`}>
      <span className="inline-flex items-center gap-0.5">
        {children}
        {hint ? <HintIcon text={hint} placement="bottom" className="ml-0.5" /> : null}
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
      <HintIcon text={hint} className="mt-0.5 shrink-0" />
      <span>{hint}</span>
    </p>
  );
}
