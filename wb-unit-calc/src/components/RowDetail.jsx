import { fmtMoney, fmtPct } from '../lib/format';

const SHARED_COSTS = [
  ['purchase', 'Закупка'],
  ['usn', 'УСН'],
  ['vat', 'НДС'],
  ['packaging', 'Упаковка'],
  ['defect', 'Брак / потери'],
  ['acquiring', 'Эквайринг'],
  ['acceptance', 'Приёмка'],
  ['processing', 'Обработка'],
  ['advertising', 'Реклама (ДРР)'],
  ['manualExtra', 'Доп. расходы'],
];

export default function RowDetail({ row, onClose }) {
  if (!row) return null;
  const b = row.costBreakdown || {};

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">Арт. {row.vendorCode} · WB {row.nmId}</p>
            <h3 className="text-base font-semibold text-slate-900">{row.title}</h3>
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-slate-500">Базовая / наша / продажа</dt>
            <dd className="font-medium">
              {fmtMoney(row.basePrice)} / {fmtMoney(row.ourPrice)} / {fmtMoney(row.salePrice)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Остаток FBS / FBO</dt>
            <dd className="font-medium">
              {row.stockFbs ?? 0} / {row.stockFbo ?? 0}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Комиссия FBS</dt>
            <dd className="font-medium">
              {fmtMoney(row.fbsCommissionRub)}
              <span className="block text-xs font-normal text-slate-500">
                кат. {fmtPct(row.fbsCategoryRate - (row.fbsDeliverySurcharge || 0))}
                {row.fbsDeliverySurcharge > 0
                  ? ` +${fmtPct(row.fbsDeliverySurcharge)} (${row.fbsAvgDeliveryHours}ч)`
                  : ''}
                {' '}
                + {fmtPct(row.fboTotalRate - row.fboCategoryRate)} доп.
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Логистика FBS</dt>
            <dd className="font-medium">
              {fmtMoney(row.logisticsFbs)}
              <span className="block text-xs font-normal text-slate-500">
                база {fmtMoney(row.fbsBaseDelivery)}
                {row.logisticsIndicesApplied && row.localizationIndex != null && row.localizationIndex !== 1
                  ? ` · ИЛ ×${Number(row.localizationIndex).toFixed(2)}`
                  : ''}
                {row.logisticsIndicesApplied && row.logisticsIrpSurcharge > 0
                  ? ` · ИРП +${fmtMoney(row.logisticsIrpSurcharge)}`
                  : ''}
                {row.fbsCoeff ? ` · коэфф. ×${Number(row.fbsCoeff).toFixed(2)}` : ''}
                {row.fbsWarehouseName ? ` · ${row.fbsWarehouseName}` : ''}
                {row.actualLogisticsRub > 0 ? ` · факт ${fmtMoney(row.actualLogisticsRub)}` : ''}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Прибыль FBS</dt>
            <dd className="font-medium text-emerald-700">{fmtMoney(row.profitFbs)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Маржа FBS</dt>
            <dd className="font-medium">{fmtPct(row.marginFbs)}</dd>
          </div>
        </dl>

        <h4 className="mt-4 text-sm font-semibold text-slate-800">Расходы FBS</h4>
        <ul className="mt-2 space-y-1 text-sm">
          <li className="flex justify-between border-b border-slate-50 py-1">
            <span className="text-slate-600">Комиссия FBS</span>
            <span className="font-medium">{fmtMoney(b.commissionFbs ?? row.fbsCommissionRub)}</span>
          </li>
          <li className="flex justify-between border-b border-slate-50 py-1">
            <span className="text-slate-600">Логистика FBS</span>
            <span className="font-medium">{fmtMoney(b.logisticsFbs ?? row.logisticsFbs)}</span>
          </li>
          {SHARED_COSTS.map(([key, label]) => (
            <li key={key} className="flex justify-between border-b border-slate-50 py-1">
              <span className="text-slate-600">{label}</span>
              <span className="font-medium">{fmtMoney(b[key])}</span>
            </li>
          ))}
          <li className="flex justify-between border-b border-slate-50 py-1 text-slate-400">
            <span>Хранение FBO</span>
            <span>не в FBS ({fmtMoney(row.storageRub)})</span>
          </li>
        </ul>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">Сравнение с FBO</summary>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-700">
            <div>
              <dt className="text-slate-500">Логистика FBO</dt>
              <dd>{fmtMoney(row.logisticsFbo)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Комиссия FBO</dt>
              <dd>{fmtMoney(row.fboCommissionRub)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Прибыль FBO</dt>
              <dd>{fmtMoney(row.profitFbo)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Маржа FBO</dt>
              <dd>{fmtPct(row.marginFbo)}</dd>
            </div>
          </dl>
        </details>
      </div>
    </div>
  );
}
