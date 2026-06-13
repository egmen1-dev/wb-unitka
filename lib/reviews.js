import { getSql, initDb } from './db.js';

function mapReviewRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    productId: Number(row.product_id),
    userId: row.user_id,
    orderId: row.order_id,
    rating: row.rating,
    text: row.text,
    status: row.status,
    authorName: row.author_name || 'Покупатель',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getApprovedReviewsForProduct(productId, limit = 50) {
  await initDb();
  const db = getSql();

  const rows = await db`
    SELECT r.*, u.name AS author_name
    FROM product_reviews r
    JOIN users u ON u.id = r.user_id
    WHERE r.product_id = ${Number(productId)}
      AND r.status = 'approved'
    ORDER BY r.created_at DESC
    LIMIT ${limit}
  `;

  return rows.map(mapReviewRow);
}

export async function getReviewStatsForProduct(productId) {
  await initDb();
  const db = getSql();

  const [row] = await db`
    SELECT
      COUNT(*)::int AS count,
      COALESCE(AVG(rating), 0)::float AS avg_rating
    FROM product_reviews
    WHERE product_id = ${Number(productId)}
      AND status = 'approved'
  `;

  return {
    count: row?.count || 0,
    avgRating: row?.avg_rating ? Math.round(row.avg_rating * 10) / 10 : 0,
  };
}

export async function getUserReviewForProduct(userId, productId) {
  await initDb();
  const db = getSql();

  const rows = await db`
    SELECT r.*, u.name AS author_name
    FROM product_reviews r
    JOIN users u ON u.id = r.user_id
    WHERE r.user_id = ${userId}
      AND r.product_id = ${Number(productId)}
    LIMIT 1
  `;

  return mapReviewRow(rows[0]);
}

export async function getDeliveredProductIdsForUser(userId) {
  await initDb();
  const db = getSql();

  const rows = await db`
    SELECT DISTINCT oi.product_id
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.user_id = ${userId}
      AND o.status = 'delivered'
  `;

  return rows.map((row) => Number(row.product_id));
}

export async function canUserReviewProduct(userId, productId) {
  const deliveredIds = await getDeliveredProductIdsForUser(userId);
  if (!deliveredIds.includes(Number(productId))) {
    return { eligible: false, reason: 'Отзыв можно оставить только после доставки купленного товара' };
  }

  const existing = await getUserReviewForProduct(userId, productId);
  if (existing) {
    return { eligible: false, reason: 'Вы уже оставили отзыв на этот товар', review: existing };
  }

  return { eligible: true };
}

export async function createReview({ userId, productId, rating, text }) {
  await initDb();
  const db = getSql();

  const eligibility = await canUserReviewProduct(userId, productId);
  if (!eligibility.eligible) {
    throw new Error(eligibility.reason);
  }

  const safeRating = Math.max(1, Math.min(5, Math.round(Number(rating))));
  const safeText = String(text || '').trim();
  if (!safeText || safeText.length < 10) {
    throw new Error('Отзыв должен содержать минимум 10 символов');
  }

  const [orderRow] = await db`
    SELECT o.id
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.user_id = ${userId}
      AND o.status = 'delivered'
      AND oi.product_id = ${Number(productId)}
    ORDER BY o.created_at DESC
    LIMIT 1
  `;

  const rows = await db`
    INSERT INTO product_reviews (product_id, user_id, order_id, rating, text, status)
    VALUES (
      ${Number(productId)},
      ${userId},
      ${orderRow?.id || null},
      ${safeRating},
      ${safeText},
      'pending'
    )
    RETURNING *
  `;

  const [withName] = await db`
    SELECT r.*, u.name AS author_name
    FROM product_reviews r
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ${rows[0].id}
    LIMIT 1
  `;

  return mapReviewRow(withName);
}

export async function listReviewsForAdmin({ status = 'pending', limit = 100 } = {}) {
  await initDb();
  const db = getSql();

  const rows = status
    ? await db`
        SELECT r.*, u.name AS author_name
        FROM product_reviews r
        JOIN users u ON u.id = r.user_id
        WHERE r.status = ${status}
        ORDER BY r.created_at DESC
        LIMIT ${limit}
      `
    : await db`
        SELECT r.*, u.name AS author_name
        FROM product_reviews r
        JOIN users u ON u.id = r.user_id
        ORDER BY r.created_at DESC
        LIMIT ${limit}
      `;

  return rows.map(mapReviewRow);
}

export async function updateReviewStatus(reviewId, status) {
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    throw new Error('Некорректный статус');
  }

  await initDb();
  const db = getSql();

  const rows = await db`
    UPDATE product_reviews
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${Number(reviewId)}
    RETURNING *
  `;

  if (!rows[0]) return null;

  const [withName] = await db`
    SELECT r.*, u.name AS author_name
    FROM product_reviews r
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ${rows[0].id}
    LIMIT 1
  `;

  return mapReviewRow(withName);
}
