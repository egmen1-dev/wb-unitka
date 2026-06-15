import { formatRegionFetchError } from '@lib/wb-region-sales.js';

export function regionEmptyMessage(meta, rowCount = 0) {
  if (meta?.regionSalesError) {
    return formatRegionFetchError(meta.regionSalesError);
  }

  if (!meta?.regionSalesPeriod) {
    return 'Нажмите «Быстро» в шапке — география подгружается вместе с синхронизацией WB.';
  }

  const rawRows = meta?.regionSalesRawRows ?? meta?.regionSalesSnapshot?.rowCount ?? 0;
  const totalQty = meta?.regionSalesTotalQty ?? meta?.regionSalesSnapshot?.totalQty ?? 0;

  if (rawRows === 0) {
    return 'WB не вернул заказов с регионами за последние 30 дней — проверьте, были ли продажи в этот период.';
  }

  if (totalQty === 0 && rowCount > 0) {
    return `В отчёте WB ${rawRows} строк, но нет совпадений с вашими ${rowCount} артикулами в таблице расчётов.`;
  }

  if (totalQty === 0) {
    return 'За 30 дней нет продаж с привязкой к регионам по вашему каталогу.';
  }

  return 'Нажмите «Быстро» в шапке, чтобы обновить географию заказов.';
}

export function regionSourceLabel(source) {
  if (source === 'analytics-region-sale') return 'WB Analytics «Продажи по регионам»';
  if (source === 'statistics-orders') return 'WB Statistics «Заказы» (регион в строке заказа)';
  return 'WB';
}
