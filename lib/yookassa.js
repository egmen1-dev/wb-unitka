const YOOKASSA_API = 'https://api.yookassa.ru/v3/payments';

export function isYookassaConfigured() {
  return Boolean(
    process.env.YOOKASSA_SHOP_ID?.trim() && process.env.YOOKASSA_SECRET_KEY?.trim()
  );
}

function getAuthHeader() {
  const shopId = process.env.YOOKASSA_SHOP_ID.trim();
  const secret = process.env.YOOKASSA_SECRET_KEY.trim();
  const token = Buffer.from(`${shopId}:${secret}`).toString('base64');
  return `Basic ${token}`;
}

export async function createYookassaPayment({
  orderPublicId,
  amountRub,
  description,
  customerEmail,
  returnUrl,
}) {
  if (!isYookassaConfigured()) {
    return null;
  }

  const idempotenceKey = `${orderPublicId}-${Date.now()}`;
  const value = (Math.max(0, Number(amountRub) || 0)).toFixed(2);

  const response = await fetch(YOOKASSA_API, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
      'Idempotence-Key': idempotenceKey,
    },
    body: JSON.stringify({
      amount: { value, currency: 'RUB' },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: returnUrl,
      },
      description: description || `Заказ ${orderPublicId}`,
      metadata: { orderPublicId },
      receipt: customerEmail
        ? {
            customer: { email: customerEmail },
            items: [
              {
                description: description || `Заказ ${orderPublicId}`,
                quantity: '1.00',
                amount: { value, currency: 'RUB' },
                vat_code: 1,
                payment_mode: 'full_payment',
                payment_subject: 'commodity',
              },
            ],
          }
        : undefined,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('YooKassa error', data);
    throw new Error(data?.description || 'Не удалось создать платёж');
  }

  return {
    paymentId: data.id,
    paymentUrl: data.confirmation?.confirmation_url || '',
    status: data.status,
  };
}
