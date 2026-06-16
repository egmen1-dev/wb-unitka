const EXPORT_COLUMNS = [
  { key: 'brand', label: 'Бренд' },
  { key: 'vendorCode', label: 'Артикул' },
  { key: 'nmId', label: 'nmId' },
  { key: 'title', label: 'Название' },
  { key: 'qty', label: 'Кол-во' },
  { key: 'offices', label: 'Склад WB' },
  { key: 'cargoTypes', label: 'Тип габарита' },
  { key: 'supplierInCatalog', label: 'В прайсе' },
];

function escapeCsvCell(value) {
  if (value == null) return '';
  const s = String(value).replace(/"/g, '""');
  return s.includes(';') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
}

function slugWarehouseLabel(label) {
  const slug = String(label || '')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'sklad';
}

export function downloadFbsPickListCsv(
  pickList,
  { filenamePrefix = 'fbs-sborka', warehouseLabel = '' } = {}
) {
  const header = EXPORT_COLUMNS.map((c) => c.label).join(';');
  const body = pickList.map((row) =>
    EXPORT_COLUMNS.map((col) => {
      if (col.key === 'supplierInCatalog') return row.supplierInCatalog ? 'да' : '';
      return escapeCsvCell(row[col.key]);
    }).join(';')
  );
  const prefix = warehouseLabel
    ? `${filenamePrefix}-${slugWarehouseLabel(warehouseLabel)}`
    : filenamePrefix;
  const blob = new Blob(['\uFEFF' + [header, ...body].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
