import { initDb, getSql } from './db.js';

export function normalizePromoCode(code = '') {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

function mapPromoRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    code: row.code,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isEnabled: row.is_enabled,
    note: row.note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getPromoStatus(promo, now = new Date()) {
  if (!promo) return 'missing';
  if (!promo.isEnabled) return 'disabled';

  const start = new Date(promo.startsAt);
  const end = new Date(promo.endsAt);

  if (now < start) return 'scheduled';
  if (now > end) return 'expired';
  return 'active';
}

export function getPromoStatusLabel(status) {
  const labels = {
    active: 'Активен',
    scheduled: 'Ещё не начался',
    expired: 'Истёк',
    disabled: 'Отключён',
    missing: 'Не найден',
  };
  return labels[status] || status;
}

export function getPromoInvalidMessage(status) {
  const messages = {
    missing: 'Промокод не найден',
    disabled: 'Промокод отключён',
    scheduled: 'Промокод ещё не активен',
    expired: 'Срок действия промокода истёк',
  };
  return messages[status] || 'Промокод недействителен';
}

export function calculateDiscountAmount(promo, subtotal) {
  const amount = Math.max(0, Number(subtotal) || 0);
  if (!promo || amount <= 0) return 0;

  if (promo.discountType === 'percent') {
    const percent = Math.min(100, Math.max(0, Number(promo.discountValue) || 0));
    return Math.round((amount * percent) / 100);
  }

  return Math.min(amount, Math.max(0, Number(promo.discountValue) || 0));
}

export async function listPromoCodes() {
  await initDb();
  const db = getSql();
  const rows = await db`
    SELECT *
    FROM promo_codes
    ORDER BY created_at DESC
  `;
  return rows.map(mapPromoRow);
}

export async function findPromoCodeByCode(code) {
  await initDb();
  const normalized = normalizePromoCode(code);
  if (!normalized) return null;

  const db = getSql();
  const rows = await db`
    SELECT *
    FROM promo_codes
    WHERE code = ${normalized}
    LIMIT 1
  `;
  return mapPromoRow(rows[0]);
}

export async function createPromoCode({
  code,
  discountType = 'percent',
  discountValue,
  startsAt,
  endsAt,
  isEnabled = true,
  note = '',
}) {
  await initDb();
  const normalized = normalizePromoCode(code);
  if (!normalized) {
    throw new Error('Укажите код промокода');
  }

  const type = discountType === 'fixed' ? 'fixed' : 'percent';
  const value = Number(discountValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Укажите корректную скидку');
  }
  if (type === 'percent' && value > 100) {
    throw new Error('Процент скидки не может быть больше 100');
  }

  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Укажите корректные даты действия');
  }
  if (end <= start) {
    throw new Error('Дата окончания должна быть позже даты начала');
  }

  const db = getSql();
  try {
    const rows = await db`
      INSERT INTO promo_codes (
        code,
        discount_type,
        discount_value,
        starts_at,
        ends_at,
        is_enabled,
        note
      )
      VALUES (
        ${normalized},
        ${type},
        ${Math.round(value)},
        ${start.toISOString()},
        ${end.toISOString()},
        ${Boolean(isEnabled)},
        ${note || null}
      )
      RETURNING *
    `;
    return mapPromoRow(rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      throw new Error('Промокод с таким кодом уже существует');
    }
    throw error;
  }
}

export async function updatePromoCode(id, patch = {}) {
  await initDb();
  const promoId = Number(id);
  if (!promoId) throw new Error('Некорректный промокод');

  const existing = await findPromoCodeById(promoId);
  if (!existing) throw new Error('Промокод не найден');

  const next = {
    code: patch.code !== undefined ? normalizePromoCode(patch.code) : existing.code,
    discountType:
      patch.discountType !== undefined
        ? patch.discountType === 'fixed'
          ? 'fixed'
          : 'percent'
        : existing.discountType,
    discountValue:
      patch.discountValue !== undefined
        ? Number(patch.discountValue)
        : existing.discountValue,
    startsAt: patch.startsAt !== undefined ? new Date(patch.startsAt) : new Date(existing.startsAt),
    endsAt: patch.endsAt !== undefined ? new Date(patch.endsAt) : new Date(existing.endsAt),
    isEnabled:
      patch.isEnabled !== undefined ? Boolean(patch.isEnabled) : existing.isEnabled,
    note: patch.note !== undefined ? patch.note || '' : existing.note,
  };

  if (!next.code) throw new Error('Укажите код промокода');
  if (!Number.isFinite(next.discountValue) || next.discountValue <= 0) {
    throw new Error('Укажите корректную скидку');
  }
  if (next.discountType === 'percent' && next.discountValue > 100) {
    throw new Error('Процент скидки не может быть больше 100');
  }
  if (Number.isNaN(next.startsAt.getTime()) || Number.isNaN(next.endsAt.getTime())) {
    throw new Error('Укажите корректные даты действия');
  }
  if (next.endsAt <= next.startsAt) {
    throw new Error('Дата окончания должна быть позже даты начала');
  }

  const db = getSql();
  try {
    const rows = await db`
      UPDATE promo_codes
      SET
        code = ${next.code},
        discount_type = ${next.discountType},
        discount_value = ${Math.round(next.discountValue)},
        starts_at = ${next.startsAt.toISOString()},
        ends_at = ${next.endsAt.toISOString()},
        is_enabled = ${next.isEnabled},
        note = ${next.note || null},
        updated_at = NOW()
      WHERE id = ${promoId}
      RETURNING *
    `;
    return mapPromoRow(rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      throw new Error('Промокод с таким кодом уже существует');
    }
    throw error;
  }
}

export async function findPromoCodeById(id) {
  await initDb();
  const promoId = Number(id);
  if (!promoId) return null;

  const db = getSql();
  const rows = await db`
    SELECT *
    FROM promo_codes
    WHERE id = ${promoId}
    LIMIT 1
  `;
  return mapPromoRow(rows[0]);
}

export async function deletePromoCode(id) {
  await initDb();
  const promoId = Number(id);
  if (!promoId) throw new Error('Некорректный промокод');

  const db = getSql();
  const rows = await db`
    DELETE FROM promo_codes
    WHERE id = ${promoId}
    RETURNING id
  `;
  if (!rows[0]) throw new Error('Промокод не найден');
  return true;
}

export async function validatePromoForOrder(code, subtotal) {
  return validatePromoCode(code, subtotal);
}

export async function validatePromoCode(code, subtotal) {
  const promo = await findPromoCodeByCode(code);
  const status = getPromoStatus(promo);

  if (status !== 'active') {
    return {
      valid: false,
      status,
      error: getPromoInvalidMessage(status),
    };
  }

  const discountAmount = calculateDiscountAmount(promo, subtotal);

  return {
    valid: true,
    status,
    code: promo.code,
    discountType: promo.discountType,
    discountValue: promo.discountValue,
    discountAmount,
    subtotal: Math.max(0, Number(subtotal) || 0),
    message:
      promo.discountType === 'percent'
        ? `Скидка ${promo.discountValue}% применена`
        : `Скидка ${promo.discountValue} ₽ применена`,
  };
}
