import crypto from 'crypto';
import { hashPassword } from './auth.js';
import { getSql, initDb } from './db.js';

const TOKEN_TTL_MS = 60 * 60 * 1000;

function getSiteOrigin() {
  return process.env.SITE_URL || 'https://moi-magazin.vercel.app';
}

export async function findUserEmailForReset(userId, phoneDigits) {
  await initDb();
  const db = getSql();

  const [user] = await db`
    SELECT email FROM users WHERE id = ${userId} LIMIT 1
  `;
  if (user?.email) {
    return user.email.trim().toLowerCase();
  }

  const [order] = await db`
    SELECT customer_email
    FROM orders
    WHERE regexp_replace(customer_phone, '\\D', '', 'g') = ${phoneDigits}
      AND customer_email IS NOT NULL
      AND customer_email <> ''
    ORDER BY created_at DESC
    LIMIT 1
  `;

  return order?.customer_email?.trim().toLowerCase() || '';
}

export async function createPasswordResetToken(userId) {
  await initDb();
  const db = getSql();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await db`
    UPDATE password_reset_tokens
    SET used_at = NOW()
    WHERE user_id = ${userId} AND used_at IS NULL
  `;

  await db`
    INSERT INTO password_reset_tokens (user_id, token, expires_at)
    VALUES (${userId}, ${token}, ${expiresAt})
  `;

  return {
    token,
    resetUrl: `${getSiteOrigin()}/reset-password?token=${token}`,
    expiresAt,
  };
}

export async function resetPasswordWithToken(token, password) {
  await initDb();
  const db = getSql();

  const [row] = await db`
    SELECT id, user_id, expires_at, used_at
    FROM password_reset_tokens
    WHERE token = ${token}
    LIMIT 1
  `;

  if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
    return { ok: false, error: 'Ссылка недействительна или устарела' };
  }

  const passwordHash = await hashPassword(password);

  await db`
    UPDATE users
    SET password_hash = ${passwordHash}, updated_at = NOW()
    WHERE id = ${row.user_id}
  `;

  await db`
    UPDATE password_reset_tokens
    SET used_at = NOW()
    WHERE id = ${row.id}
  `;

  return { ok: true };
}
