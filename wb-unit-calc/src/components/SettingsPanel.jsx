import { settingsFromForm, settingsToForm } from '@lib/unit-economics/settings.js';

const NUMBER_FIELDS = [
  {
    key: 'taxRate',
    label: 'УСН «Доходы», %',
    step: 0.1,
    hint: '6% от retail покупателя (retail_amount)',
  },
  {
    key: 'vatRate',
    label: 'НДС, %',
    step: 0.1,
    hint: '5% при УСН+НДС; из retail с НДС → ×5/105',
  },
  { key: 'extraCommissionRate', label: 'Доп. комиссия WB, %', step: 0.01 },
  { key: 'buyoutRate', label: '% выкупа (справочно)', step: 1, hint: 'По артикулам: факт из отчёта или 100%' },
  { key: 'defectRate', label: 'Брак / потери, %', step: 0.1 },
  {
    key: 'acquiringRate',
    label: 'Эквайринг, %',
    step: 0.01,
    hint: '% от суммы, которую покупатель оплатил (retail_amount в отчёте WB)',
  },
  { key: 'advertisingDrr', label: 'ДРР по умолчанию, %', step: 0.1, hint: 'Если нет факта по артикулу' },
  { key: 'defaultPackagingCost', label: 'Упаковка по умолч., ₽', step: 1 },
  { key: 'logisticsFirstLiter', label: 'FBO: 1-й литр, ₽', step: 1 },
  { key: 'logisticsAdditionalLiter', label: 'FBO: доп. литр, ₽', step: 1 },
  { key: 'fbsFirstLiter', label: 'FBS: 1-й литр, ₽', step: 1 },
  { key: 'fbsAdditionalLiter', label: 'FBS: доп. литр, ₽', step: 1 },
  { key: 'fbsCoeff', label: 'Коэфф. склада FBS', step: 0.1 },
  { key: 'fbsCommissionMarkup', label: 'FBS: +к FBO, %', step: 0.1, hint: 'По умолчанию 3,5 п.п.' },
  { key: 'returnLogisticsMarkup', label: 'Наценка возврата, %', step: 0.01 },
  { key: 'defaultWarehouseCoeff', label: 'Коэфф. склада FBO', step: 0.1 },
  {
    key: 'localizationIndex',
    label: 'Индекс локализации (ИЛ)',
    step: 0.01,
    hint: 'Из кабинета WB → Тарифы складов. 1 = без изменений, 0,9 = −10% к литровой части',
  },
  {
    key: 'salesDistributionIndex',
    label: 'ИРП, % от цены',
    step: 0.01,
    hint: 'Индекс распределения продаж. 0 при локализации ≥60%. Вводите как %: 1,05 = 1,05%',
  },
  { key: 'storageBasePerLiter', label: 'Хранение: база ₽/л/сут', step: 0.01 },
  { key: 'storageAdditionalPerLiter', label: 'Хранение: доп. литр', step: 0.01 },
  { key: 'storageCoeff', label: 'Коэфф. хранения', step: 0.1 },
  { key: 'storageDays', label: 'Дней хранения FBO', step: 1, hint: 'Оборот на складе WB' },
  { key: 'acceptanceCostPerUnit', label: 'Приёмка, ₽/ед', step: 0.1 },
  { key: 'processingCostPerUnit', label: 'Обработка, ₽/ед', step: 0.1 },
];

const BOOL_FIELDS = [
  { key: 'includeLogisticsIndices', label: 'ИЛ и ИРП в расчётной логистике' },
  { key: 'useBuyoutWeightedLogistics', label: 'Логистика с учётом % выкупа' },
  { key: 'preferActualRates', label: 'Факт из отчётов WB (эквайринг, логистика…)' },
  { key: 'includeAcquiring', label: 'Учитывать эквайринг' },
  { key: 'includeStorage', label: 'Учитывать хранение FBO' },
  { key: 'includeAcceptance', label: 'Учитывать приёмку' },
  { key: 'includeProcessing', label: 'Учитывать обработку' },
  { key: 'includeAdvertising', label: 'Учитывать рекламу' },
  { key: 'includeVat', label: 'Учитывать НДС в расчёте' },
  { key: 'vatIncludedInPrice', label: 'НДС уже в цене покупателя (retail)' },
];

function formatDate(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export default function SettingsPanel({
  settings,
  onChange,
  open,
  onToggle,
  teamMode,
  settingsUpdatedAt,
  workspaceUpdatedAt,
  embedded = false,
}) {
  const form = settingsToForm(settings);

  function updateField(key, value) {
    onChange(settingsFromForm({ ...form, [key]: value }));
  }

  const header = (
    <div className="flex w-full items-center justify-between text-left">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Настройки расчёта</h2>
          {teamMode ? (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700 ring-1 ring-brand-200">
              Общие для команды
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-slate-500">Тарифы WB, налог, логистика, хранение FBO, реклама</p>
        {teamMode && (settingsUpdatedAt || workspaceUpdatedAt) ? (
          <p className="mt-1 text-xs text-emerald-700">
            {settingsUpdatedAt
              ? `Изменены ${formatDate(settingsUpdatedAt)}`
              : `Из облака ${formatDate(workspaceUpdatedAt)}`}
          </p>
        ) : null}
      </div>
      {!embedded ? <span className="text-slate-400">{open ? '▲' : '▼'}</span> : null}
    </div>
  );

  return (
    <section className="panel">
      {embedded ? (
        header
      ) : (
        <button type="button" className="w-full" onClick={onToggle}>
          {header}
        </button>
      )}

      {open ? (
        <>
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <strong>Хранение FBO</strong> — только если товар лежит на складе WB (остаток FBO &gt; 0). Коэффициент
            и тариф берутся из API WB для конкретного склада. В прибыли FBS не входит.
          </div>
          <div className="mt-2 rounded-lg border border-violet-100 bg-violet-50/80 px-3 py-2 text-xs text-violet-900">
            <strong>Основной режим — FBS.</strong> До 1 л — фикс. тариф диапазона (23–32₽) × коэфф. склада,
            не объём×₽/л. Свыше 1 л — (46 + 14×(л−1)) × коэфф. Сверка с отчётом по FBS.
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {NUMBER_FIELDS.map((field) => (
              <label key={field.key} className="block text-sm">
                <span className="mb-1 block text-slate-600">
                  {field.label}
                  {field.hint ? (
                    <span className="block text-xs font-normal text-slate-400">{field.hint}</span>
                  ) : null}
                </span>
                <input
                  className="input"
                  type="number"
                  step={field.step}
                  value={form[field.key]}
                  onChange={(e) => updateField(field.key, e.target.value)}
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-4">
            {BOOL_FIELDS.map((field) => (
              <label key={field.key} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(form[field.key])}
                  onChange={(e) => updateField(field.key, e.target.checked)}
                />
                {field.label}
              </label>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
