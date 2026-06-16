import { formatWarehouseCoeffPercent } from '@lib/region-supply-recommendations.js';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format';
import { TabDescription, ThHint, PLANNER_HINTS } from './RegionsPlannerHints';

export default function RegionsFoWarehouses({ foPriority }) {
  const rows = foPriority?.rows || [];

  return (
    <div className="p-4">
      <TabDescription hint={PLANNER_HINTS.tabs.foWarehouses} />

      <div className="table-scroll mt-3 max-h-[calc(100vh-420px)] overflow-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
            <tr>
              <th className="px-4 py-2 font-medium">Федеральный округ</th>
              <ThHint hint={PLANNER_HINTS.columns.targetWarehouse}>Реком. склад</ThHint>
              <ThHint hint={PLANNER_HINTS.foWarehouses.coverage}>Покрытие спроса</ThHint>
              <th className="px-4 py-2 font-medium">Заказы</th>
              <th className="px-4 py-2 font-medium">Доля</th>
              <ThHint hint={PLANNER_HINTS.foWarehouses.delivery}>Доставка</ThHint>
              <th className="px-4 py-2 font-medium">₽/ед.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.foKey || row.foName} className="border-t border-slate-100 hover:bg-brand-50/30">
                <td className="px-4 py-2 font-medium text-slate-800">{row.foName}</td>
                <td className="px-4 py-2">
                  <span className="font-medium text-brand-700">{row.warehouseName}</span>
                  {row.warehouseCoeff ? (
                    <span className="ml-1 text-slate-400">
                      {formatWarehouseCoeffPercent(row.warehouseCoeff)}
                    </span>
                  ) : null}
                  {row.isLocal ? (
                    <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[10px] text-emerald-800">
                      лок.
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 tabular-nums">{row.coveragePct}%</td>
                <td className="px-4 py-2 tabular-nums">{fmtNum(row.demandQty, 0)}</td>
                <td className="px-4 py-2 tabular-nums">{fmtPct(row.sharePct)}</td>
                <td className="px-4 py-2 text-slate-600">{row.deliveryHint}</td>
                <td className="px-4 py-2 tabular-nums">
                  {row.costPerUnit != null ? fmtMoney(row.costPerUnit) : '—'}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Нет данных по федеральным округам
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
