import {
  deserializeSupplierIndex,
  parseSupplierWorkbook,
  serializeSupplierIndex,
} from '../../lib/supplier-price-list.js';

function readBody(req) {
  return req.body || {};
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Используйте POST' });
  }

  try {
    const body = readBody(req);
    const fileName = String(body.fileName || 'прайс.xls').trim();
    const fileBase64 = body.fileBase64;

    if (!fileBase64) {
      return res.status(400).json({ error: 'Файл не передан' });
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    if (!buffer.length) {
      return res.status(400).json({ error: 'Пустой файл' });
    }

    const parsed = parseSupplierWorkbook(buffer);
    if (!parsed.byDigitKey.size) {
      return res.status(400).json({
        error: 'Не найдено цен. Нужен XLS/XLSX с колонками «Артикул» и «Цена» (как в прайсе поставщика).',
      });
    }

    return res.status(200).json({
      fileName,
      fileSize: buffer.length,
      totalItems: parsed.matchedItems,
      sheetName: parsed.sheetName,
      byDigitKey: serializeSupplierIndex(parsed.byDigitKey),
    });
  } catch (error) {
    console.error('[unit-calc/supplier-price]', error);
    return res.status(500).json({
      error: error.message || 'Не удалось прочитать файл',
    });
  }
}

export { deserializeSupplierIndex };
