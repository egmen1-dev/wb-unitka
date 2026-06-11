import { chromium } from 'playwright';

const cart = [{
  id: 800566635,
  name: 'Газонокосилка бензиновая с травосборником самоходная',
  price: 31277,
  inStock: true,
  quantity: 1,
}];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  await page.goto('https://moi-magazin.vercel.app/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.evaluate(
    (items) => localStorage.setItem('moi-magazin-cart', JSON.stringify(items)),
    cart,
  );
  await page.goto('https://moi-magazin.vercel.app/checkout', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await page.waitForSelector('#name', { timeout: 15000 });
  await page.locator('#name').fill('Тест Тестов');
  await page.locator('#phone').fill('+79991234567');
  await page.locator('#email').fill('test@example.com');
  await page.getByRole('button', { name: /Далее/i }).click();
  await page.waitForTimeout(3000);

  const bodyText = await page.locator('body').innerText();
  const cdekRequests = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/cdek/') || url.includes('service.php')) {
      cdekRequests.push(url);
    }
  });
  await page.waitForTimeout(1000);

  const result = {
    url: page.url(),
    hasCdekText: /СДЭК/.test(bodyText),
    hasYandexKeyError: /VITE_YANDEX_MAPS_API_KEY|карты СДЭК/i.test(bodyText),
    cdekMapRoots: await page.locator('[id^="cdek-map-"]').count(),
    snippet: bodyText.match(/.{0,30}(СДЭК|карты СДЭК|VITE_YANDEX).{0,50}/)?.[0] || null,
    cdekRequests: cdekRequests.slice(0, 5),
  };

  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
