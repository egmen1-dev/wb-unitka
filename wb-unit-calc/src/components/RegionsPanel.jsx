import { useMemo, useState } from 'react';
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

const VIEWS = [...GEO_VIEWS, ...PLAN_VIEWS];

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

function IlImpactTable({ rows, titleByNmId }) {
  return (
    <table className="min-w-full text-left text-xs">
      <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
        <tr>
          <th className="px-4 py-2 font-medium">#</th>
          <th className="px-4 py-2 font-medium">Артикул</th>
          <th className="px-4 py-2 font-medium">Регион</th>
          <th className="px-4 py-2 font-medium">Заказы</th>
          <th className="px-4 py-2 font-medium">Доля</th>
          <th className="px-4 py-2 font-medium">Влияние на ИЛ %</th>
          <th className="px-4 py-2 font-medium">Потенциал ИЛ %</th>
          <th className="px-4 py-2 font-medium">Куда отгрузить</th>
          <th className="px-4 py-2 font-medium">Остаток в ФО</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.id} className="border-t border-slate-100 hover:bg-brand-50/40">
            <td className="px-4 py-2 text-slate-400">{index + 1}</td>
            <td className="px-4 py-2">
              <p className="font-medium text-brand-700">{row.vendorCode}</p>
              <p className="text-[10px] text-slate-400">
                {titleByNmId.get(row.nmId) || row.nmId}
              </p>
            </td>
            <td className="px-4 py-2 text-slate-700">
              {row.regionLabel}
              {row.foName ? <span className="block text-[10px] text-slate-400">{row.foName}</span> : null}
            </td>
            <td className="px-4 py-2 tabular-nums">{fmtNum(row.orders, 0)}</td>
            <td className="px-4 py-2">{fmtPct(row.sharePct)}</td>
            <td className="px-4 py-2 tabular-nums font-medium text-amber-700">
              {row.ilImpactPct != null ? `${row.ilImpactPct}%` : '—'}
            </td>
            <td className="px-4 py-2 tabular-nums font-medium text-emerald-700">
              {row.ilImprovePct != null ? `+${row.ilImprovePct}%` : '—'}
            </td>
            <td className="px-4 py-2 font-medium text-brand-700">{row.targetWarehouse || '—'}</td>
            <td className="px-4 py-2 text-slate-600">
              {row.hasLocalStock ? (
                <span className="text-emerald-700">{fmtNum(row.localStockQty, 0)} шт.</span>
              ) : (
                <span className="text-rose-600">нет</span>
              )}
            </td>
          </tr>
        ))}
        {!rows.length ? (
          <tr>
            <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
              Нет данных для расчёта влияния на ИЛ
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function ShortageTable({ rows, titleByNmId }) {
  return (
    <table className="min-w-full text-left text-xs">
      <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
        <tr>
          <th className="px-4 py-2 font-medium">#</th>
          <th className="px-4 py-2 font-medium">Артикул</th>
          <th className="px-4 py-2 font-medium">Регион</th>
          <th className="px-4 py-2 font-medium">Заказы под риском</th>
          <th className="px-4 py-2 font-medium">Retail под риском</th>
          <th className="px-4 py-2 font-medium">Штраф ИЛ</th>
          <th className="px-4 py-2 font-medium">Штраф ИРП</th>
          <th className="px-4 py-2 font-medium">Итого индексы</th>
          <th className="px-4 py-2 font-medium">Причина</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.id} className="border-t border-slate-100 hover:bg-rose-50/30">
            <td className="px-4 py-2 text-slate-400">{index + 1}</td>
            <td className="px-4 py-2">
              <p className="font-medium text-brand-700">{row.vendorCode}</p>
              <p className="text-[10px] text-slate-400">
                {titleByNmId.get(row.nmId) || row.nmId}
              </p>
            </td>
            <td className="px-4 py-2 text-slate-700">{row.regionLabel}</td>
            <td className="px-4 py-2 tabular-nums font-medium">{fmtNum(row.atRiskOrders, 0)}</td>
            <td className="px-4 py-2 tabular-nums">{fmtMoney(row.lostRevenue)}</td>
            <td className="px-4 py-2 tabular-nums text-amber-700">{fmtMoney(row.ilPenaltyRub)}</td>
            <td className="px-4 py-2 tabular-nums text-amber-700">{fmtMoney(row.irpPenaltyRub)}</td>
            <td className="px-4 py-2 tabular-nums font-semibold text-rose-700">
              {fmtMoney(row.totalPenaltyRub)}
            </td>
            <td className="px-4 py-2 text-slate-500">{row.reason}</td>
          </tr>
        ))}
        {!rows.length ? (
          <tr>
            <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
              Нет позиций с риском из-за отсутствия локального остатка
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function ShipTable({ lines, titleByNmId }) {
  return (
    <table className="min-w-full text-left text-xs">
      <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
        <tr>
          <th className="px-4 py-2 font-medium">#</th>
          <th className="px-4 py-2 font-medium">Артикул</th>
          <th className="px-4 py-2 font-medium">Регион спроса</th>
          <th className="px-4 py-2 font-medium">Склад WB</th>
          <th className="px-4 py-2 font-medium">Спрос</th>
          <th className="px-4 py-2 font-medium">Остаток</th>
          <th className="px-4 py-2 font-medium">Отгрузить</th>
          <th className="px-4 py-2 font-medium">Потенциал ИЛ %</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((row, index) => (
          <tr key={row.id} className="border-t border-slate-100 hover:bg-emerald-50/30">
            <td className="px-4 py-2 text-slate-400">{index + 1}</td>
            <td className="px-4 py-2">
              <p className="font-medium text-brand-700">{row.vendorCode}</p>
              <p className="text-[10px] text-slate-400">
                {titleByNmId.get(row.nmId) || row.nmId}
              </p>
            </td>
            <td className="px-4 py-2 text-slate-700">{row.regionLabel}</td>
            <td className="px-4 py-2 font-medium text-brand-700">{row.warehouseName}</td>
            <td className="px-4 py-2 tabular-nums">{fmtNum(row.demandQty, 0)}</td>
            <td className="px-4 py-2 tabular-nums text-slate-600">{fmtNum(row.currentStock, 0)}</td>
            <td className="px-4 py-2 tabular-nums text-lg font-bold text-emerald-700">
              {fmtNum(row.shipQty, 0)}
            </td>
            <td className="px-4 py-2 tabular-nums text-emerald-700">
              {row.ilImprovePct != null ? `+${row.ilImprovePct}%` : '—'}
            </td>
          </tr>
        ))}
        {!lines.length ? (
          <tr>
            <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
              Нет рекомендаций к отгрузке — локальные остатки покрывают спрос
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

export default function RegionsPanel({ rows = [], meta = {}, settings = {}, tariffCache = null }) {
  const [view, setView] = useState('il-impact');
  const [query, setQuery] = useState('');

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

  const filteredIlImpact = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = regionAnalysis.ilImpact.rows || [];
    if (!q) return source;
    return source.filter((row) =>
      [row.vendorCode, row.regionLabel, row.foName, row.targetWarehouse, String(row.nmId)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [regionAnalysis.ilImpact.rows, query]);

  const filteredShortage = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = regionAnalysis.shortageLosses.rows || [];
    if (!q) return source;
    return source.filter((row) =>
      [row.vendorCode, row.regionLabel, row.reason, String(row.nmId)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [regionAnalysis.shortageLosses.rows, query]);

  const filteredShip = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = regionAnalysis.shipPlan.lines || [];
    if (!q) return source;
    return source.filter((row) =>
      [row.vendorCode, row.regionLabel, row.warehouseName, String(row.nmId)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [regionAnalysis.shipPlan.lines, query]);

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
          <Kpi
            label="ИЛ кабинета"
            value={`×${(ilImpact.localizationIndex ?? 1).toFixed(2)}`}
            sub={
              ilImpact.summary?.topImprovePct
                ? `Потенциал топ-20: +${ilImpact.summary.topImprovePct}%`
                : 'См. вкладку «Влияние на ИЛ»'
            }
          />
          <Kpi
            label="К отгрузке"
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
            <Kpi
              label="Заказы под риском"
              value={fmtNum(shortageLosses.summary.atRiskOrders, 0)}
              sub="Нет локального остатка в ФО спроса"
            />
            <Kpi
              label="Retail под риском"
              value={fmtMoney(shortageLosses.summary.lostRevenue)}
              sub="Оценка по отчёту регионов"
            />
            <Kpi
              label="Штраф ИЛ/ИРП"
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
                  onClick={() => setView(item.id)}
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
          {view === 'il-impact' ? (
            <p className="mt-3 text-xs text-slate-500">
              Доля влияния на ИЛ — вклад SKU×регион в текущий индекс. Потенциал ИЛ % — оценка улучшения при
              локальной отгрузке на рекомендованный склад.
            </p>
          ) : null}
          {view === 'shortage' ? (
            <p className="mt-3 text-xs text-slate-500">
              Позиции, где спрос в регионе есть, но остатка в федеральном округе нет — заказы уходят нелокально и
              увеличивают ИЛ/ИРП.
            </p>
          ) : null}
          {view === 'ship' ? (
            <p className="mt-3 text-xs text-slate-500">
              План поставок: сколько единиц отгрузить на склад WB, чтобы покрыть региональный спрос и снизить ИЛ.
              Сортировка по приоритету влияния на ИЛ.
            </p>
          ) : null}
        </div>

        <div className="table-scroll max-h-[calc(100vh-420px)] overflow-auto">
          {view === 'il-impact' ? (
            <IlImpactTable rows={filteredIlImpact.slice(0, 100)} titleByNmId={titleByNmId} />
          ) : view === 'shortage' ? (
            <ShortageTable rows={filteredShortage.slice(0, 100)} titleByNmId={titleByNmId} />
          ) : view === 'ship' ? (
            <ShipTable lines={filteredShip.slice(0, 100)} titleByNmId={titleByNmId} />
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
