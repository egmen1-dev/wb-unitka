import { Fragment, useMemo, useState } from 'react';
import {
  buildRegionSupplyRecommendations,
  formatWarehouseCoeffPercent,
  resolveRegionTariffContext,
} from '@lib/region-supply-recommendations.js';
import { buildRegionSupplyAnalysis } from '@lib/wb-region-supply-plan.js';
import { enrichRegionDemandSnapshot, isFederalDistrictLabel } from '@lib/wb-region-sales.js';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format';
import { regionEmptyMessage, regionSourceLabel } from '../lib/region-empty-message';
import RegionRecommendations from './RegionRecommendations';
import {
  HintIcon,
  KpiWithHint,
  PLANNER_HINTS,
  TabDescription,
  ThHint,
} from './RegionsPlannerHints';

const GEO_VIEWS = [
  { id: 'warehouse', label: 'Склады WB' },
  { id: 'region', label: 'Регионы' },
  { id: 'fo', label: 'Округа' },
  { id: 'city', label: 'Города' },
];

const PLAN_VIEWS = [
  { id: 'il-impact', label: 'Влияние на ИЛ' },
  { id: 'shortage', label: 'Потери' },
  { id: 'ship', label: 'Отгрузить' },
];

const PLAN_SORT_OPTIONS = {
  'il-impact': [
    { id: 'ilImprove', label: 'Потенциал ИЛ' },
    { id: 'ilImpact', label: 'Влияние на ИЛ' },
    { id: 'orders', label: 'Заказы' },
    { id: 'vendor', label: 'Артикул' },
  ],
  shortage: [
    { id: 'penalty', label: 'Штраф' },
    { id: 'orders', label: 'Заказы' },
    { id: 'revenue', label: 'Retail' },
    { id: 'vendor', label: 'Артикул' },
  ],
  ship: [
    { id: 'shipQty', label: 'Отгрузить' },
    { id: 'ilImprove', label: 'Потенциал ИЛ' },
    { id: 'demand', label: 'Спрос' },
    { id: 'vendor', label: 'Артикул' },
  ],
};

const DEFAULT_SORT = {
  'il-impact': 'ilImprove',
  shortage: 'penalty',
  ship: 'shipQty',
};

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

function filterWarehouseLabels(names = []) {
  return names.filter((name) => name && !isFederalDistrictLabel(name));
}

function matchesQuery(row, q, fields) {
  return fields
    .map((f) => row[f])
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function applyPlanRowFilters(rows, { query, regionFilter, warehouseFilter, onlyNoStock, onlyIlPotential, view }) {
  let result = rows;
  const q = query.trim().toLowerCase();
  if (q) {
    result = result.filter((row) =>
      matchesQuery(row, q, [
        'vendorCode',
        'regionLabel',
        'foName',
        'targetWarehouse',
        'warehouseName',
        'reason',
        'nmId',
      ])
    );
  }
  if (regionFilter) {
    result = result.filter((row) => row.regionLabel === regionFilter);
  }
  if (warehouseFilter) {
    if (view === 'ship') {
      result = result.filter((row) => row.warehouseName === warehouseFilter);
    } else {
      result = result.filter((row) => row.targetWarehouse === warehouseFilter);
    }
  }
  if (onlyNoStock && view === 'il-impact') {
    result = result.filter((row) => !row.hasLocalStock);
  }
  if (onlyIlPotential) {
    result = result.filter((row) => (row.ilImprovePct || 0) > 0);
  }
  return result;
}

function groupIlImpactRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.nmId;
    if (!groups.has(key)) {
      groups.set(key, {
        nmId: key,
        vendorCode: row.vendorCode,
        children: [],
        totalOrders: 0,
        ilImpactPct: 0,
        ilImprovePct: 0,
        noStockRegions: 0,
      });
    }
    const g = groups.get(key);
    g.children.push(row);
    g.totalOrders += row.orders || 0;
    g.ilImpactPct += row.ilImpactPct || 0;
    g.ilImprovePct += row.ilImprovePct || 0;
    if (!row.hasLocalStock) g.noStockRegions += 1;
  }
  for (const g of groups.values()) {
    g.regionCount = new Set(g.children.map((c) => c.regionLabel)).size;
    g.children.sort(
      (a, b) =>
        (b.ilImprovePct || 0) - (a.ilImprovePct || 0) || (b.ilImpactPct || 0) - (a.ilImpactPct || 0)
    );
  }
  return [...groups.values()];
}

function groupShortageRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.nmId;
    if (!groups.has(key)) {
      groups.set(key, {
        nmId: key,
        vendorCode: row.vendorCode,
        children: [],
        atRiskOrders: 0,
        lostRevenue: 0,
        ilPenaltyRub: 0,
        irpPenaltyRub: 0,
        totalPenaltyRub: 0,
        ilImprovePct: 0,
      });
    }
    const g = groups.get(key);
    g.children.push(row);
    g.atRiskOrders += row.atRiskOrders || 0;
    g.lostRevenue += row.lostRevenue || 0;
    g.ilPenaltyRub += row.ilPenaltyRub || 0;
    g.irpPenaltyRub += row.irpPenaltyRub || 0;
    g.totalPenaltyRub += row.totalPenaltyRub || 0;
    g.ilImprovePct += row.ilImprovePct || 0;
  }
  for (const g of groups.values()) {
    g.regionCount = g.children.length;
    g.children.sort((a, b) => (b.totalPenaltyRub || 0) - (a.totalPenaltyRub || 0));
  }
  return [...groups.values()];
}

function groupShipRows(lines) {
  const groups = new Map();
  for (const row of lines) {
    const key = row.nmId;
    if (!groups.has(key)) {
      groups.set(key, {
        nmId: key,
        vendorCode: row.vendorCode,
        children: [],
        shipQty: 0,
        demandQty: 0,
        ilImprovePct: 0,
        warehouses: new Set(),
        regions: new Set(),
      });
    }
    const g = groups.get(key);
    g.children.push(row);
    g.shipQty += row.shipQty || 0;
    g.demandQty += row.demandQty || 0;
    g.ilImprovePct += row.ilImprovePct || 0;
    g.warehouses.add(row.warehouseName);
    g.regions.add(row.regionLabel);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    warehouseCount: g.warehouses.size,
    regionCount: g.regions.size,
    children: g.children.sort((a, b) => b.priority - a.priority || b.shipQty - a.shipQty),
  }));
}

function sortSkuGroups(groups, sortBy, view) {
  const sorted = [...groups];
  const cmpVendor = (a, b) => (a.vendorCode || '').localeCompare(b.vendorCode || '', 'ru');
  sorted.sort((a, b) => {
    switch (sortBy) {
      case 'vendor':
        return cmpVendor(a, b);
      case 'orders':
        return (b.atRiskOrders ?? b.totalOrders ?? 0) - (a.atRiskOrders ?? a.totalOrders ?? 0);
      case 'revenue':
        return (b.lostRevenue || 0) - (a.lostRevenue || 0);
      case 'ilImpact':
        return (b.ilImpactPct || 0) - (a.ilImpactPct || 0);
      case 'ilImprove':
        return (b.ilImprovePct || 0) - (a.ilImprovePct || 0);
      case 'penalty':
        return (b.totalPenaltyRub || 0) - (a.totalPenaltyRub || 0);
      case 'shipQty':
        return (b.shipQty || 0) - (a.shipQty || 0);
      case 'demand':
        return (b.demandQty || 0) - (a.demandQty || 0);
      default:
        if (view === 'shortage') return (b.totalPenaltyRub || 0) - (a.totalPenaltyRub || 0);
        if (view === 'ship') return (b.shipQty || 0) - (a.shipQty || 0);
        return (b.ilImprovePct || 0) - (a.ilImprovePct || 0);
    }
  });
  return sorted;
}

function ExpandBtn({ open, onClick }) {
  return (
    <button
      type="button"
      className="mr-1 text-slate-400 hover:text-brand-600"
      title={open ? 'Свернуть' : 'Раскрыть регионы'}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {open ? '▲' : '▼'}
    </button>
  );
}

function SkuCell({ group, titleByNmId, onToggle, open }) {
  return (
    <td className="px-4 py-2">
      <div className="flex items-start">
        <ExpandBtn open={open} onClick={onToggle} />
        <div>
          <p className="font-medium text-brand-700">{group.vendorCode}</p>
          <p className="text-[10px] text-slate-400">{titleByNmId.get(group.nmId) || group.nmId}</p>
        </div>
      </div>
    </td>
  );
}

function IlImpactTable({ rows, titleByNmId, expanded, onToggle, sortBy }) {
  const groups = useMemo(
    () => sortSkuGroups(groupIlImpactRows(rows), sortBy, 'il-impact'),
    [rows, sortBy]
  );

  return (
    <table className="min-w-full text-left text-xs">
      <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
        <tr>
          <th className="px-4 py-2 font-medium">#</th>
          <th className="px-4 py-2 font-medium">Артикул</th>
          <ThHint hint={PLANNER_HINTS.columns.regionsCount}>Регионов</ThHint>
          <th className="px-4 py-2 font-medium">Заказы</th>
          <ThHint hint={PLANNER_HINTS.columns.ilImpactPct}>Влияние на ИЛ %</ThHint>
          <ThHint hint={PLANNER_HINTS.columns.ilImprovePct}>Потенциал ИЛ %</ThHint>
          <ThHint hint={PLANNER_HINTS.columns.targetWarehouse}>Топ склад</ThHint>
          <th className="px-4 py-2 font-medium">Без остатка</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group, index) => {
          const open = expanded.has(group.nmId);
          const topWarehouse = group.children.find((c) => c.targetWarehouse)?.targetWarehouse;
          return (
            <Fragment key={group.nmId}>
              <tr
                className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40"
                onClick={() => onToggle(group.nmId)}
              >
                <td className="px-4 py-2 text-slate-400">{index + 1}</td>
                <SkuCell group={group} titleByNmId={titleByNmId} open={open} onToggle={() => onToggle(group.nmId)} />
                <td className="px-4 py-2 tabular-nums text-slate-600">{group.regionCount}</td>
                <td className="px-4 py-2 tabular-nums font-medium">{fmtNum(group.totalOrders, 0)}</td>
                <td className="px-4 py-2 tabular-nums font-medium text-amber-700">
                  {group.ilImpactPct ? `${Math.round(group.ilImpactPct * 10) / 10}%` : '—'}
                </td>
                <td className="px-4 py-2 tabular-nums font-medium text-emerald-700">
                  {group.ilImprovePct ? `+${Math.round(group.ilImprovePct * 10) / 10}%` : '—'}
                </td>
                <td className="px-4 py-2 font-medium text-brand-700">{topWarehouse || '—'}</td>
                <td className="px-4 py-2 text-slate-600">
                  {group.noStockRegions ? (
                    <span className="text-rose-600">{group.noStockRegions} рег.</span>
                  ) : (
                    <span className="text-emerald-700">везде есть</span>
                  )}
                </td>
              </tr>
              {open
                ? group.children.map((row) => (
                    <tr key={row.id} className="border-t border-slate-50 bg-slate-50/60 text-[11px]">
                      <td className="px-4 py-1.5" />
                      <td className="px-4 py-1.5 pl-10 text-slate-500">{row.regionLabel}</td>
                      <td className="px-4 py-1.5 text-slate-400">{row.foName || '—'}</td>
                      <td className="px-4 py-1.5 tabular-nums">{fmtNum(row.orders, 0)}</td>
                      <td className="px-4 py-1.5 tabular-nums text-amber-700">
                        {row.ilImpactPct != null ? `${row.ilImpactPct}%` : '—'}
                      </td>
                      <td className="px-4 py-1.5 tabular-nums text-emerald-700">
                        {row.ilImprovePct != null ? `+${row.ilImprovePct}%` : '—'}
                      </td>
                      <td className="px-4 py-1.5 text-brand-700">{row.targetWarehouse || '—'}</td>
                      <td className="px-4 py-1.5">
                        {row.hasLocalStock ? (
                          <span className="text-emerald-700">{fmtNum(row.localStockQty, 0)} шт.</span>
                        ) : (
                          <span className="text-rose-600">нет</span>
                        )}
                      </td>
                    </tr>
                  ))
                : null}
            </Fragment>
          );
        })}
        {!groups.length ? (
          <tr>
            <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
              Нет данных для расчёта влияния на ИЛ
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function ShortageTable({ rows, titleByNmId, expanded, onToggle, sortBy }) {
  const groups = useMemo(
    () => sortSkuGroups(groupShortageRows(rows), sortBy, 'shortage'),
    [rows, sortBy]
  );

  return (
    <table className="min-w-full text-left text-xs">
      <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
        <tr>
          <th className="px-4 py-2 font-medium">#</th>
          <th className="px-4 py-2 font-medium">Артикул</th>
          <ThHint hint={PLANNER_HINTS.columns.regionsCount}>Регионов</ThHint>
          <ThHint hint={PLANNER_HINTS.columns.atRiskOrders}>Заказы под риском</ThHint>
          <ThHint hint={PLANNER_HINTS.columns.lostRevenue}>Retail под риском</ThHint>
          <ThHint hint={PLANNER_HINTS.columns.ilPenalty}>Штраф ИЛ</ThHint>
          <ThHint hint={PLANNER_HINTS.columns.irpPenalty}>Штраф ИРП</ThHint>
          <ThHint hint={PLANNER_HINTS.columns.totalPenalty}>Итого индексы</ThHint>
        </tr>
      </thead>
      <tbody>
        {groups.map((group, index) => {
          const open = expanded.has(group.nmId);
          return (
            <Fragment key={group.nmId}>
              <tr
                className="cursor-pointer border-t border-slate-100 hover:bg-rose-50/30"
                onClick={() => onToggle(group.nmId)}
              >
                <td className="px-4 py-2 text-slate-400">{index + 1}</td>
                <SkuCell group={group} titleByNmId={titleByNmId} open={open} onToggle={() => onToggle(group.nmId)} />
                <td className="px-4 py-2 tabular-nums text-slate-600">{group.regionCount}</td>
                <td className="px-4 py-2 tabular-nums font-medium">{fmtNum(group.atRiskOrders, 0)}</td>
                <td className="px-4 py-2 tabular-nums">{fmtMoney(group.lostRevenue)}</td>
                <td className="px-4 py-2 tabular-nums text-amber-700">{fmtMoney(group.ilPenaltyRub)}</td>
                <td className="px-4 py-2 tabular-nums text-amber-700">{fmtMoney(group.irpPenaltyRub)}</td>
                <td className="px-4 py-2 tabular-nums font-semibold text-rose-700">
                  {fmtMoney(group.totalPenaltyRub)}
                </td>
              </tr>
              {open
                ? group.children.map((row) => (
                    <tr key={row.id} className="border-t border-slate-50 bg-slate-50/60 text-[11px]">
                      <td className="px-4 py-1.5" />
                      <td className="px-4 py-1.5 pl-10 text-slate-500">{row.regionLabel}</td>
                      <td className="px-4 py-1.5 text-slate-400">{row.foName || '—'}</td>
                      <td className="px-4 py-1.5 tabular-nums">{fmtNum(row.atRiskOrders, 0)}</td>
                      <td className="px-4 py-1.5 tabular-nums">{fmtMoney(row.lostRevenue)}</td>
                      <td className="px-4 py-1.5 tabular-nums text-amber-700">{fmtMoney(row.ilPenaltyRub)}</td>
                      <td className="px-4 py-1.5 tabular-nums text-amber-700">{fmtMoney(row.irpPenaltyRub)}</td>
                      <td className="px-4 py-1.5">
                        <span className="font-medium text-rose-700">{fmtMoney(row.totalPenaltyRub)}</span>
                        <span className="ml-2 text-slate-400">{row.reason}</span>
                      </td>
                    </tr>
                  ))
                : null}
            </Fragment>
          );
        })}
        {!groups.length ? (
          <tr>
            <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
              Нет позиций с риском из-за отсутствия локального остатка
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function ShipTable({ lines, titleByNmId, expanded, onToggle, sortBy }) {
  const groups = useMemo(
    () => sortSkuGroups(groupShipRows(lines), sortBy, 'ship'),
    [lines, sortBy]
  );

  return (
    <table className="min-w-full text-left text-xs">
      <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
        <tr>
          <th className="px-4 py-2 font-medium">#</th>
          <th className="px-4 py-2 font-medium">Артикул</th>
          <ThHint hint={PLANNER_HINTS.columns.regionsCount}>Регионов</ThHint>
          <ThHint hint={PLANNER_HINTS.columns.warehousesCount}>Складов</ThHint>
          <ThHint hint={PLANNER_HINTS.columns.demandQty}>Спрос</ThHint>
          <ThHint hint={PLANNER_HINTS.columns.shipQty}>Отгрузить</ThHint>
          <ThHint hint={PLANNER_HINTS.columns.ilImprovePct}>Потенциал ИЛ %</ThHint>
        </tr>
      </thead>
      <tbody>
        {groups.map((group, index) => {
          const open = expanded.has(group.nmId);
          return (
            <Fragment key={group.nmId}>
              <tr
                className="cursor-pointer border-t border-slate-100 hover:bg-emerald-50/30"
                onClick={() => onToggle(group.nmId)}
              >
                <td className="px-4 py-2 text-slate-400">{index + 1}</td>
                <SkuCell group={group} titleByNmId={titleByNmId} open={open} onToggle={() => onToggle(group.nmId)} />
                <td className="px-4 py-2 tabular-nums text-slate-600">{group.regionCount}</td>
                <td className="px-4 py-2 tabular-nums text-slate-600">{group.warehouseCount}</td>
                <td className="px-4 py-2 tabular-nums">{fmtNum(group.demandQty, 0)}</td>
                <td className="px-4 py-2 tabular-nums text-lg font-bold text-emerald-700">
                  {fmtNum(group.shipQty, 0)}
                </td>
                <td className="px-4 py-2 tabular-nums text-emerald-700">
                  {group.ilImprovePct ? `+${Math.round(group.ilImprovePct * 10) / 10}%` : '—'}
                </td>
              </tr>
              {open
                ? group.children.map((row) => (
                    <tr key={row.id} className="border-t border-slate-50 bg-slate-50/60 text-[11px]">
                      <td className="px-4 py-1.5" />
                      <td className="px-4 py-1.5 pl-6">
                        <span className="text-slate-600">{row.regionLabel}</span>
                        <span className="mx-1 text-slate-300">→</span>
                        <span className="font-medium text-brand-700">{row.warehouseName}</span>
                      </td>
                      <td className="px-4 py-1.5" />
                      <td className="px-4 py-1.5" />
                      <td className="px-4 py-1.5 tabular-nums">{fmtNum(row.demandQty, 0)}</td>
                      <td className="px-4 py-1.5 tabular-nums font-bold text-emerald-700">
                        {fmtNum(row.shipQty, 0)}
                        <span className="ml-1 font-normal text-slate-400">
                          (ост. {fmtNum(row.currentStock, 0)})
                        </span>
                      </td>
                      <td className="px-4 py-1.5 tabular-nums text-emerald-700">
                        {row.ilImprovePct != null ? `+${row.ilImprovePct}%` : '—'}
                      </td>
                    </tr>
                  ))
                : null}
            </Fragment>
          );
        })}
        {!groups.length ? (
          <tr>
            <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
              Нет рекомендаций к отгрузке — локальные остатки покрывают спрос
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function PlanFiltersBar({
  view,
  query,
  onQueryChange,
  regionFilter,
  onRegionFilter,
  warehouseFilter,
  onWarehouseFilter,
  onlyNoStock,
  onOnlyNoStock,
  onlyIlPotential,
  onOnlyIlPotential,
  sortBy,
  onSortBy,
  regions,
  warehouses,
  resultCount,
}) {
  const sortOptions = PLAN_SORT_OPTIONS[view] || [];

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input w-48 py-1.5 text-xs"
          placeholder="Артикул или название…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <select
          className="input w-40 py-1.5 text-xs"
          value={regionFilter}
          onChange={(e) => onRegionFilter(e.target.value)}
        >
          <option value="">Все регионы</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          className="input w-40 py-1.5 text-xs"
          value={warehouseFilter}
          onChange={(e) => onWarehouseFilter(e.target.value)}
        >
          <option value="">Все склады</option>
          {warehouses.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <select className="input w-36 py-1.5 text-xs" value={sortBy} onChange={(e) => onSortBy(e.target.value)}>
          {sortOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
        {view === 'il-impact' ? (
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={onlyNoStock}
              onChange={(e) => onOnlyNoStock(e.target.checked)}
            />
            Только без остатка
            <HintIcon text={PLANNER_HINTS.columns.localStock} />
          </label>
        ) : null}
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            className="rounded border-slate-300"
            checked={onlyIlPotential}
            onChange={(e) => onOnlyIlPotential(e.target.checked)}
          />
          Только с потенциалом ИЛ
          <HintIcon text={PLANNER_HINTS.columns.ilImprovePct} />
        </label>
        <span className="text-slate-400">
          {resultCount} SKU · клик по строке — детализация по регионам
        </span>
      </div>
    </div>
  );
}

export default function RegionsPanel({ rows = [], meta = {}, settings = {}, tariffCache = null }) {
  const [view, setView] = useState('il-impact');
  const [query, setQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [onlyNoStock, setOnlyNoStock] = useState(false);
  const [onlyIlPotential, setOnlyIlPotential] = useState(false);
  const [sortBy, setSortBy] = useState(DEFAULT_SORT['il-impact']);
  const [expandedSkus, setExpandedSkus] = useState(() => new Set());

  const toggleSku = (nmId) => {
    setExpandedSkus((prev) => {
      const next = new Set(prev);
      if (next.has(nmId)) next.delete(nmId);
      else next.add(nmId);
      return next;
    });
  };

  const handleViewChange = (nextView) => {
    setView(nextView);
    if (PLAN_SORT_OPTIONS[nextView]) {
      setSortBy(DEFAULT_SORT[nextView]);
    }
    if (!PLAN_VIEWS.some((v) => v.id === nextView)) {
      setOnlyNoStock(false);
      setOnlyIlPotential(false);
      setRegionFilter('');
      setWarehouseFilter('');
    }
  };

  const periodLabel = meta?.regionSalesPeriod
    ? `${meta.regionSalesPeriod.dateFrom} — ${meta.regionSalesPeriod.dateTo}`
    : '30 дней';

  const tariffCtx = useMemo(
    () => resolveRegionTariffContext(tariffCache, rows, settings, meta),
    [tariffCache, rows, settings, meta]
  );

  const snapshot = useMemo(
    () =>
      enrichRegionDemandSnapshot(meta?.regionSalesSnapshot || null, {
        tariffList: tariffCtx.tariffList,
        cargoType: tariffCtx.warehouseCargoType,
      }),
    [meta?.regionSalesSnapshot, tariffCtx.tariffList, tariffCtx.warehouseCargoType]
  );

  const supplyPlan = useMemo(
    () =>
      buildRegionSupplyRecommendations({
        snapshot,
        rows,
        settings,
        meta,
        tariffCache,
      }),
    [snapshot, rows, settings, meta, tariffCache]
  );

  const regionAnalysis = useMemo(
    () =>
      buildRegionSupplyAnalysis({
        snapshot,
        rows,
        settings,
        meta,
        tariffCache,
        supplyPlan,
      }),
    [snapshot, rows, settings, meta, tariffCache, supplyPlan]
  );

  const actionByRegion = useMemo(() => {
    const map = new Map();
    for (const action of supplyPlan.actions || []) {
      map.set(action.regionLabel, action);
    }
    return map;
  }, [supplyPlan.actions]);

  const titleByNmId = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      if (row.nmId) map.set(Number(row.nmId), row.title || row.vendorCode || String(row.nmId));
    }
    return map;
  }, [rows]);

  const isPlanView = view === 'il-impact' || view === 'shortage' || view === 'ship';

  const list = useMemo(() => {
    if (!snapshot || isPlanView) return [];
    if (view === 'fo') return snapshot.byFo || [];
    if (view === 'city') return snapshot.byCity || [];
    if (view === 'warehouse') {
      return (snapshot.warehouses || []).filter((item) => {
        const name = item.label || item.warehouseName || '';
        return name && !isFederalDistrictLabel(name);
      });
    }
    return snapshot.byRegion || [];
  }, [snapshot, view, isPlanView]);

  const filteredGeo = useMemo(() => {
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

  const planFilterOpts = useMemo(
    () => ({
      query,
      regionFilter,
      warehouseFilter,
      onlyNoStock,
      onlyIlPotential,
      view,
    }),
    [query, regionFilter, warehouseFilter, onlyNoStock, onlyIlPotential, view]
  );

  const filteredIlImpact = useMemo(
    () => applyPlanRowFilters(regionAnalysis.ilImpact.rows || [], planFilterOpts),
    [regionAnalysis.ilImpact.rows, planFilterOpts]
  );

  const filteredShortage = useMemo(
    () => applyPlanRowFilters(regionAnalysis.shortageLosses.rows || [], planFilterOpts),
    [regionAnalysis.shortageLosses.rows, planFilterOpts]
  );

  const filteredShip = useMemo(
    () => applyPlanRowFilters(regionAnalysis.shipPlan.lines || [], planFilterOpts),
    [regionAnalysis.shipPlan.lines, planFilterOpts]
  );

  const planRegions = useMemo(() => {
    const source =
      view === 'shortage'
        ? regionAnalysis.shortageLosses.rows
        : view === 'ship'
          ? regionAnalysis.shipPlan.lines
          : regionAnalysis.ilImpact.rows;
    return [...new Set((source || []).map((r) => r.regionLabel).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'ru')
    );
  }, [view, regionAnalysis]);

  const planWarehouses = useMemo(() => {
    const source =
      view === 'ship'
        ? regionAnalysis.shipPlan.lines
        : regionAnalysis.ilImpact.rows;
    const field = view === 'ship' ? 'warehouseName' : 'targetWarehouse';
    return [...new Set((source || []).map((r) => r[field]).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'ru')
    );
  }, [view, regionAnalysis]);

  const planSkuCount = useMemo(() => {
    const lines =
      view === 'shortage' ? filteredShortage : view === 'ship' ? filteredShip : filteredIlImpact;
    return new Set(lines.map((r) => r.nmId)).size;
  }, [view, filteredIlImpact, filteredShortage, filteredShip]);

  const topRegion = snapshot?.byRegion?.[0];
  const topAction = supplyPlan.actions?.[0];
  const { ilImpact, shortageLosses, shipPlan } = regionAnalysis;

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
      <RegionRecommendations plan={supplyPlan} />

      <section className="panel border-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Спрос по географии</p>
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
          <KpiWithHint
            label="ИЛ кабинета"
            hint={PLANNER_HINTS.kpi.localizationIndex}
            value={`×${(ilImpact.localizationIndex ?? 1).toFixed(2)}`}
            sub={
              ilImpact.summary?.topImprovePct
                ? `Потенциал топ-20: +${ilImpact.summary.topImprovePct}%`
                : 'См. вкладку «Влияние на ИЛ»'
            }
          />
          <KpiWithHint
            label="К отгрузке"
            hint={PLANNER_HINTS.kpi.shipTotal}
            value={shipPlan.summary?.totalUnits ? `${fmtNum(shipPlan.summary.totalUnits, 0)} шт.` : '—'}
            sub={
              shipPlan.summary?.warehouseCount
                ? `${shipPlan.summary.warehouseCount} склад(ов) · ${shipPlan.summary.skuCount} SKU`
                : 'См. вкладку «Отгрузить»'
            }
          />
        </div>

        {shortageLosses.summary ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <KpiWithHint
              label="Заказы под риском"
              hint={PLANNER_HINTS.kpi.atRiskOrders}
              value={fmtNum(shortageLosses.summary.atRiskOrders, 0)}
              sub="Нет локального остатка в ФО спроса"
            />
            <KpiWithHint
              label="Retail под риском"
              hint={PLANNER_HINTS.kpi.lostRevenue}
              value={fmtMoney(shortageLosses.summary.lostRevenue)}
              sub="Оценка по отчёту регионов"
            />
            <KpiWithHint
              label="Штраф ИЛ/ИРП"
              hint={PLANNER_HINTS.kpi.indexPenalty}
              value={fmtMoney(shortageLosses.summary.indexPenaltyRub)}
              sub="За нелокальную отгрузку без остатка"
            />
          </div>
        ) : null}
      </section>

      <section className="panel overflow-hidden p-0">
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {GEO_VIEWS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    view === item.id
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  onClick={() => handleViewChange(item.id)}
                >
                  {item.label}
                </button>
              ))}
              <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:inline" />
              {PLAN_VIEWS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    view === item.id
                      ? 'bg-violet-600 text-white'
                      : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
                  }`}
                  onClick={() => handleViewChange(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {!isPlanView ? (
              <input
                className="input w-56 py-1.5 text-xs"
                placeholder="Поиск…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            ) : null}
          </div>
          {view === 'il-impact' ? <TabDescription hint={PLANNER_HINTS.tabs.ilImpact} /> : null}
          {view === 'shortage' ? <TabDescription hint={PLANNER_HINTS.tabs.shortage} /> : null}
          {view === 'ship' ? <TabDescription hint={PLANNER_HINTS.tabs.ship} /> : null}
          {isPlanView ? (
            <PlanFiltersBar
              view={view}
              query={query}
              onQueryChange={setQuery}
              regionFilter={regionFilter}
              onRegionFilter={setRegionFilter}
              warehouseFilter={warehouseFilter}
              onWarehouseFilter={setWarehouseFilter}
              onlyNoStock={onlyNoStock}
              onOnlyNoStock={setOnlyNoStock}
              onlyIlPotential={onlyIlPotential}
              onOnlyIlPotential={setOnlyIlPotential}
              sortBy={sortBy}
              onSortBy={setSortBy}
              regions={planRegions}
              warehouses={planWarehouses}
              resultCount={planSkuCount}
            />
          ) : null}
        </div>

        <div className="table-scroll max-h-[calc(100vh-420px)] overflow-auto">
          {view === 'il-impact' ? (
            <IlImpactTable
              rows={filteredIlImpact}
              titleByNmId={titleByNmId}
              expanded={expandedSkus}
              onToggle={toggleSku}
              sortBy={sortBy}
            />
          ) : view === 'shortage' ? (
            <ShortageTable
              rows={filteredShortage}
              titleByNmId={titleByNmId}
              expanded={expandedSkus}
              onToggle={toggleSku}
              sortBy={sortBy}
            />
          ) : view === 'ship' ? (
            <ShipTable
              lines={filteredShip}
              titleByNmId={titleByNmId}
              expanded={expandedSkus}
              onToggle={toggleSku}
              sortBy={sortBy}
            />
          ) : (
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
                  {view === 'region' ? <th className="px-4 py-2 font-medium">Рекомендация</th> : null}
                  {view === 'region' ? <th className="px-4 py-2 font-medium">₽/ед.</th> : null}
                  <th className="px-4 py-2 font-medium">Заказы</th>
                  <th className="px-4 py-2 font-medium">Доля</th>
                  <th className="px-4 py-2 font-medium">Retail</th>
                  <th className="px-4 py-2 font-medium">SKU</th>
                </tr>
              </thead>
              <tbody>
                {filteredGeo.map((item, index) => {
                  const action = view === 'region' ? actionByRegion.get(item.label) : null;
                  return (
                    <tr
                      key={`${item.key || item.label}-${index}`}
                      className="border-t border-slate-100 hover:bg-brand-50/40"
                    >
                      <td className="px-4 py-2 text-slate-400">{index + 1}</td>
                      <td className="px-4 py-2 font-medium text-slate-800">{item.label || item.warehouseName}</td>
                      {view === 'city' ? (
                        <td className="px-4 py-2 text-slate-600">{item.regionName || '—'}</td>
                      ) : null}
                      {view === 'region' ? (
                        <td className="px-4 py-2 text-slate-600">{item.foName || '—'}</td>
                      ) : null}
                      {view === 'warehouse' ? (
                        <td className="px-4 py-2 text-slate-600">
                          {(item.regions || []).join(', ') || '—'}
                        </td>
                      ) : null}
                      {view === 'region' ? (
                        <td className="px-4 py-2 text-slate-700">
                          {action?.warehouseName && !isFederalDistrictLabel(action.warehouseName) ? (
                            <span className="font-medium text-brand-700">{action.warehouseName}</span>
                          ) : (
                            filterWarehouseLabels(item.suggestedWarehouses).slice(0, 2).join(', ') || '—'
                          )}
                          {action?.warehouseCoeff && action?.warehouseName && !isFederalDistrictLabel(action.warehouseName) ? (
                            <span className="ml-1 text-slate-400">{formatWarehouseCoeffPercent(action.warehouseCoeff)}</span>
                          ) : null}
                        </td>
                      ) : null}
                      {view === 'region' ? (
                        <td className="px-4 py-2 tabular-nums text-slate-700">
                          {action?.costPerUnit != null ? fmtMoney(action.costPerUnit) : '—'}
                        </td>
                      ) : null}
                      <td className="px-4 py-2 tabular-nums text-slate-700">{fmtNum(item.qty, 0)}</td>
                      <td className="px-4 py-2">
                        <ShareBar sharePct={item.sharePct} />
                      </td>
                      <td className="px-4 py-2 tabular-nums text-slate-700">{fmtMoney(item.revenue)}</td>
                      <td className="px-4 py-2 text-slate-500">{item.skuCount ?? '—'}</td>
                    </tr>
                  );
                })}
                {!filteredGeo.length ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                      Ничего не найдено
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {view === 'il-impact' && snapshot.byNmId?.length ? (
        <section className="panel">
          <h3 className="text-sm font-semibold text-slate-800">Топ артикулов по заказам в регионах</h3>
          <p className="mt-1 text-xs text-slate-500">
            Сводка по артикулам · детализация SKU×регион — во вкладке «Влияние на ИЛ»
          </p>
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
