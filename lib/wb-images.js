const BASKET_RANGES = [
  143, 287, 431, 719, 1007, 1061, 1115, 1169, 1313, 1601, 1655, 1919, 2045,
  2189, 2405, 2621, 2837, 3053, 3269, 3485, 3701, 3917, 4133, 4349, 4565,
  4877, 5189, 5501, 5813, 6125, 6437, 6749, 7061, 7373, 7685, 7997, 8309,
  8741, 9173, 9605, 10373, 11141, 11909, 12677, 13445, 14213,
];

let cachedBasketData = null;
let cacheExpiresAt = 0;

export function getVol(nmId) {
  return Math.floor(Number(nmId) / 1e5);
}

export function getPart(nmId) {
  return Math.floor(Number(nmId) / 1e3);
}

export function getBasketHostByVol(vol, basketData = null) {
  if (basketData?.length) {
    const match = basketData.find((item) => vol >= item.min && vol <= item.max);
    if (match) {
      return match.host.replace(/^\/\//, 'https://');
    }
  }

  for (let i = 0; i < BASKET_RANGES.length; i += 1) {
    if (vol <= BASKET_RANGES[i]) {
      return `https://basket-${String(i + 1).padStart(2, '0')}.wbbasket.ru`;
    }
  }

  return 'https://basket-47.wbbasket.ru';
}

export async function fetchBasketData() {
  const now = Date.now();
  if (cachedBasketData && now < cacheExpiresAt) {
    return cachedBasketData;
  }

  try {
    const response = await fetch('https://cdn.wbbasket.ru/api/v3/upstreams', {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    const routeMap = json?.origin?.mediabasket_route_map || [];
    const basketData = [];

    for (const media of routeMap) {
      for (const host of media.hosts || []) {
        const match = host.host?.match(/basket-(\d+)\.wbbasket\.ru/);
        if (!match) continue;
        basketData.push({
          host: `https://${host.host}`,
          min: host.vol_range_from,
          max: host.vol_range_to,
        });
      }
    }

    if (basketData.length) {
      cachedBasketData = basketData;
      cacheExpiresAt = now + 24 * 60 * 60 * 1000;
      return basketData;
    }
  } catch {
    return null;
  }

  return null;
}

export function getWbImageUrl(nmId, index = 1, basketData = null, size = 'c246x328') {
  const vol = getVol(nmId);
  const part = getPart(nmId);
  const host = getBasketHostByVol(vol, basketData);
  return `${host}/vol${vol}/part${part}/${nmId}/images/${size}/${index}.webp`;
}

export function getWbProductImageUrls(
  nmId,
  picCount = 1,
  basketData = null,
  size = 'c516x688'
) {
  const count = Math.min(Math.max(Number(picCount) || 1, 1), 30);

  return Array.from({ length: count }, (_, index) =>
    getWbImageUrl(nmId, index + 1, basketData, size)
  );
}

export function getWbCardJsonUrl(nmId, basketData = null, host = null) {
  const vol = getVol(nmId);
  const part = getPart(nmId);
  const basketHost = host || getBasketHostByVol(vol, basketData);
  return `${basketHost}/vol${vol}/part${part}/${nmId}/info/ru/card.json`;
}

function getBasketFallbackHosts(vol) {
  const hosts = [];

  for (let i = 0; i < BASKET_RANGES.length; i += 1) {
    if (vol <= BASKET_RANGES[i]) {
      const center = i + 1;
      for (const offset of [0, -1, 1, -2, 2]) {
        const num = center + offset;
        if (num >= 1 && num <= 47) {
          hosts.push(`https://basket-${String(num).padStart(2, '0')}.wbbasket.ru`);
        }
      }
      break;
    }
  }

  return [...new Set(hosts)];
}

export function getWbCardJsonFallbackUrls(nmId, basketData = null) {
  const vol = getVol(nmId);
  const primaryHost = getWbCardJsonUrl(nmId, basketData).split('/vol')[0];
  const hosts = [primaryHost, ...getBasketFallbackHosts(vol)];

  return [...new Set(hosts)].map((host) => getWbCardJsonUrl(nmId, basketData, host));
}

export function getWbImageFallbacks(nmId, size = 'c246x328') {

  const vol = getVol(nmId);
  const part = getPart(nmId);
  const hosts = [];

  for (let i = 0; i < BASKET_RANGES.length; i += 1) {
    if (vol <= BASKET_RANGES[i]) {
      const center = i + 1;
      for (const offset of [0, -1, 1, -2, 2]) {
        const num = center + offset;
        if (num >= 1 && num <= 47) {
          hosts.push(`https://basket-${String(num).padStart(2, '0')}.wbbasket.ru`);
        }
      }
      break;
    }
  }

  const sizes = [size, 'c516x688', 'tm', 'big'];
  const uniqueHosts = [...new Set(hosts)];

  return sizes.flatMap((imageSize) =>
    uniqueHosts.map(
      (host) => `${host}/vol${vol}/part${part}/${nmId}/images/${imageSize}/1.webp`
    )
  );
}
