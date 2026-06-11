const YMAPS_SCRIPT_ID = 'yandex-maps-api-v3';

/** Предзагрузка JavaScript API 3.0 (отдельный ключ от HTTP Геокодера). */
export function loadYmaps3(apiKey) {
  if (!apiKey) {
    return Promise.reject(new Error('Yandex Maps API key is missing'));
  }

  if (window.ymaps3?.ready) {
    return window.ymaps3.ready;
  }

  const existing = document.getElementById(YMAPS_SCRIPT_ID);
  if (existing) {
    return new Promise((resolve, reject) => {
      const onReady = () => window.ymaps3?.ready?.then(resolve).catch(reject);
      existing.addEventListener('load', onReady, { once: true });
      existing.addEventListener('error', () => reject(new Error('Yandex Maps script failed')), {
        once: true,
      });
      if (window.ymaps3) onReady();
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = YMAPS_SCRIPT_ID;
    script.src = `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    script.async = true;
    script.onerror = () => reject(new Error('Yandex Maps script failed'));
    script.onload = () => {
      window.ymaps3?.ready?.then(resolve).catch(reject);
    };
    document.head.appendChild(script);
  });
}
