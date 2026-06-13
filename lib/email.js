const DEFAULT_FROM = process.env.EMAIL_FROM || 'МойМагазин <orders@moi-magazin.ru>';

function getSiteOrigin() {
  return process.env.SITE_URL || 'https://moi-magazin.vercel.app';
}

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey || !to) {
    return { ok: false, skipped: true };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: DEFAULT_FROM,
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || 'Не удалось отправить email');
  }

  return { ok: true };
}

export function buildOrderConfirmationEmail(order) {
  const origin = getSiteOrigin();
  const itemsHtml = (order.items || [])
    .map(
      (item) =>
        `<li>${item.productName} × ${item.quantity} — ${item.lineTotal} ₽</li>`
    )
    .join('');

  const html = `
    <h2>Заказ ${order.publicId} оформлен</h2>
    <p>Здравствуйте, ${order.customerName}!</p>
    <p>Мы получили ваш заказ. Сумма: <strong>${order.total} ₽</strong>.</p>
    <ul>${itemsHtml}</ul>
    <p><a href="${origin}/order/${order.publicId}">Открыть заказ на сайте</a></p>
  `;

  const text = [
    `Заказ ${order.publicId} оформлен`,
    `Сумма: ${order.total} ₽`,
    `Статус: ${order.status}`,
    `${origin}/order/${order.publicId}`,
  ].join('\n');

  return {
    subject: `Заказ ${order.publicId} — МойМагазин`,
    html,
    text,
  };
}

export function buildPasswordResetEmail({ name, resetUrl }) {
  const html = `
    <h2>Восстановление пароля</h2>
    <p>Здравствуйте${name ? `, ${name}` : ''}!</p>
    <p>Чтобы задать новый пароль, перейдите по ссылке (действует 1 час):</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p>Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.</p>
  `;

  return {
    subject: 'Восстановление пароля — МойМагазин',
    html,
    text: `Восстановление пароля: ${resetUrl}`,
  };
}
