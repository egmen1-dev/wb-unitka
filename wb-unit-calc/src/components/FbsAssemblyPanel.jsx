import { useCallback, useMemo, useState } from 'react';
import {
  aggregateFbsPickListForGroup,
  buildCatalogLookup,
  filterPickListForSupplyGroup,
} from '@lib/wb-fbs-assembly.js';
import { fmtNum } from '../lib/format';
import { readJsonResponse } from '../lib/http';
import { downloadFbsPickListCsv } from '../lib/fbs-assembly-export';

function TabDescription({ children }) {
  return <p className="text-sm text-slate-600">{children}</p>;
}

function groupPickListByBrand(pickList) {
  const byBrand = new Map();
  for (const row of pickList) {
    const brand = row.brand?.trim() || 'Без бренда';
    const prev = byBrand.get(brand) || { brand, qty: 0, skuCount: 0, lines: [] };
    prev.qty += row.qty || 0;
    prev.skuCount += 1;
    prev.lines.push(row);
    byBrand.set(brand, prev);
  }
  return [...byBrand.values()].sort((a, b) => b.qty - a.qty);
}

function groupFilterLabel(group) {
  if (!group) return '';
  const parts = [group.officeLabel, group.cargoTypeLabel].filter(Boolean);
  if (group.isB2B) parts.push('B2B');
  return parts.join(' · ');
}

export default function FbsAssemblyPanel({
  token,
  rows = [],
  activeCatalog = null,
  hasApiKey = false,
}) {
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [selectedGroups, setSelectedGroups] = useState(new Set());
  const [query, setQuery] = useState('');
  const [onlyInCatalog, setOnlyInCatalog] = useState(false);
  const [groupFilterKey, setGroupFilterKey] = useState('');

  const catalogRows = useMemo(
    () =>
      rows.map((row) => ({
        vendorCode: row.vendorCode,
        nmId: row.nmId,
        brand: row.brand,
        title: row.title,
      })),
    [rows]
  );

  const supplierDigitKeys = useMemo(() => {
    if (!activeCatalog?.byDigitKey) return [];
    return Object.keys(activeCatalog.byDigitKey);
  }, [activeCatalog]);

  const loadOrders = useCallback(async () => {
    if (!token) {
      setError('Добавьте API-ключ WB в разделе «Данные».');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const response = await fetch('/api/unit-calc/fbs-assembly', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'load',
          catalogRows,
          supplierDigitKeys,
        }),
      });
      const { data: payload } = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить заказы');
      setData(payload);
      setSelectedGroups(new Set((payload.supplyGroups || []).map((g) => g.key)));
      setGroupFilterKey('');
      setStatus(`Новых заказов: ${payload.summary?.orderCount ?? 0}`);
    } catch (err) {
      setError(err.message || 'Ошибка загрузки');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token, catalogRows, supplierDigitKeys]);

  const createSupplies = useCallback(async () => {
    if (!token || !data?.supplyGroups?.length) return;
    const keys = [...selectedGroups];
    if (!keys.length) {
      setError('Выберите хотя бы одну группу для поставки.');
      return;
    }
    if (
      !window.confirm(
        `Создать ${keys.length} поставок в WB? Заказы перейдут в статус «на сборке». Дальше — короба и передача в доставку в ЛК WB.`
      )
    ) {
      return;
    }

    setCreating(true);
    setError('');
    setStatus('');
    try {
      const response = await fetch('/api/unit-calc/fbs-assembly', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'create-supplies',
          groupKeys: keys,
          catalogRows,
          supplierDigitKeys,
        }),
      });
      const { data: payload } = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Не удалось создать поставки');

      const ok = (payload.created || []).filter((r) => r.ok);
      const failed = (payload.created || []).filter((r) => !r.ok);
      setStatus(
        ok.length
          ? `Создано поставок: ${ok.length}${failed.length ? `, ошибок: ${failed.length}` : ''}`
          : 'Поставки не созданы'
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              lastCreated: payload.created,
              manualSteps: payload.manualSteps || prev.manualSteps,
            }
          : prev
      );
      if (ok.length) await loadOrders();
    } catch (err) {
      setError(err.message || 'Ошибка создания поставок');
    } finally {
      setCreating(false);
    }
  }, [token, data, selectedGroups, catalogRows, supplierDigitKeys, loadOrders]);

  const catalogByVendor = useMemo(
    () => buildCatalogLookup(catalogRows, { supplierDigitKeys }),
    [catalogRows, supplierDigitKeys]
  );

  const activeGroup = useMemo(
    () => (data?.supplyGroups || []).find((group) => group.key === groupFilterKey) || null,
    [data, groupFilterKey]
  );

  const groupPickList = useMemo(() => {
    const supplyGroups = data?.supplyGroups || [];
    if (data?.orders?.length) {
      return aggregateFbsPickListForGroup(
        data.orders,
        groupFilterKey,
        supplyGroups,
        catalogByVendor,
        supplierDigitKeys
      );
    }
    return filterPickListForSupplyGroup(data?.pickList || [], groupFilterKey, supplyGroups);
  }, [data, groupFilterKey, catalogByVendor, supplierDigitKeys]);

  const filteredPickList = useMemo(() => {
    let list = groupPickList;
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (row) =>
          String(row.vendorCode).toLowerCase().includes(q) ||
          String(row.title || '').toLowerCase().includes(q) ||
          String(row.brand || '').toLowerCase().includes(q) ||
          String(row.nmId).includes(q)
      );
    }
    if (onlyInCatalog) list = list.filter((row) => row.supplierInCatalog);
    return list;
  }, [groupPickList, query, onlyInCatalog]);

  const filteredOrderCount = useMemo(() => {
    if (!groupFilterKey) return data?.orders?.length ?? data?.summary?.orderCount ?? 0;
    return activeGroup?.orderCount ?? 0;
  }, [groupFilterKey, activeGroup, data]);

  const filteredSummary = useMemo(() => {
    const totalQty = filteredPickList.reduce((sum, row) => sum + (row.qty || 0), 0);
    return {
      orderCount: filteredOrderCount,
      skuCount: filteredPickList.length,
      totalQty,
    };
  }, [filteredPickList, filteredOrderCount]);

  const csvExportLabel = activeGroup
    ? `Скачать CSV (${groupFilterLabel(activeGroup)})`
    : 'Скачать CSV';

  const brandGroups = useMemo(() => groupPickListByBrand(filteredPickList), [filteredPickList]);

  function toggleGroup(key) {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 lg:px-6">
      <section className="panel">
        <h2 className="text-sm font-semibold text-slate-800">FBS — сборка заказов</h2>
        <TabDescription>
          Загружает <strong>новые</strong> сборочные задания из WB Marketplace API, собирает список
          артикулов для поставщика и при необходимости создаёт черновики поставок в кабинете WB.
        </TabDescription>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={loading || creating || !hasApiKey}
            onClick={loadOrders}
          >
            {loading ? 'Загрузка…' : 'Обновить заказы'}
          </button>
          {data?.supplyGroups?.length ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={creating || loading || !selectedGroups.size}
              onClick={createSupplies}
            >
              {creating ? 'Создание…' : `Создать поставки (${selectedGroups.size})`}
            </button>
          ) : null}
        </div>

        {!hasApiKey ? (
          <p className="mt-3 text-sm text-amber-700">
            Добавьте API-ключ с правами <strong>Marketplace</strong> в разделе «Данные».
          </p>
        ) : null}

        {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
        {status ? <p className="mt-3 text-sm text-emerald-700">{status}</p> : null}

        {data?.summary ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Новых заказов</p>
              <p className="text-lg font-semibold tabular-nums text-slate-800">
                {fmtNum(data.summary.orderCount)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">SKU / позиций</p>
              <p className="text-lg font-semibold tabular-nums text-slate-800">
                {fmtNum(data.summary.skuCount)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Единиц к сборке</p>
              <p className="text-lg font-semibold tabular-nums text-slate-800">
                {fmtNum(data.summary.totalQty)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Групп поставок</p>
              <p className="text-lg font-semibold tabular-nums text-slate-800">
                {fmtNum(data.summary.supplyGroupCount)}
              </p>
            </div>
          </div>
        ) : null}
      </section>

      {data?.manualSteps?.length ? (
        <section className="panel border-amber-100 bg-amber-50/50">
          <h3 className="text-sm font-semibold text-slate-800">После создания поставки в WB</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
            {data.manualSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-slate-500">
            API создаёт поставку и добавляет заказы. Короба, QR-коды и «передать в доставку» — только
            в{' '}
            <a
              href="https://seller.wildberries.ru/marketplace-orders-new"
              className="text-brand-600 underline"
              target="_blank"
              rel="noreferrer"
            >
              личном кабинете WB
            </a>
            .
          </p>
        </section>
      ) : null}

      {data?.lastCreated?.length ? (
        <section className="panel">
          <h3 className="text-sm font-semibold text-slate-800">Созданные поставки</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {data.lastCreated.map((item) => (
              <li
                key={`${item.groupKey}-${item.supplyId || item.error}`}
                className={`rounded-lg border px-3 py-2 ${item.ok ? 'border-emerald-100 bg-emerald-50' : 'border-rose-100 bg-rose-50'}`}
              >
                {item.ok ? (
                  <>
                    <span className="font-medium text-slate-800">{item.supplyId}</span>
                    <span className="text-slate-500">
                      {' '}
                      · {item.orderCount} заказов · {item.officeLabel} · {item.cargoTypeLabel}
                    </span>
                  </>
                ) : (
                  <span className="text-rose-700">
                    {item.officeLabel}: {item.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data?.supplyGroups?.length ? (
        <section className="panel">
          <h3 className="text-sm font-semibold text-slate-800">Группы для поставок WB</h3>
          <p className="mt-1 text-xs text-slate-500">
            WB не смешивает в одной поставке разные склады, типы габарита и cross-border. Отметьте
            группы для автосоздания.
          </p>
          <div className="mt-3 space-y-2">
            {data.supplyGroups.map((group) => (
              <label
                key={group.key}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selectedGroups.has(group.key)}
                  onChange={() => toggleGroup(group.key)}
                />
                <span>
                  <span className="font-medium text-slate-800">{group.officeLabel}</span>
                  <span className="text-slate-500">
                    {' '}
                    · {group.cargoTypeLabel}
                    {group.isB2B ? ' · B2B' : ''} · {group.orderCount} заказов
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {data?.pickList?.length ? (
        <section className="panel">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Список к сборке</h3>
              <p className="mt-1 text-xs text-slate-500">
                Агрегация по артикулу для заказа у поставщика
                {activeGroup ? ` · ${groupFilterLabel(activeGroup)}` : ''}.
              </p>
              {groupFilterKey ? (
                <p className="mt-1 text-xs text-slate-600">
                  По фильтру: {fmtNum(filteredSummary.orderCount)} заказов ·{' '}
                  {fmtNum(filteredSummary.skuCount)} SKU · {fmtNum(filteredSummary.totalQty)} шт
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                className="input w-48"
                placeholder="Поиск артикула…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={onlyInCatalog}
                  onChange={(e) => setOnlyInCatalog(e.target.checked)}
                />
                Только из прайса
              </label>
            </div>
          </div>

          {data.supplyGroups?.length ? (
            <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-600">
                  Фильтр по группе / складу — список и CSV
                </p>
                {groupFilterKey ? (
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    disabled={!filteredPickList.length}
                    onClick={() =>
                      downloadFbsPickListCsv(filteredPickList, {
                        warehouseLabel: groupFilterLabel(activeGroup),
                      })
                    }
                  >
                    {csvExportLabel}
                  </button>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    !groupFilterKey
                      ? 'bg-brand-600 text-white ring-2 ring-brand-300'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-brand-200'
                  }`}
                  onClick={() => setGroupFilterKey('')}
                >
                  Все группы
                  <span className={!groupFilterKey ? 'text-brand-100' : 'text-slate-400'}>
                    {' '}
                    · {data.orders?.length ?? data.summary?.orderCount ?? 0} заказов
                  </span>
                </button>
                {data.supplyGroups.map((group) => {
                  const active = groupFilterKey === group.key;
                  return (
                    <button
                      key={group.key}
                      type="button"
                      className={`rounded-full px-3 py-1 text-xs transition ${
                        active
                          ? 'bg-brand-600 text-white ring-2 ring-brand-300'
                          : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-brand-200'
                      }`}
                      onClick={() => setGroupFilterKey(group.key)}
                    >
                      {groupFilterLabel(group)}
                      <span className={active ? 'text-brand-100' : 'text-slate-400'}>
                        {' '}
                        · {group.orderCount} заказов
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {brandGroups.length > 1 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {brandGroups.map((g) => (
                <span
                  key={g.brand}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600"
                >
                  {g.brand}: {g.qty} шт · {g.skuCount} SKU
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2 pr-3 font-medium">Артикул</th>
                  <th className="py-2 pr-3 font-medium">nmId</th>
                  <th className="py-2 pr-3 font-medium">Название</th>
                  <th className="py-2 pr-3 font-medium text-right">Кол-во</th>
                  <th className="py-2 pr-3 font-medium">Склад WB</th>
                  <th className="py-2 font-medium">Габарит</th>
                </tr>
              </thead>
              <tbody>
                {filteredPickList.length ? (
                  filteredPickList.map((row) => (
                    <tr key={`${row.vendorCode}-${row.nmId}`} className="border-b border-slate-100">
                      <td className="py-2 pr-3 font-medium text-slate-800">{row.vendorCode}</td>
                      <td className="py-2 pr-3 tabular-nums text-slate-600">{row.nmId || '—'}</td>
                      <td className="max-w-xs truncate py-2 pr-3 text-slate-600" title={row.title}>
                        {row.title || row.brand || '—'}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold">{row.qty}</td>
                      <td className="py-2 pr-3 text-xs text-slate-500">{row.offices}</td>
                      <td className="py-2 text-xs text-slate-500">{row.cargoTypes}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-sm text-slate-500">
                      Нет позиций по выбранным фильтрам
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : data && !loading ? (
        <section className="panel">
          <p className="text-sm text-slate-500">Новых сборочных заданий нет — все уже в работе или отгружены.</p>
        </section>
      ) : null}
    </div>
  );
}
