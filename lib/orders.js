import { validatePromoForOrder } from './promo-codes.js';
import { getSql, initDb } from './db.js';

export const ORDER_STATUSES = {
  new: 'Новый',
  awaiting_payment: 'Ожидает оплаты',
  paid: 'Оплачен',
  processing: 'В обработке',
  shipped: 'Отправлен',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
};

function mapOrderRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    publicId: row.public_id,
    userId: row.user_id,
    status: row.status,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    deliveryMethod: row.delivery_method,
    deliveryAddress: row.delivery_address || '',
    pickupPoint: row.pickup_point || '',
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    subtotal: row.subtotal,
    discountAmount: row.discount_amount,
    deliveryPrice: row.delivery_price,
    total: row.total,
    promoCode: row.promo_code || '',
    paymentUrl: row.payment_url || '',
    isB2b: Boolean(row.is_b2b),
    companyName: row.company_name || '',
    companyInn: row.company_inn || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOrderItemRow(row) {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    productImage: row.product_image || '',
    price: row.price,
    quantity: row.quantity,
    lineTotal: row.line_total,
  };
}

function generatePublicId() {
  const part = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MM-${part}-${rand}`;
}

function sanitizeItems(items = []) {
  return items
    .map((item) => ({
      id: Number(item.id),
      name: String(item.name || '').trim(),
      image: String(item.image || ''),
      price: Math.max(0, Math.round(Number(item.price) || 0)),
      quantity: Math.max(1, Math.min(99, Math.round(Number(item.quantity) || 1))),
    }))
    .filter((item) => item.id && item.name && item.price > 0);
}

export async function createOrder({
  userId = null,
  items = [],
  customer = {},
  paymentMethod = 'cash',
  deliveryMethod = 'pickup',
  deliveryAddress = '',
  pickupPoint = '',
  deliveryPrice = 0,
  promoCode = '',
  isB2b = false,
  companyName = '',
  companyInn = '',
}) {
  await initDb();
  const db = getSql();

  const sanitizedItems = sanitizeItems(items);
  if (!sanitizedItems.length) {
    throw new Error('Корзина пуста');
  }

  const subtotal = sanitizedItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  let discountAmount = 0;
  let appliedPromo = '';

  if (promoCode?.trim()) {
    const promoResult = await validatePromoForOrder(promoCode, subtotal);
    if (!promoResult.valid) {
      throw new Error(promoResult.error || 'Промокод недействителен');
    }
    discountAmount = promoResult.discountAmount;
    appliedPromo = promoResult.code;
  }

  const safeDelivery = Math.max(0, Math.round(Number(deliveryPrice) || 0));
  const total = Math.max(0, subtotal - discountAmount + safeDelivery);

  const publicId = generatePublicId();
  const initialStatus = paymentMethod === 'card' ? 'awaiting_payment' : 'new';
  const paymentStatus = paymentMethod === 'card' ? 'pending' : 'pending';
  const safeIsB2b = Boolean(isB2b);
  const safeCompanyName = safeIsB2b ? String(companyName || '').trim() : '';
  const safeCompanyInn = safeIsB2b ? String(companyInn || '').replace(/\D/g, '') : '';

  if (safeIsB2b) {
    if (!safeCompanyName) {
      throw new Error('Введите название организации');
    }
    if (![10, 12].includes(safeCompanyInn.length)) {
      throw new Error('ИНН должен содержать 10 или 12 цифр');
    }
  }

  const [order] = await db`
    INSERT INTO orders (
      public_id, user_id, status, payment_method, payment_status,
      delivery_method, delivery_address, pickup_point,
      customer_name, customer_phone, customer_email,
      subtotal, discount_amount, delivery_price, total, promo_code,
      is_b2b, company_name, company_inn
    ) VALUES (
      ${publicId},
      ${userId},
      ${initialStatus},
      ${paymentMethod},
      ${paymentStatus},
      ${deliveryMethod},
      ${deliveryAddress || null},
      ${pickupPoint || null},
      ${customer.name},
      ${customer.phone},
      ${customer.email},
      ${subtotal},
      ${discountAmount},
      ${safeDelivery},
      ${total},
      ${appliedPromo || null},
      ${safeIsB2b},
      ${safeCompanyName || null},
      ${safeCompanyInn || null}
    )
    RETURNING *
  `;

  for (const item of sanitizedItems) {
    await db`
      INSERT INTO order_items (
        order_id, product_id, product_name, product_image, price, quantity, line_total
      ) VALUES (
        ${order.id},
        ${item.id},
        ${item.name},
        ${item.image},
        ${item.price},
        ${item.quantity},
        ${item.price * item.quantity}
      )
    `;
  }

  return getOrderByPublicId(publicId);
}

export async function getOrderByPublicId(publicId, userId = null) {
  await initDb();
  const db = getSql();

  const rows = await db`
    SELECT * FROM orders WHERE public_id = ${publicId} LIMIT 1
  `;
  const order = mapOrderRow(rows[0]);
  if (!order) return null;

  if (order.userId) {
    if (!userId || order.userId !== userId) {
      return null;
    }
  }

  const items = await db`
    SELECT * FROM order_items WHERE order_id = ${order.id} ORDER BY id
  `;

  return {
    ...order,
    items: items.map(mapOrderItemRow),
  };
}

export async function listOrdersForUser(userId, phone = '') {
  await initDb();
  const db = getSql();

  const phoneDigits = String(phone).replace(/\D/g, '');

  const rows = phoneDigits
    ? await db`
        SELECT * FROM orders
        WHERE user_id = ${userId}
           OR regexp_replace(customer_phone, '\\D', '', 'g') = ${phoneDigits}
        ORDER BY created_at DESC
        LIMIT 100
      `
    : await db`
        SELECT * FROM orders
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT 100
      `;

  const orders = [];
  for (const row of rows) {
    const order = mapOrderRow(row);
    const items = await db`
      SELECT * FROM order_items WHERE order_id = ${order.id} ORDER BY id
    `;
    orders.push({ ...order, items: items.map(mapOrderItemRow) });
  }

  return orders;
}

export async function listAllOrders({ status = '', limit = 100 } = {}) {
  await initDb();
  const db = getSql();

  const rows = status
    ? await db`
        SELECT * FROM orders
        WHERE status = ${status}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await db`
        SELECT * FROM orders
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

  const orders = [];
  for (const row of rows) {
    const order = mapOrderRow(row);
    const items = await db`
      SELECT * FROM order_items WHERE order_id = ${order.id} ORDER BY id
    `;
    orders.push({ ...order, items: items.map(mapOrderItemRow) });
  }

  return orders;
}

export async function updateOrderStatus(publicId, status) {
  if (!ORDER_STATUSES[status]) {
    throw new Error('Некорректный статус заказа');
  }

  await initDb();
  const db = getSql();

  const rows = await db`
    UPDATE orders
    SET status = ${status}, updated_at = NOW()
    WHERE public_id = ${publicId}
    RETURNING *
  `;

  return mapOrderRow(rows[0]);
}

export async function updateOrderPayment(publicId, patch = {}) {
  await initDb();
  const db = getSql();

  const rows = await db`
    UPDATE orders
    SET
      payment_status = COALESCE(${patch.paymentStatus ?? null}, payment_status),
      payment_url = COALESCE(${patch.paymentUrl ?? null}, payment_url),
      yookassa_payment_id = COALESCE(${patch.yookassaPaymentId ?? null}, yookassa_payment_id),
      status = COALESCE(${patch.status ?? null}, status),
      updated_at = NOW()
    WHERE public_id = ${publicId}
    RETURNING *
  `;

  return mapOrderRow(rows[0]);
}

export async function getOrderAnalytics() {
  await initDb();
  const db = getSql();

  const [summary] = await db`
    SELECT
      COUNT(*)::int AS total_orders,
      COALESCE(SUM(total), 0)::int AS total_revenue,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS orders_week,
      COALESCE(SUM(total) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)::int AS revenue_week,
      COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS orders_today,
      COALESCE(SUM(total) FILTER (WHERE created_at >= CURRENT_DATE), 0)::int AS revenue_today
    FROM orders
    WHERE status != 'cancelled'
  `;

  const byStatus = await db`
    SELECT status, COUNT(*)::int AS count
    FROM orders
    GROUP BY status
    ORDER BY count DESC
  `;

  const topProducts = await db`
    SELECT
      oi.product_name,
      SUM(oi.quantity)::int AS qty,
      SUM(oi.line_total)::int AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status != 'cancelled'
    GROUP BY oi.product_name
    ORDER BY qty DESC, revenue DESC
    LIMIT 10
  `;

  return {
    summary: {
      totalOrders: summary?.total_orders || 0,
      totalRevenue: summary?.total_revenue || 0,
      ordersWeek: summary?.orders_week || 0,
      revenueWeek: summary?.revenue_week || 0,
      ordersToday: summary?.orders_today || 0,
      revenueToday: summary?.revenue_today || 0,
    },
    byStatus: byStatus.map((row) => ({
      status: row.status,
      count: row.count,
    })),
    topProducts: topProducts.map((row) => ({
      productName: row.product_name,
      qty: row.qty,
      revenue: row.revenue,
    })),
  };
}

export async function updateUserProfile(userId, { name, email }) {
  await initDb();
  const db = getSql();

  const rows = await db`
    UPDATE users
    SET
      name = COALESCE(${name?.trim() || null}, name),
      email = COALESCE(${email?.trim() || null}, email),
      updated_at = NOW()
    WHERE id = ${userId}
    RETURNING id, phone, name, email, is_admin, created_at
  `;

  return rows[0] || null;
}
