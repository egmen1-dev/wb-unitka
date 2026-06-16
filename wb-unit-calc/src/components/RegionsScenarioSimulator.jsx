import { useMemo, useState } from 'react';
import { simulateShipmentScenario } from '@lib/wb-region-supply-plan.js';
import { formatWarehouseCoeffPercent } from '@lib/region-supply-recommendations.js';
import { fmtMoney, fmtNum } from '../lib/format';
import { HintIcon, KpiWithHint, PLANNER_HINTS, TabDescription } from './RegionsPlannerHints';

export default function RegionsScenarioSimulator({
  rows,
  snapshot,
  settings,
  meta,
  tariffCache,
  supplyPlan,
}) {
  const skuOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const row of rows) {
      const nmId = Number(row.nmId);
      if (!nmId || seen.has(nmId)) continue;
      seen.add(nmId);
      list.push({ nmId, vendorCode: row.vendorCode || String(nmId), title: row.title || '' });
    }
    return list.sort((a, b) => (a.vendorCode || '').localeCompare(b.vendorCode || '', 'ru'));
  }, [rows]);

  const warehouseOptions = useMemo(() => {
    const names = new Set();
    for (const action of supplyPlan?.actions || []) {
      if (action.warehouseName) names.add(action.warehouseName);
    }
    for (const wh of snapshot?.warehouses || []) {
      if (wh.warehouseName || wh.label) names.add(wh.warehouseName || wh.label);
    }
    for (const row of rows) {
      if (row.fboWarehouseName) names.add(row.fboWarehouseName);
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [supplyPlan, snapshot, rows]);

  const regionOptions = useMemo(
    () => (snapshot?.byRegion || []).map((r) => r.label || r.regionName).filter(Boolean),
    [snapshot]
  );

  const [nmId, setNmId] = useState(() => skuOptions[0]?.nmId || '');
  const [warehouseName, setWarehouseName] = useState(() => warehouseOptions[0] || '');
  const [regionLabel, setRegionLabel] = useState(() => regionOptions[0] || '');
  const [shipQty, setShipQty] = useState(10);

  const result = useMemo(() => {
    if (!nmId || !warehouseName) return null;
    return simulateShipmentScenario({
      nmId: Number(nmId),
      warehouseName,
      shipQty,
      regionLabel,
      snapshot,
      rows,
      settings,
      meta,
      tariffCache,
      supplyPlan,
    });
  }, [nmId, warehouseName, shipQty, regionLabel, snapshot, rows, settings, meta, tariffCache, supplyPlan]);

  return (
    <div className="p-4">
      <TabDescription hint={PLANNER_HINTS.tabs.simulator} />

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs text-slate-600">
          Артикул
          <select
            className="input mt-1 w-full py-1.5 text-xs"
            value={nmId}
            onChange={(e) => setNmId(e.target.value)}
          >
            {skuOptions.map((opt) => (
              <option key={opt.nmId} value={opt.nmId}>
                {opt.vendorCode}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Склад WB
          <HintIcon text={PLANNER_HINTS.columns.targetWarehouse} className="ml-1" />
          <select
            className="input mt-1 w-full py-1.5 text-xs"
            value={warehouseName}
            onChange={(e) => setWarehouseName(e.target.value)}
          >
            {warehouseOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Регион спроса
          <select
            className="input mt-1 w-full py-1.5 text-xs"
            value={regionLabel}
            onChange={(e) => setRegionLabel(e.target.value)}
          >
            {regionOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Отгрузить, шт.
          <input
            type="number"
            min={0}
            className="input mt-1 w-full py-1.5 text-xs tabular-nums"
            value={shipQty}
            onChange={(e) => setShipQty(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
      </div>

      {result?.error ? (
        <p className="mt-4 text-sm text-rose-600">{result.error}</p>
      ) : result ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiWithHint
              label="ИЛ после отгрузки"
              hint={PLANNER_HINTS.kpi.localizationIndex}
              value={`×${result.projectedIl}`}
              sub={
                result.ilDelta
                  ? `Сейчас ×${result.localizationIndex} → −${result.ilDelta}`
                  : `Сейчас ×${result.localizationIndex}`
              }
            />
            <KpiWithHint
              label="ИРП после отгрузки"
              hint={PLANNER_HINTS.kpi.indexPenalty}
              value={`${result.projectedIrpPct}%`}
              sub={
                result.irpDeltaPct
                  ? `Сейчас ${Math.round(result.salesDistributionIndex * 10000) / 100}% → −${result.irpDeltaPct} п.п.`
                  : undefined
              }
            />
            <KpiWithHint
              label="Логистика ₽/ед."
              hint={PLANNER_HINTS.columns.supplyCost}
              value={result.costPerUnit != null ? fmtMoney(result.costPerUnit) : '—'}
              sub={
                result.warehouseCoeff
                  ? `${result.warehouseName} · ${formatWarehouseCoeffPercent(result.warehouseCoeff)}${
                      result.isLocal ? ' · локально' : ''
                    }`
                  : result.warehouseName
              }
            />
            <KpiWithHint
              label="Итого ₽/ед."
              hint={PLANNER_HINTS.simulator.totalPerUnit}
              value={result.totalRubPerUnit != null ? fmtMoney(result.totalRubPerUnit) : '—'}
              sub={
                result.shipQty
                  ? `Приёмка+хранение ${fmtMoney(result.supplyCostPerUnit)}/ед. · партия ${fmtMoney(result.supplyCostRub)}`
                  : undefined
              }
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Локализация артикула: {result.localizationSharePct}% → {result.projectedLocalizationSharePct}%
            {result.regionLabel ? ` · регион «${result.regionLabel}»` : ''}
            {result.foName ? ` (${result.foName})` : ''}
          </p>
        </>
      ) : null}
    </div>
  );
}
