import postgres from 'postgres';
import { ADMIN_USERS, isAdminPhone } from './admins.js';
import { normalizePhone } from './auth.js';

let initialized = false;
let sql = null;

function findEnv(suffixes) {
  for (const key of Object.keys(process.env)) {
    if (suffixes.some((suffix) => key.endsWith(suffix))) {
      return process.env[key];
    }
  }
  return null;
}

function resolveConnectionString() {
  return (
    findEnv(['_POSTGRES_URL_NON_POOLING']) ||
    process.env.POSTGRES_URL_NON_POOLING ||
    findEnv(['_POSTGRES_URL']) ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    findEnv(['_POSTGRES_PRISMA_URL']) ||
    process.env.POSTGRES_PRISMA_URL ||
    null
  );
}

export function getSql() {
  if (sql) return sql;

  const connectionString = resolveConnectionString();

  if (!connectionString) {
    throw new Error(
      'Не найдена строка подключения к Postgres. Подключите БД в Vercel (Storage → Postgres) и передеплойте проект.'
    );
  }

  sql = postgres(connectionString, {
    ssl: 'require',
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return sql;
}

export async function initDb() {
  const db = getSql();

  if (initialized) {
    await ensureAdminUsers(db);
    return;
  }

  await db`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      phone VARCHAR(20) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  await db`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
  `;

  await db`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email VARCHAR(255);
  `;

  await db`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR(64) UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  await db`
    CREATE TABLE IF NOT EXISTS carts (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  await db`
    CREATE TABLE IF NOT EXISTS product_overrides (
      wb_id BIGINT PRIMARY KEY,
      visible BOOLEAN NOT NULL DEFAULT TRUE,
      price INTEGER,
      old_price INTEGER,
      stock INTEGER,
      in_stock_override BOOLEAN,
      note TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  await db`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      public_id VARCHAR(32) UNIQUE NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'new',
      payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
      payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      delivery_method VARCHAR(20) NOT NULL DEFAULT 'pickup',
      delivery_address TEXT,
      pickup_point TEXT,
      customer_name VARCHAR(255) NOT NULL,
      customer_phone VARCHAR(20) NOT NULL,
      customer_email VARCHAR(255) NOT NULL,
      subtotal INTEGER NOT NULL DEFAULT 0,
      discount_amount INTEGER NOT NULL DEFAULT 0,
      delivery_price INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      promo_code VARCHAR(50),
      payment_url TEXT,
      yookassa_payment_id VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  await db`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL,
      product_name VARCHAR(500) NOT NULL,
      product_image TEXT,
      price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      line_total INTEGER NOT NULL
    );
  `;

  await db`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      discount_type VARCHAR(10) NOT NULL DEFAULT 'percent',
      discount_value INTEGER NOT NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  await db`
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  await db`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS is_b2b BOOLEAN NOT NULL DEFAULT FALSE;
  `;

  await db`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);
  `;

  await db`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS company_inn VARCHAR(12);
  `;

  await db`
    CREATE TABLE IF NOT EXISTS catalog_cache (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await db`
    CREATE TABLE IF NOT EXISTS product_reviews (
      id SERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      text TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(product_id, user_id)
    );
  `;

  initialized = true;
  await ensureAdminUsers(db);
}

async function ensureAdminUsers(db) {
  for (const admin of ADMIN_USERS) {
    const phone = normalizePhone(admin.phone);

    await db`
      UPDATE users
      SET is_admin = TRUE, name = ${admin.name}, updated_at = NOW()
      WHERE phone = ${phone}
    `;

    const [user] = await db`SELECT id FROM users WHERE phone = ${phone} LIMIT 1`;
    if (user?.id) {
      await linkOrdersToUserByPhone(db, user.id, phone);
    }
  }
}

async function linkOrdersToUserByPhone(db, userId, phone) {
  const digits = phone.replace(/\D/g, '');

  await db`
    UPDATE orders
    SET user_id = ${userId}, updated_at = NOW()
    WHERE user_id IS NULL
      AND regexp_replace(customer_phone, '\\D', '', 'g') = ${digits}
  `;
}

export async function checkDbConnection() {
  await initDb();
  const db = getSql();
  const [row] = await db`SELECT NOW() AS now, COUNT(*)::int AS users FROM users`;
  return {
    ok: true,
    time: row.now,
    usersCount: row.users,
    connection: 'configured',
  };
}

export async function findUserByPhone(phone) {
  const db = getSql();
  const rows = await db`SELECT * FROM users WHERE phone = ${phone} LIMIT 1`;
  return rows[0] || null;
}

export async function createUser({ phone, name, passwordHash, isAdmin = false }) {
  const db = getSql();
  const rows = await db`
    INSERT INTO users (phone, name, password_hash, is_admin)
    VALUES (${phone}, ${name}, ${passwordHash}, ${isAdmin || isAdminPhone(phone)})
    RETURNING id, phone, name, is_admin, created_at
  `;
  return rows[0];
}

export async function getUserById(id) {
  const db = getSql();
  const rows = await db`
    SELECT id, phone, name, email, is_admin, created_at
    FROM users
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

export function serializeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    email: user.email || '',
    isAdmin: Boolean(user.is_admin || isAdminPhone(user.phone)),
    createdAt: user.created_at,
  };
}

export async function getCartByUserId(userId) {
  const db = getSql();
  const rows = await db`
    SELECT items, updated_at FROM carts WHERE user_id = ${userId} LIMIT 1
  `;
  return rows[0] || null;
}

export async function saveCartForUser(userId, items) {
  const db = getSql();
  const payload = JSON.stringify(items);
  await db`
    INSERT INTO carts (user_id, items, updated_at)
    VALUES (${userId}, ${payload}::jsonb, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET items = EXCLUDED.items, updated_at = NOW()
  `;
}

export async function getFavoritesByUserId(userId) {
  const db = getSql();
  const rows = await db`
    SELECT product_ids, updated_at FROM favorites WHERE user_id = ${userId} LIMIT 1
  `;
  return rows[0] || null;
}

export async function saveFavoritesForUser(userId, productIds) {
  const db = getSql();
  const payload = JSON.stringify(productIds);
  await db`
    INSERT INTO favorites (user_id, product_ids, updated_at)
    VALUES (${userId}, ${payload}::jsonb, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET product_ids = EXCLUDED.product_ids, updated_at = NOW()
  `;
}
