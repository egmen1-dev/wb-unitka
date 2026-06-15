/**
 * Тип габарита WB: МГТ (короб), КГТ (монопаллета), СГТ (сверхгабарит).
 * Тарифы МГТ — GET /api/v1/tariffs/box (страница «Тарифы» → delivery в кабинете WB).
 */

export const WB_CARGO = {
  MGT: 'mgt',
  KGT: 'kgt',
  SGT: 'sgt',
};

export const WB_CARGO_LABELS = {
  mgt: 'МГТ',
  kgt: 'КГТ',
  sgt: 'СГТ',
};

/** Склад только для сверхгабарита (в названии «СГТ»). */
export function isSgtWarehouseName(name) {
  return /сгт/i.test(String(name || ''));
}

/** Склад с пометкой КГТ (монопаллета), не для обычных коробов МГТ. */
export function isKgtWarehouseName(name) {
  const hay = String(name || '').toLowerCase();
  return hay.includes('кгт') && !hay.includes('мгт');
}

/** Склад принимает товар данного типа габарита. */
export function warehouseAcceptsCargoType(warehouseName, cargoType = WB_CARGO.MGT) {
  const name = String(warehouseName || '');
  if (!name) return false;
  const sgt = isSgtWarehouseName(name);
  const kgt = isKgtWarehouseName(name);

  if (cargoType === WB_CARGO.SGT) return sgt;
  if (cargoType === WB_CARGO.KGT) return kgt || (!sgt && !kgt);
  // МГТ — только обычные склады коробов, без СГТ/КГТ
  return !sgt && !kgt;
}

export function filterTariffsForCargoType(tariffs = [], cargoType = WB_CARGO.MGT) {
  return tariffs.filter((t) => warehouseAcceptsCargoType(t.warehouseName, cargoType));
}

/**
 * Классификация по габаритам карточки (как в кабинете WB на странице товара).
 * Без габаритов — МГТ (типичная матрица коробов).
 */
export function classifyWbCargoType({ lengthCm, widthCm, heightCm, weightKg } = {}) {
  const dims = [lengthCm, widthCm, heightCm].map((v) => Number(v)).filter((v) => v > 0);
  if (!dims.length) return WB_CARGO.MGT;

  const sorted = [...dims].sort((a, b) => b - a);
  const maxSide = sorted[0];
  const sumSides = sorted.reduce((s, v) => s + v, 0);
  const weight = Number(weightKg) || 0;
  const volumeL = dims.length === 3 ? (dims[0] * dims[1] * dims[2]) / 1000 : 0;

  // СГТ: тяжёлый или очень крупный товар
  if (weight > 25 || maxSide > 200 || sumSides > 280) return WB_CARGO.SGT;
  // КГТ: не помещается в короб МГТ
  if (weight > 25 || maxSide > 120 || sumSides > 200 || volumeL > 96) return WB_CARGO.KGT;

  return WB_CARGO.MGT;
}

/** Доминирующий тип габарита в матрице (для рекомендаций по складам). */
export function resolveMatrixCargoType(rows = []) {
  const counts = { mgt: 0, kgt: 0, sgt: 0 };
  for (const row of rows) {
    const type = row.cargoType || classifyWbCargoType(row);
    if (counts[type] != null) counts[type] += 1;
  }
  const total = counts.mgt + counts.kgt + counts.sgt;
  if (!total) return WB_CARGO.MGT;
  if (counts.sgt > total * 0.5) return WB_CARGO.SGT;
  if (counts.kgt > total * 0.5) return WB_CARGO.KGT;
  return WB_CARGO.MGT;
}

export function cargoTypeLabel(cargoType) {
  return WB_CARGO_LABELS[cargoType] || 'МГТ';
}
