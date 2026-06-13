import { batchUpdateValues, getSheetValues } from './google-sheets-client.js';

const SHEET = 'Юнитка';

const FIELDS = [
  { col: 'B', key: 'nmId' },
  { col: 'C', key: 'vendorCode' },
  { col: 'D', key: 'brand' },
  { col: 'E', key: 'title' },
  { col: 'F', key: 'stockFbo' },
  { col: 'G', key: 'stockFbs' },
  { col: 'J', key: 'orders7d' },
  { col: 'L', key: 'salePrice' },
  { col: 'M', key: 'basePrice' },
  { col: 'T', key: 'ourPrice' },
  { col: 'W', key: 'lengthCm' },
  { col: 'X', key: 'widthCm' },
  { col: 'Y', key: 'heightCm' },
];

export async function pushWbDataToGoogleSheet(spreadsheetId, snapshot) {
  const existing = await getSheetValues(spreadsheetId, `${SHEET}!A2:K2000`);
  const purchasesByNmId = new Map();
  for (const row of existing) {
    const nmId = Number(row[1]);
    const purchase = row[10];
    if (nmId && purchase !== '' && purchase != null) {
      purchasesByNmId.set(nmId, purchase);
    }
  }

  const products = [...snapshot.products].sort((a, b) =>
    String(a.vendorCode).localeCompare(String(b.vendorCode), 'ru')
  );

  const lastRow = products.length + 1;
  const updates = FIELDS.map(({ col, key }) => ({
    range: `${SHEET}!${col}2:${col}${lastRow}`,
    values: products.map((p) => [p[key] ?? '']),
  }));

  updates.push({
    range: `${SHEET}!K2:K${lastRow}`,
    values: products.map((p) => [purchasesByNmId.get(p.nmId) ?? '']),
  });

  await batchUpdateValues(spreadsheetId, updates);

  const commissionRows = products
    .filter((p) => p.vendorCode)
    .map((p) => [p.vendorCode, p.fboCommission, p.fbsCommission]);

  if (commissionRows.length) {
    await batchUpdateValues(spreadsheetId, [
      { range: '_Комиссия_ВБ!A2:C', values: commissionRows },
    ]);
  }

  await batchUpdateValues(spreadsheetId, [
    {
      range: '_Настройки!B6:B7',
      values: [[snapshot.boxTariffs.firstLiter], [snapshot.boxTariffs.additionalLiter]],
    },
  ]);

  return {
    updatedRows: products.length,
    withPurchase: products.filter((p) => purchasesByNmId.has(p.nmId)).length,
  };
}
