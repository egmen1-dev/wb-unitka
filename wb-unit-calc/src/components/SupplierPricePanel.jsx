import { useMemo, useRef, useState } from 'react';
import {
  applyCatalogToPurchases,
  countCatalogMatches,
  formatCatalogDate,
  formatFileSize,
  getActiveCatalog,
  parseSupplierFile,
} from '../lib/supplier-catalog';

function UploadIcon() {
  return (
    <svg className="h-8 w-8 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 18H15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0015 4.5h-1.5m-6 0H6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 006 22.5h1.5m6 0h1.5" />
    </svg>
  );
}

export default function SupplierPricePanel({
  catalogState,
  onCatalogStateChange,
  vendorCodes,
  productCount,
  onApplyPurchases,
  onStatus,
}) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const activeCatalog = useMemo(() => getActiveCatalog(catalogState), [catalogState]);
  const sortedItems = useMemo(
    () => [...(catalogState?.items || [])].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
    [catalogState]
  );

  async function processFile(file) {
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.xls') && !lower.endsWith('.xlsx') && !lower.endsWith('.csv')) {
      setError('Поддерживаются файлы XLS, XLSX и CSV');
      return;
    }

    setUploading(true);
    setError('');
    try {
      const parsed = await parseSupplierFile(file);
      const entry = {
        id: `sup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        fileName: parsed.fileName || file.name,
        uploadedAt: new Date().toISOString(),
        fileSize: parsed.fileSize || file.size,
        totalItems: parsed.totalItems || Object.keys(parsed.byDigitKey || {}).length,
        sheetName: parsed.sheetName || '',
        byDigitKey: parsed.byDigitKey || {},
      };

      const matchedCount = applyCatalogToPurchases(vendorCodes, entry.byDigitKey, {}).matched;

      onApplyPurchases((prev) =>
        applyCatalogToPurchases(vendorCodes, entry.byDigitKey, prev).purchases
      );

      onCatalogStateChange({
        activeId: entry.id,
        items: [entry, ...(catalogState?.items || [])],
      });

      onStatus?.(
        `Прайс «${entry.fileName}»: ${entry.totalItems.toLocaleString('ru-RU')} позиций · совпало ${matchedCount} из ${productCount || vendorCodes.length || '—'}`
      );
    } catch (err) {
      setError(err.message || 'Не удалось загрузить файл');
      onStatus?.(`Ошибка прайса: ${err.message || 'не удалось прочитать файл'}`);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragOver(false);
    processFile(event.dataTransfer.files?.[0]);
  }

  function activateCatalog(item) {
    onApplyPurchases((prev) => applyCatalogToPurchases(vendorCodes, item.byDigitKey, prev).purchases);
    onCatalogStateChange({
      ...catalogState,
      activeId: item.id,
    });
    const matched = countCatalogMatches(vendorCodes, item.byDigitKey);
    onStatus?.(`Активен прайс «${item.fileName}» · совпало ${matched} артикулов`);
  }

  function deleteCatalog(id) {
    const nextItems = (catalogState?.items || []).filter((item) => item.id !== id);
    const nextActiveId =
      catalogState?.activeId === id ? nextItems[0]?.id || null : catalogState?.activeId;

    onCatalogStateChange({
      activeId: nextActiveId,
      items: nextItems,
    });
    setConfirmDeleteId(null);

    const nextActive = nextItems.find((item) => item.id === nextActiveId);
    if (nextActive) {
      onApplyPurchases((prev) =>
        applyCatalogToPurchases(vendorCodes, nextActive.byDigitKey, prev).purchases
      );
      const matched = countCatalogMatches(vendorCodes, nextActive.byDigitKey);
      onStatus?.(`Прайс удалён · активен «${nextActive.fileName}» (${matched} совпадений)`);
    } else {
      onApplyPurchases({});
      onStatus?.('Все прайсы удалены · закупки из файлов сброшены');
    }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Прайс поставщика</h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            Загрузите Excel с артикулами и ценами — система сопоставит их с WB по цифрам в артикуле и сразу
            пересчитает юнитку.
          </p>
        </div>
        {activeCatalog ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Активен: {activeCatalog.fileName}
          </span>
        ) : (
          <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
            Прайс не загружен
          </span>
        )}
      </div>

      <div
        className={`mt-4 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
          dragOver
            ? 'border-brand-400 bg-brand-50/60'
            : 'border-slate-200 bg-slate-50/80 hover:border-brand-300 hover:bg-brand-50/30'
        } ${uploading ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => processFile(e.target.files?.[0])}
        />
        <div className="mx-auto flex max-w-md flex-col items-center gap-2">
          <UploadIcon />
          <p className="text-sm font-medium text-slate-700">
            {uploading ? 'Читаем файл…' : 'Перетащите прайс сюда или нажмите для выбора'}
          </p>
          <p className="text-xs text-slate-500">XLS, XLSX · колонки «Артикул» и «Цена»</p>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

      {activeCatalog ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-emerald-100">
                <FileIcon />
              </div>
              <div>
                <p className="font-medium text-slate-800">{activeCatalog.fileName}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Загружен {formatCatalogDate(activeCatalog.uploadedAt)} · {formatFileSize(activeCatalog.fileSize)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-center">
              <div className="rounded-lg bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100">
                <p className="text-lg font-semibold text-slate-800">
                  {activeCatalog.totalItems.toLocaleString('ru-RU')}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-slate-500">в прайсе</p>
              </div>
              <div className="rounded-lg bg-white px-3 py-2 shadow-sm ring-1 ring-emerald-100">
                <p className="text-lg font-semibold text-emerald-700">
                  {countCatalogMatches(vendorCodes, activeCatalog.byDigitKey).toLocaleString('ru-RU')}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-slate-500">совпало с WB</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {sortedItems.length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">История загрузок</h3>
            <span className="text-xs text-slate-400">{sortedItems.length} файл(ов)</span>
          </div>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {sortedItems.map((item) => {
              const isActive = item.id === catalogState?.activeId;
              const matched = countCatalogMatches(vendorCodes, item.byDigitKey);

              return (
                <li
                  key={item.id}
                  className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
                    isActive ? 'bg-emerald-50/50' : 'bg-white'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-800">{item.fileName}</p>
                      {isActive ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                          активен
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatCatalogDate(item.uploadedAt)} · {item.totalItems.toLocaleString('ru-RU')} поз. ·{' '}
                      {matched} совпадений · {formatFileSize(item.fileSize)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {!isActive ? (
                      <button type="button" className="btn-secondary text-xs" onClick={() => activateCatalog(item)}>
                        Сделать активным
                      </button>
                    ) : null}
                    {confirmDeleteId === item.id ? (
                      <>
                        <button
                          type="button"
                          className="btn text-xs text-rose-700 hover:bg-rose-50"
                          onClick={() => deleteCatalog(item.id)}
                        >
                          Да, удалить
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Отмена
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn text-xs text-slate-500 hover:bg-slate-100 hover:text-rose-700"
                        onClick={() => setConfirmDeleteId(item.id)}
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-slate-400">
            Старые прайсы можно удалить — данные хранятся в облаке команды. Загрузите новый файл, когда цены
            обновятся.
          </p>
        </div>
      ) : null}
    </section>
  );
}
