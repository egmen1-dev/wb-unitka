import { initDb, getSql } from './db.js';

export async function getAllProductOverrides() {
  await initDb();
  const db = getSql();
  const rows = await db`
    SELECT wb_id, visible, price, old_price, stock, in_stock_override, note, updated_at
    FROM product_overrides
  `;

  return new Map(rows.map((row) => [Number(row.wb_id), row]));
}

export async function upsertProductOverride({
  wbId,
  visible = true,
  price = null,
  oldPrice = null,
  stock = null,
  inStockOverride = null,
  note = null,
}) {
  await initDb();
  const db = getSql();

  const [row] = await db`
    INSERT INTO product_overrides (
      wb_id, visible, price, old_price, stock, in_stock_override, note, updated_at
    )
    VALUES (
      ${wbId},
      ${visible},
      ${price},
      ${oldPrice},
      ${stock},
      ${inStockOverride},
      ${note},
      NOW()
    )
    ON CONFLICT (wb_id)
    DO UPDATE SET
      visible = EXCLUDED.visible,
      price = EXCLUDED.price,
      old_price = EXCLUDED.old_price,
      stock = EXCLUDED.stock,
      in_stock_override = EXCLUDED.in_stock_override,
      note = EXCLUDED.note,
      updated_at = NOW()
    RETURNING wb_id, visible, price, old_price, stock, in_stock_override, note, updated_at
  `;

  return row;
}

export async function deleteProductOverride(wbId) {
  await initDb();
  const db = getSql();
  await db`DELETE FROM product_overrides WHERE wb_id = ${wbId}`;
}

export async function bulkDeleteProductOverrides(wbIds = []) {
  if (!wbIds.length) return 0;

  await initDb();
  const db = getSql();
  const ids = wbIds.map(Number).filter(Boolean);
  const result = await db`
    DELETE FROM product_overrides
    WHERE wb_id IN ${db(ids)}
  `;

  return result.count || ids.length;
}

function parseOverrideNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOverrideBoolean(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  return Boolean(value);
}

export function normalizeOverridePayload(body = {}) {
  const stock = parseOverrideNumber(body.stock);
  let inStockOverride = parseOverrideBoolean(body.inStock ?? body.in_stock_override);

  if (stock != null && stock > 0) {
    inStockOverride = inStockOverride === false ? false : null;
  }

  return {
    wbId: Number(body.wbId || body.wb_id),
    visible: body.visible ?? true,
    price: parseOverrideNumber(body.price),
    oldPrice: parseOverrideNumber(body.oldPrice ?? body.old_price),
    stock,
    inStockOverride,
    note: body.note ?? null,
  };
}

export async function saveProductOverridesBatch(items = []) {
  const saved = [];

  for (const raw of items) {
    const payload = normalizeOverridePayload(raw);
    if (!payload.wbId) continue;

    saved.push(
      await upsertProductOverride({
        wbId: payload.wbId,
        visible: payload.visible,
        price: payload.price,
        oldPrice: payload.oldPrice,
        stock: payload.stock,
        inStockOverride: payload.inStockOverride,
        note: payload.note,
      })
    );
  }

  return saved;
}

export async function bulkUpsertProductOverrides(wbIds = [], patch = {}) {
  if (!wbIds.length) return [];

  const existing = await getAllProductOverrides();
  const saved = [];

  for (const rawId of wbIds) {
    const wbId = Number(rawId);
    const current = existing.get(wbId);

    const item = await upsertProductOverride({
      wbId,
      visible: 'visible' in patch ? patch.visible : (current?.visible ?? true),
      price: 'price' in patch ? patch.price : (current?.price ?? null),
      oldPrice: 'oldPrice' in patch ? patch.oldPrice : (current?.old_price ?? null),
      stock: 'stock' in patch ? patch.stock : (current?.stock ?? null),
      inStockOverride:
        'inStockOverride' in patch
          ? patch.inStockOverride
          : (current?.in_stock_override ?? null),
      note: 'note' in patch ? patch.note : (current?.note ?? null),
    });

    saved.push(item);
  }

  return saved;
}

export function applyProductOverrides(product, override) {
  if (!override) return product;
  if (override.visible === false) return null;

  const result = { ...product };

  if (override.price != null) {
    result.price = Number(override.price);
  }

  if (override.old_price != null) {
    result.oldPrice = Number(override.old_price) || null;
  }

  if (override.stock != null) {
    result.stock = Number(override.stock);
    result.inStock = result.stock > 0;
  } else if (override.in_stock_override != null) {
    result.inStock = Boolean(override.in_stock_override);
  }

  if (override.note) {
    result.adminNote = override.note;
  }

  result.hasOverride = true;
  return result;
}

export function mergeCatalogWithOverrides(products, overridesMap) {
  const merged = [];

  for (const product of products) {
    const override = overridesMap.get(Number(product.id));
    const next = applyProductOverrides(product, override);
    if (next) merged.push(next);
  }

  return merged;
}
