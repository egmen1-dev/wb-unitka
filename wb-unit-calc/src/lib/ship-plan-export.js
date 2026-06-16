import * as XLSX from 'xlsx';

const EXPORT_COLUMNS = [
  { key: 'warehouseName', label: 'Склад' },
  { key: 'vendorCode', label: 'Артикул' },
  { key: 'nmId', label: 'nmId' },
  { key: 'shipQty', label: 'Кол-во' },
  { key: 'regionLabel', label: 'Регион' },
];

function escapeCsvCell(value) {
  if (value == null) return '';
  const s = String(value).replace(/"/g, '""');
  return s.includes(';') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
}

function exportRows(lines) {
  return lines.map((line) =>
    EXPORT_COLUMNS.reduce((acc, col) => {
      acc[col.key] = line[col.key] ?? '';
      return acc;
    }, {})
  );
}

export function downloadShipPlanCsv(lines, { filenamePrefix = 'otgruzka' } = {}) {
  const rows = exportRows(lines);
  const header = EXPORT_COLUMNS.map((c) => c.label).join(';');
  const body = rows.map((row) => EXPORT_COLUMNS.map((c) => escapeCsvCell(row[c.key])).join(';'));
  const blob = new Blob(['\uFEFF' + [header, ...body].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadShipPlanXls(lines, { filenamePrefix = 'otgruzka' } = {}) {
  const rows = exportRows(lines);
  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: EXPORT_COLUMNS.map((c) => c.key),
  });
  XLSX.utils.sheet_add_aoa(sheet, [EXPORT_COLUMNS.map((c) => c.label)], { origin: 'A1' });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Отгрузить');
  XLSX.writeFile(workbook, `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
