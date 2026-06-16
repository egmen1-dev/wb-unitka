import { useMemo, useState } from 'react';
import { fmtNum } from '../lib/format';
import { HintIcon, TabDescription, PLANNER_HINTS } from './RegionsPlannerHints';

const STORAGE_KEY = 'wb-unit-calc:region-in-transit-manual';

function loadManual() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveManual(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export default function RegionsInTransitPanel({ shipLines = [] }) {
  const [manual, setManual] = useState(loadManual);
  const [draftKey, setDraftKey] = useState('');
  const [draftQty, setDraftQty] = useState('');

  const linesByKey = useMemo(() => {
    const map = new Map();
    for (const line of shipLines) {
      const key = `${line.nmId}::${line.warehouseName}`;
      map.set(key, line);
    }
    return map;
  }, [shipLines]);

  const adjustedLines = useMemo(() => {
    return shipLines.map((line) => {
      const key = `${line.nmId}::${line.warehouseName}`;
      const inTransit = Math.max(0, Number(manual[key]) || 0);
      const adjustedShip = Math.max(0, (line.shipQty || 0) - inTransit);
      return { ...line, inTransit, adjustedShip, key };
    });
  }, [shipLines, manual]);

  const totalInTransit = adjustedLines.reduce((s, l) => s + l.inTransit, 0);

  function addManualEntry() {
    if (!draftKey.trim()) return;
    const qty = Math.max(0, Number(draftQty) || 0);
    setManual((prev) => {
      const next = { ...prev, [draftKey.trim()]: qty };
      saveManual(next);
      return next;
    });
    setDraftKey('');
    setDraftQty('');
  }

  function removeEntry(key) {
    setManual((prev) => {
      const next = { ...prev };
      delete next[key];
      saveManual(next);
      return next;
    });
  }

  return (
    <div className="p-4">
      <TabDescription hint={PLANNER_HINTS.tabs.inTransit} />

      <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-xs text-amber-900">
        <p className="font-medium">API FBW «Товары в пути» не подключён</p>
        <p className="mt-1 text-amber-800/90">
          Для автоматической загрузки нужен токен категории «Поставки» (supplies-api.wildberries.ru:
          POST /api/v1/supplies, GET /api/v1/supplies/&#123;ID&#125;/goods). Пока укажите ожидаемые
          количества вручную — они вычитаются из рекомендаций «Отгрузить».
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="block text-xs text-slate-600">
          nmId::склад
          <HintIcon text={PLANNER_HINTS.inTransit.manualKey} className="ml-1" />
          <input
            className="input mt-1 w-52 py-1.5 text-xs"
            placeholder="12345::Коледино"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            list="in-transit-keys"
          />
          <datalist id="in-transit-keys">
            {shipLines.slice(0, 30).map((line) => (
              <option key={`${line.nmId}::${line.warehouseName}`} value={`${line.nmId}::${line.warehouseName}`} />
            ))}
          </datalist>
        </label>
        <label className="block text-xs text-slate-600">
          В пути, шт.
          <input
            type="number"
            min={0}
            className="input mt-1 w-24 py-1.5 text-xs"
            value={draftQty}
            onChange={(e) => setDraftQty(e.target.value)}
          />
        </label>
        <button type="button" className="btn-secondary py-1.5 text-xs" onClick={addManualEntry}>
          Добавить
        </button>
        {totalInTransit ? (
          <span className="text-xs text-slate-500">Учтено в пути: {fmtNum(totalInTransit, 0)} шт.</span>
        ) : null}
      </div>

      {Object.keys(manual).length ? (
        <ul className="mt-3 space-y-1 text-xs">
          {Object.entries(manual).map(([key, qty]) => (
            <li key={key} className="flex items-center gap-2 text-slate-600">
              <span className="font-mono">{key}</span>
              <span className="tabular-nums">{fmtNum(qty, 0)} шт.</span>
              <button type="button" className="text-rose-500 hover:underline" onClick={() => removeEntry(key)}>
                удалить
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {adjustedLines.length ? (
        <div className="table-scroll mt-4 max-h-64 overflow-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Артикул → склад</th>
                <th className="px-3 py-2 font-medium">План</th>
                <th className="px-3 py-2 font-medium">В пути</th>
                <th className="px-3 py-2 font-medium">К отгрузке</th>
              </tr>
            </thead>
            <tbody>
              {adjustedLines
                .filter((l) => l.inTransit > 0 || l.shipQty > 0)
                .slice(0, 40)
                .map((line) => (
                  <tr key={line.key} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      {line.vendorCode} → {line.warehouseName}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmtNum(line.shipQty, 0)}</td>
                    <td className="px-3 py-2 tabular-nums text-amber-700">{fmtNum(line.inTransit, 0)}</td>
                    <td className="px-3 py-2 tabular-nums font-medium text-emerald-700">
                      {fmtNum(line.adjustedShip, 0)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-xs text-slate-400">Нет строк плана отгрузки — см. вкладку «Отгрузить»</p>
      )}
    </div>
  );
}
