import { useEffect, useMemo, useRef, useState } from 'react';
import { useScrollRestore } from '../lib/use-scroll-restore';
import { fmtMoney, fmtNum, fmtPct, marginClass, profitClass } from '../lib/format';
import { primaryProfit, resolveScheme } from '@lib/unit-scheme.js';
import { getProductOverride } from '../lib/product-overrides';
import { MARGIN_BUCKETS, rowMatchesMarginFilter } from '../lib/margin-insights';

const MONEY_KEYS = new Set([
  'purchasePrice',
  'salePrice',
  'ourPrice',
  'basePrice',
  'taxRub',
  'logisticsFbo',
  'logisticsFbs',
  'acquiringRub',
  'advertisingRub',
  'storageRub',
  'acceptanceRub',
  'processingRub',
  'packagingCost',
  'defectRub',
  'fboCommissionRub',
  'fbsCommissionRub',
  'manualExtraCosts',
  'profitFbo',
  'profitFbs',
]);

const PCT_KEYS = new Set([
  'marginFbo',
  'marginFbs',
  'discountPct',
  'sppPct',
  'fbsDeliverySurcharge',
]);

const CORE_COLUMN_KEYS = new Set([
  'nmId',
  'vendorCode',
  'title',
  'orders7d',
  'fbsAvgDeliveryHours',
  'purchasePrice',
  'salePrice',
  'packagingCost',
  'processingRub',
  'manualExtraCosts',
  'volumeLiters',
  'fbsCoeff',
  'logisticsFbs',
  'fbsCommissionRub',
  'profitFbs',
  'marginFbs',
  'stockFbs',
]);

const COLUMNS = [
  { key: 'nmId', label: 'Арт. WB', sticky: true },
  { key: 'vendorCode', label: 'Арт. продавца', sticky: true },
  { key: 'brand', label: 'Бренд' },
  { key: 'title', label: 'Название', wide: true },
  { key: 'stockFbs', label: 'FBS', hint: 'Остаток на складе продавца' },
  { key: 'stockFbo', label: 'FBO' },
  { key: 'orders7d', label: 'Заказы 7д', sortable: true, hint: 'Заказы за 7 дней из WB' },
  { key: 'fbsAvgDeliveryHours', label: 'Дост., ч', sortable: true, hint: 'Ср. время доставки из WB (timeToReady)' },
  { key: 'buyoutRate', label: 'Выкуп', hint: 'Факт из отчёта · без аналитики 100%' },
  { key: 'purchasePrice', label: 'Закупка', overrideField: 'purchase', purchase: true },
  { key: 'basePrice', label: 'Базовая' },
  { key: 'ourPrice', label: 'Наша цена' },
  { key: 'salePrice', label: 'Продажа' },
  { key: 'discountPct', label: 'Скидка' },
  { key: 'sppPct', label: 'СПП' },
  { key: 'volumeLiters', label: 'Объём, л', hint: '≤1 л: фикс. тариф 23–32₽ × коэфф.' },
  { key: 'fbsCoeff', label: 'Коэфф.', hint: 'Коэфф. склада FBS из WB API' },
  {
    key: 'logisticsFbs',
    label: 'Лог. FBS',
    sortable: true,
    hint: 'Тариф × коэфф. склада отгрузки · сверка с отчётом FBS',
  },
  { key: 'logisticsFbo', label: 'Лог. FBO' },
  { key: 'taxRub', label: 'Налог' },
  { key: 'acquiringRub', label: 'Эквайринг', hint: '% от суммы, оплаченной покупателем (retail)' },
  { key: 'advertisingDrr', label: 'ДРР', hint: 'Доля рекламных расходов за 30 д (API Продвижение)' },
  { key: 'advertisingRub', label: 'Реклама ₽' },
  {
    key: 'storageRub',
    label: 'Хран. FBO',
    hint: 'Только при остатке FBO · коэфф. склада WB',
  },
  { key: 'acceptanceRub', label: 'Приёмка' },
  { key: 'processingRub', label: 'Обработка', overrideField: 'processingCost' },
  { key: 'packagingCost', label: 'Упаковка', overrideField: 'packagingCost' },
  { key: 'defectRub', label: 'Брак' },
  {
    key: 'fbsCommissionRub',
    label: 'Ком. FBS',
    sortable: true,
    hint: 'Категория WB + надбавка за время доставки',
  },
  { key: 'fboCommissionRub', label: 'Ком. FBO' },
  {
    key: 'manualExtraCosts',
    label: 'Доп.',
    overrideField: 'extraCosts',
    hint: 'Ручные доп. расходы ₽/ед (по умолчанию 0)',
  },
  { key: 'profitFbs', label: 'Прибыль FBS', sortable: true },
  { key: 'marginFbs', label: 'Маржа FBS', sortable: true },
  { key: 'profitFbo', label: 'Прибыль FBO' },
  { key: 'marginFbo', label: 'Маржа FBO' },
];

function storageTitle(row) {
  if (row.storageSource === 'actual') {
    return `Факт из отчёта WB: ${fmtMoney(row.storageRub)}/ед · остаток FBO ${row.stockFbo ?? 0}`;
  }
  if (row.storageSource === 'calculated') {
    const wh = row.fboWarehouseName ? ` · склад ${row.fboWarehouseName}` : '';
    return `FBO: ${fmtMoney(row.storagePerDay)}/сут × ${row.storageDays} дн = ${fmtMoney(row.storageRub)}${wh} · коэфф. ${fmtNum(row.storageCoeff ?? 1, 2)}`;
  }
  if (row.storageSource === 'no_stock') {
    return 'Нет остатка FBO на складе WB — хранение не начисляется';
  }
  return 'Хранение не учитывается';
}

function logisticsTitle(row, mode) {
  const liters = row.billedLiters ?? row.volumeLiters;
  const base = mode === 'fbs' ? row.fbsBaseDelivery : row.baseDelivery;
  const coeff = mode === 'fbs' ? row.fbsCoeff : row.warehouseCoeff;
  const wh = mode === 'fbs' ? row.fbsWarehouseName : row.fboWarehouseName;
  const total = mode === 'fbs' ? row.logisticsFbs : row.logisticsFbo;
  const source = mode === 'fbs' ? row.logisticsFbsSource : row.logisticsFboSource;

  if (source === 'actual') {
    return `Факт из отчёта WB: ${fmtMoney(total)}/ед`;
  }
  if (source === 'actual_available' && row.actualLogisticsRub > 0 && mode === 'fbs') {
    return `Расчёт ${fmtMoney(total)}/ед (факт FBS в отчёте: ${fmtMoney(row.actualLogisticsRub)}/ед)`;
  }

  const parts = [];
  if (row.volumeLiters != null) {
    parts.push(`объём ${fmtNum(row.volumeLiters, 2)} л`);
    if (row.subLiterTariff != null) {
      parts.push(`диапазон ${fmtNum(row.subLiterTariff, 0)} ₽ × коэфф.`);
    } else if (row.billedLiters != null && row.billedLiters > 1) {
      parts.push(`тариф 46+14×(л−1)`);
    }
  } else if (liters != null) {
    parts.push(`${fmtNum(liters, 0)} л`);
  }
  if (base != null) parts.push(`доставка ${fmtMoney(base)}`);
  if (coeff) parts.push(`коэфф. ×${fmtNum(coeff, 2)}`);
  if (wh) parts.push(wh);
  if (row.logisticsCompare) {
    const c = row.logisticsCompare;
    const sign = c.match === 'ok' ? '≈' : c.match === 'low' ? 'факт выше' : 'факт ниже';
    parts.push(`${sign} ${fmtMoney(c.actual)} факт / ${fmtMoney(c.calc)} расчёт`);
    if (c.forwardPerSale != null) {
      parts.push(`отчёт: прямая ${fmtMoney(c.forwardPerSale)} + обр. ${fmtMoney(c.returnPerSale || 0)}`);
    }
    if (c.buyout != null) parts.push(`выкуп ${fmtPct(c.buyout)}`);
    if (c.reasons?.length) parts.push(c.reasons[0]);
  } else if (row.actualLogisticsRub > 0 && mode === 'fbs') {
    parts.push(`факт FBS ${fmtMoney(row.actualLogisticsRub)}`);
  }
  parts.push(`итог ${fmtMoney(total)}`);
  return `${mode.toUpperCase()}: ${parts.join(' · ')}`;
}

function fbsCommissionTitle(row) {
  const baseRate = row.fbsCategoryRate - (row.fbsDeliverySurcharge || 0);
  const parts = [`кат. ${fmtPct(baseRate)} (WB)`];
  if (row.fbsDeliverySurcharge > 0) {
    parts.push(`+${fmtPct(row.fbsDeliverySurcharge)} за ${row.fbsAvgDeliveryHours}ч`);
  }
  parts.push(`+ ${fmtPct(row.fboTotalRate - row.fboCategoryRate)} доп.`);
  parts.push(`= ${fmtPct(row.fbsTotalRate)} итог`);
  return parts.join(' · ');
}

function cellValue(row, key) {
  const value = row[key];
  if (key === 'title') return value ? String(value).slice(0, 48) : '—';
  if (key === 'buyoutRate') return value != null ? fmtPct(value) : '—';
  if (key === 'advertisingDrr') {
    if (value == null || value <= 0) return '—';
    return fmtPct(value);
  }
  if (MONEY_KEYS.has(key)) return fmtMoney(value);
  if (key === 'volumeLiters') {
    if (value == null) return '—';
    const tier = row.subLiterTariff;
    if (tier != null) return `${fmtNum(value, 2)} → ${tier}₽`;
    return fmtNum(value, 2);
  }
  if (key === 'fbsCoeff') return value != null ? fmtNum(value, 2) : '—';
  if (PCT_KEYS.has(key)) return fmtPct(value);
  if (key === 'fbsAvgDeliveryHours') return value != null ? fmtNum(value, 1) : '—';
  if (value == null || value === '') return '—';
  return value;
}

function exportCsv(rows, columns) {
  const header = columns.map((c) => c.label).join(';');
  const lines = rows.map((row) =>
    columns
      .map((col) => {
        const v = row[col.key];
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""');
        return s.includes(';') ? `"${s}"` : s;
      })
      .join(';')
  );
  const blob = new Blob(['\uFEFF' + [header, ...lines].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `unitka-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ProductsTable({
  rows,
  settings = {},
  purchases,
  productOverrides,
  onPurchaseChange,
  onProductOverrideChange,
  onRowClick,
  marginFilter = null,
  onMarginFilterClear,
  highlightNmId = null,
  onHighlightConsumed,
  dashboardQuery = '',
  onDashboardQueryConsumed,
}) {
  const [query, setQuery] = useState('');
  const [onlyWithPurchase, setOnlyWithPurchase] = useState(false);
  const [onlyProfitable, setOnlyProfitable] = useState(false);
  const scheme = resolveScheme(settings);
  const [sortKey, setSortKey] = useState('marginFbs');
  const [sortDir, setSortDir] = useState('desc');
  const [compactView, setCompactView] = useState(true);
  const tableRef = useRef(null);

  const visibleColumns = useMemo(
    () => (compactView ? COLUMNS.filter((col) => CORE_COLUMN_KEYS.has(col.key)) : COLUMNS),
    [compactView]
  );

  const marginFilterLabel = useMemo(() => {
    if (!marginFilter) return '';
    if (marginFilter === 'attention') return 'маржа < 5%';
    return MARGIN_BUCKETS.find((b) => b.id === marginFilter)?.label || marginFilter;
  }, [marginFilter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows.filter((row) => {
      if (onlyWithPurchase && !row.purchasePrice) return false;
      if (onlyProfitable && !(primaryProfit(row, scheme) > 0)) return false;
      if (!rowMatchesMarginFilter(row, marginFilter, scheme)) return false;
      if (!q) return true;
      return [row.nmId, row.vendorCode, row.brand, row.title]
        .filter(Boolean)
        .some((part) => String(part).toLowerCase().includes(q));
    });

    if (sortKey) {
      list = [...list].sort((a, b) => {
        const av = a[sortKey] ?? -Infinity;
        const bv = b[sortKey] ?? -Infinity;
        return sortDir === 'asc' ? av - bv : bv - av;
      });
    }

    return list;
  }, [rows, query, onlyWithPurchase, onlyProfitable, marginFilter, sortKey, sortDir, scheme]);

  useScrollRestore(tableRef, 'wb-unit-calc:scroll:calc', filtered.length > 0);

  useEffect(() => {
    if (!dashboardQuery) return undefined;
    setQuery(dashboardQuery);
    onDashboardQueryConsumed?.();
  }, [dashboardQuery, onDashboardQueryConsumed]);

  useEffect(() => {
    if (!highlightNmId || !tableRef.current) return undefined;

    const rowEl = tableRef.current.querySelector(`[data-nm-id="${highlightNmId}"]`);
    if (!rowEl) return undefined;

    rowEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const timer = setTimeout(() => onHighlightConsumed?.(), 2500);
    return () => clearTimeout(timer);
  }, [highlightNmId, filtered, onHighlightConsumed]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function renderEditableCell(row, col) {
    const vendor = String(row.vendorCode || '');

    if (col.purchase) {
      const stored = purchases[vendor];
      const value = stored != null ? stored : row.purchasePrice ?? '';
      return (
        <input
          className="input w-24 px-2 py-1 text-xs"
          type="number"
          min="0"
          step="0.01"
          placeholder="авто"
          title={`Сейчас: ${fmtMoney(row.purchasePrice)}`}
          value={value}
          onChange={(e) => onPurchaseChange(vendor, e.target.value)}
        />
      );
    }

    const override = getProductOverride(productOverrides, vendor);
    const field = col.overrideField;
    const value = override[field] != null ? override[field] : '';
    const current = row[col.key];

    return (
      <input
        className={`input w-24 px-2 py-1 text-xs ${value !== '' ? 'ring-1 ring-brand-300' : ''}`}
        type="number"
        min="0"
        step="0.01"
        placeholder={current != null ? String(Number(current).toFixed(2)) : 'авто'}
        title={value !== '' ? `Ручная правка · авто ${fmtMoney(current)}` : `Авто: ${fmtMoney(current)}`}
        value={value}
        onChange={(e) => onProductOverrideChange(vendor, field, e.target.value)}
      />
    );
  }

  return (
    <section className="panel overflow-hidden p-0">
      <div className="border-b border-slate-200 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Товары</h2>
            <p className="mt-1 text-xs text-slate-500">
              {filtered.length} из {rows.length}. Жёлтая рамка — ручная правка закупки, упаковки, обработки, доп.
              расходов. Красная ячейка — маржа &lt; 5%.
              {marginFilter ? (
                <>
                  {' '}
                  · фильтр: <span className="font-medium text-brand-700">{marginFilterLabel}</span>
                  <button
                    type="button"
                    className="ml-1 text-brand-700 underline"
                    onClick={() => onMarginFilterClear?.()}
                  >
                    сбросить
                  </button>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" onClick={() => exportCsv(filtered, visibleColumns)}>
              CSV
            </button>
            <input
              className="input w-56"
              placeholder="Поиск…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={compactView}
                onChange={(e) => setCompactView(e.target.checked)}
              />
              Компактно
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={onlyWithPurchase}
                onChange={(e) => setOnlyWithPurchase(e.target.checked)}
              />
              С закупкой
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={onlyProfitable}
                onChange={(e) => setOnlyProfitable(e.target.checked)}
              />
              Прибыль &gt; 0
            </label>
          </div>
        </div>
      </div>

      <div ref={tableRef} className="table-scroll max-h-[calc(100vh-380px)] overflow-auto">
        <table className="min-w-max w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
            <tr>
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  className={`whitespace-nowrap px-3 py-2 font-medium ${
                    col.sticky ? 'sticky left-0 z-20 bg-slate-100 shadow-[1px_0_0_#e2e8f0]' : ''
                  } ${col.wide ? 'min-w-[220px]' : ''} ${col.sortable ? 'cursor-pointer select-none' : ''}`}
                  onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                  title={col.hint}
                >
                  {col.label}
                  {col.sortable && sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.nmId}
                data-nm-id={row.nmId}
                className={`cursor-pointer border-t border-slate-100 hover:bg-brand-50/50 ${
                  highlightNmId === row.nmId ? 'bg-amber-50 ring-2 ring-inset ring-amber-300' : ''
                }`}
                onClick={() => onRowClick?.(row)}
              >
                {visibleColumns.map((col) => {
                  if (col.purchase || col.overrideField) {
                    return (
                      <td
                        key={col.key}
                        className="px-2 py-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {renderEditableCell(row, col)}
                      </td>
                    );
                  }

                  const raw = row[col.key];
                  let className = 'text-slate-700';
                  if (col.key === 'marginFbo' || col.key === 'marginFbs') {
                    className = marginClass(raw);
                  } else if (col.key === 'profitFbo' || col.key === 'profitFbs') {
                    className = profitClass(raw);
                  }

                  let title = col.hint;
                  if (col.key === 'title') title = row.title;
                  if (col.key === 'storageRub') title = storageTitle(row);
                  if (col.key === 'logisticsFbs') title = logisticsTitle(row, 'fbs');
                  if (col.key === 'logisticsFbo') title = logisticsTitle(row, 'fbo');
                  if (col.key === 'fbsCommissionRub') title = fbsCommissionTitle(row);
                  if (col.key === 'acquiringRub' && row.acquiringBasePrice) {
                    const src =
                      row.acquiringSource === 'actual'
                        ? 'факт из отчёта'
                        : row.acquiringSource === 'retail-rate'
                          ? `${fmtPct(row.acquiringRate)} от retail`
                          : `${fmtPct(row.acquiringRate)} оценка`;
                    title = `Оплачено покупателем: ${fmtMoney(row.acquiringBasePrice)} · ${src}`;
                  }
                  if (col.key === 'buyoutRate') {
                    title = row.buyoutFromReport
                      ? `Факт FBS из отчёта (${fmtPct(row.buyoutRateFbs ?? row.buyoutRate)})`
                      : 'Нет аналитики · для логистики 100%';
                  }
                  if (col.key === 'advertisingDrr' && row.advertisingDrr > 0) {
                    title = `Расход ${fmtMoney(row.adSpend)} за 30 д · ${fmtPct(row.advertisingDrr)} от продаж`;
                  }

                  return (
                    <td
                      key={col.key}
                      className={`whitespace-nowrap px-3 py-2 ${className} ${
                        col.sticky ? 'sticky left-0 bg-white shadow-[1px_0_0_#e2e8f0]' : ''
                      }`}
                      title={title}
                    >
                      {cellValue(row, col.key)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
