/** Схема отгрузки по строке отчёта реализации WB (поле delivery_method). */
export function classifyFulfillmentFromReport(row = {}) {
  const method = String(row.delivery_method || '').trim().toUpperCase();
  if (method.includes('FBS')) return 'fbs';
  if (method.includes('FBW') || method.includes('FBO')) return 'fbo';
  if (method.includes('DBW') || method.includes('DBS')) return 'dbs';

  if (row.assembly_id) return 'fbs';
  if (row.gi_id && !row.assembly_id) return 'fbo';

  return 'unknown';
}

export function isFbsReportRow(row) {
  return classifyFulfillmentFromReport(row) === 'fbs';
}

export function isFboReportRow(row) {
  return classifyFulfillmentFromReport(row) === 'fbo';
}
