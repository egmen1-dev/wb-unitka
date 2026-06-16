import { fmtNum } from '../lib/format';
import { HintIcon, PLANNER_HINTS } from './RegionsPlannerHints';

export default function RegionsPeriodDelta({ deltas, previousSyncedAt }) {
  if (!deltas?.length) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="inline-flex items-center text-xs font-semibold text-slate-700">
        vs прошлая синхронизация
        <HintIcon text={PLANNER_HINTS.kpi.periodDelta} className="ml-1" />
      </p>
      {previousSyncedAt ? (
        <p className="mt-0.5 text-[10px] text-slate-400">
          Было: {new Date(previousSyncedAt).toLocaleString('ru-RU')}
        </p>
      ) : null}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {deltas.map((d) => (
          <li key={d.label} className="tabular-nums text-slate-600">
            <span className="font-medium text-slate-800">{d.label}</span>
            {' '}
            <span className={d.deltaQty >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
              {d.deltaQty >= 0 ? '+' : ''}
              {fmtNum(d.deltaQty, 0)} ({d.deltaPct >= 0 ? '+' : ''}
              {d.deltaPct}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
