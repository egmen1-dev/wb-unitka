import { execFile } from 'child_process';
import { promisify } from 'util';
import mapping from './category-mapping.json' with { type: 'json' };
import subjectCategories from './subject-categories.json' with { type: 'json' };
import subcategoryMeta from './subcategory-meta.json' with { type: 'json' };
import {
  fetchBasketData,
  getWbCardJsonFallbackUrls,
  getWbImageUrl as buildWbImageUrl,
  getWbProductImageUrls,
} from './wb-images.js';
import { buildBrandIndex, normalizeBrandName } from './brands.js';
import {
  extractPriceFromGoods,
  extractStockFromCard,
  fetchAllContentCards,
  fetchAllPrices,
  fetchStocksForWarehouse,
  fetchWarehouses,
  hasOfficialWbApi,
} from './wb-official-api.js';

const execFileAsync = promisify(execFile);

const WB_DEST = -1257786;
const WB_CURRENCY = 'rub';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function getDefaultHeaders(supplierId) {
  return {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    Origin: 'https://www.wildberries.ru',
    Referer: `https://www.wildberries.ru/seller/${supplierId}`,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getWbImageUrl(nmId, index = 1, basketData = null) {
  return buildWbImageUrl(nmId, index, basketData);
}

function formatSubcategoryName(entity, subjectId) {
  const id = String(subjectId || '').trim();
  const metaLabel = subcategoryMeta[id]?.label;
  if (metaLabel) return metaLabel;

  const normalized = entity?.trim() || '';
  if (normalized && !/^категория\s+\d+$/i.test(normalized)) {
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
  return normalized || `Раздел ${subjectId}`;
}

function buildSubcategories(products) {
  const map = {};

  for (const product of products) {
    const category = product.category;
    const key = String(product.subjectId);
    const name = formatSubcategoryName(product.entity, product.subjectId);

    if (!map[category]) map[category] = {};
    if (!map[category][key]) {
      map[category][key] = {
        id: key,
        name,
        entity: product.entity || name,
        subjectId: product.subjectId,
        count: 0,
      };
    }
    map[category][key].count += 1;
  }

  const subcategories = {};
  for (const [category, items] of Object.entries(map)) {
    subcategories[category] = Object.values(items).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru')
    );
  }

  return subcategories;
}

export function getWbProductUrl(nmId) {
  return `https://www.wildberries.ru/catalog/${nmId}/detail.aspx`;
}

function getProductPrice(wbProduct) {
  const size = wbProduct.sizes?.find((item) => item.price?.product > 0);
  if (!size) return 0;
  return Math.round(size.price.product / 100);
}

function getOldPrice(wbProduct) {
  const size = wbProduct.sizes?.find((item) => item.price?.basic > 0);
  if (!size) return null;
  const basic = Math.round(size.price.basic / 100);
  const current = getProductPrice(wbProduct);
  return basic > current ? basic : null;
}

function getPublicAvailability(wbProduct) {
  const price = getProductPrice(wbProduct);
  return {
    price,
    oldPrice: getOldPrice(wbProduct),
    stock: price > 0 ? null : 0,
    inStock: price > 0,
  };
}

function transformContentCard(card, pricesByNmId, stocksBySku, basketData) {
  const nmId = card.nmID;
  const goods = pricesByNmId.get(nmId);
  const { price: goodsPrice, oldPrice: goodsOldPrice } = extractPriceFromGoods(goods);
  const { stock, inStock } = extractStockFromCard(card, stocksBySku);
  const pics = Math.max(card.photos?.length || 0, 1);
  const images = getWbProductImageUrls(nmId, pics, basketData, 'c516x688');

  const wbLikeProduct = {
    id: nmId,
    name: card.title,
    brand: card.brand,
    brandId: card.brandId || null,
    entity: card.subjectName,
    subjectId: card.subjectID,
    subjectParentId: card.subjectParentId,
    pics,
    sizes: card.sizes,
    rating: 0,
    feedbacks: 0,
  };

  const publicAvailability = getPublicAvailability(wbLikeProduct);

  return {
    id: nmId,
    wbId: nmId,
    name: card.title,
    category: mapWbCategory(wbLikeProduct),
    price: goodsPrice || publicAvailability.price,
    oldPrice: goodsOldPrice || publicAvailability.oldPrice,
    stock,
    inStock: stocksBySku.size ? inStock : publicAvailability.inStock,
    image: card.photos?.[0]?.c516x688 || card.photos?.[0]?.big || images[0] || getWbImageUrl(nmId),
    images: card.photos?.length
      ? card.photos.map((photo) => photo.c516x688 || photo.big).filter(Boolean)
      : images,
    pics,
    description: card.description?.trim() || card.title,
    brand: normalizeBrandName(card.brand || 'Райзз'),
    brandId: card.brandId || null,
    rating: 0,
    feedbacks: 0,
    wbUrl: getWbProductUrl(nmId),
    subjectId: card.subjectID,
    subjectParentId: card.subjectParentId,
    entity: card.subjectName || '',
    subcategory: formatSubcategoryName(card.subjectName, card.subjectID),
    subcategoryId: String(card.subjectID),
    vendorCode: card.vendorCode || null,
    source: 'wb-official',
  };
}

export function resolveCategoryAlias(category = '') {
  const value = String(category || '').trim();
  return mapping.categoryAliases?.[value] || value;
}

export function mapWbCategory(wbProduct) {
  const parentId = String(wbProduct.subjectParentId ?? '');
  const subjectId = String(wbProduct.subjectId ?? '');

  if (subjectCategories[subjectId]) {
    return subjectCategories[subjectId];
  }

  if (mapping.wildberriesSubjects?.[subjectId]) {
    return mapping.wildberriesSubjects[subjectId];
  }

  if (mapping.wildberriesParentCategories[parentId]) {
    return mapping.wildberriesParentCategories[parentId];
  }

  const text = `${wbProduct.name || ''} ${wbProduct.entity || ''}`.toLowerCase();

  for (const category of mapping.storeCategories) {
    const keywords = mapping.keywords[category] || [];
    if (keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
      return category;
    }
  }

  return mapping.defaultCategory;
}

function transformProduct(wbProduct, details = null, descriptionsMap = null, basketData = null) {
  const detail = details || wbProduct;
  const description =
    descriptionsMap?.get(wbProduct.id) ||
    detail.description?.trim() ||
    [detail.entity, detail.brand, wbProduct.name].filter(Boolean).join('. ');

  const pics = Number(wbProduct.pics || detail.pics || 1);
  const images = getWbProductImageUrls(wbProduct.id, pics, basketData, 'c516x688');
  const availability = getPublicAvailability(wbProduct);

  return {
    id: wbProduct.id,
    wbId: wbProduct.id,
    name: wbProduct.name,
    category: mapWbCategory(wbProduct),
    price: availability.price,
    oldPrice: availability.oldPrice,
    stock: availability.stock,
    inStock: availability.inStock,
    image: images[0] || getWbImageUrl(wbProduct.id),
    images,
    pics,
    description: description || wbProduct.name,
    brand: normalizeBrandName(
      wbProduct.brand || detail.brand || wbProduct.supplier || 'Райзз'
    ),
    brandId: wbProduct.brandId || detail.brandId || null,
    rating: wbProduct.rating || detail.rating || 0,
    feedbacks: wbProduct.feedbacks || detail.feedbacks || 0,
    wbUrl: getWbProductUrl(wbProduct.id),
    subjectId: wbProduct.subjectId,
    subjectParentId: wbProduct.subjectParentId,
    entity: wbProduct.entity || detail.entity || '',
    subcategory: formatSubcategoryName(
      wbProduct.entity || detail.entity,
      wbProduct.subjectId
    ),
    subcategoryId: String(wbProduct.subjectId),
  };
}

async function fetchJsonWithCurl(url, headers) {
  const args = ['-sS', '--max-time', '30', url];
  for (const [key, value] of Object.entries(headers)) {
    args.push('-H', `${key}: ${value}`);
  }

  const { stdout } = await execFileAsync('curl', args);
  return JSON.parse(stdout);
}

async function fetchJson(url, headers, retries = 4) {
  let lastError;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      try {
        return await fetchJsonWithCurl(url, headers);
      } catch {
        const response = await fetch(url, { headers });

        if (response.status === 429 || response.status === 403) {
          lastError = new Error(`WB API ${response.status}: ${url}`);
          await sleep(2000 * (attempt + 1));
          continue;
        }

        if (!response.ok) {
          throw new Error(`WB API ${response.status}: ${url}`);
        }

        return response.json();
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await sleep(1000 * (attempt + 1));
    }
  }

  throw lastError || new Error(`WB API request failed: ${url}`);
}

export async function fetchSellerCatalogPage(supplierId, page = 1, spp = 100) {
  const params = new URLSearchParams({
    appType: '1',
    curr: WB_CURRENCY,
    dest: String(WB_DEST),
    page: String(page),
    sort: 'popular',
    supplier: String(supplierId),
    spp: String(spp),
  });

  const url = `https://catalog.wb.ru/sellers/v4/catalog?${params}`;
  return fetchJson(url, getDefaultHeaders(supplierId));
}

export async function fetchAllSellerProducts(supplierId) {
  const allProducts = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const data = await fetchSellerCatalogPage(supplierId, page, 100);
    const products = data.products || [];
    allProducts.push(...products);

    if (products.length < 100) {
      hasMore = false;
    } else {
      page += 1;
      await sleep(400);
    }
  }

  return allProducts;
}

async function fetchProductDescription(nmId, basketData) {
  const urls = getWbCardJsonFallbackUrls(nmId, basketData);

  for (const url of urls) {
    try {
      const data = await fetchJson(url, {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      });
      const description = data.description?.trim();
      if (description) {
        return description;
      }
    } catch {
      // try next basket host
    }
  }

  return null;
}

export async function fetchProductDescriptions(nmIds, basketData = null) {
  if (!nmIds.length) return new Map();

  const descriptionsMap = new Map();
  const concurrency = 5;

  for (let i = 0; i < nmIds.length; i += concurrency) {
    const chunk = nmIds.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (nmId) => {
        const description = await fetchProductDescription(nmId, basketData);
        return [nmId, description];
      })
    );

    for (const [nmId, description] of results) {
      if (description) {
        descriptionsMap.set(nmId, description);
      }
    }

    if (i + concurrency < nmIds.length) {
      await sleep(150);
    }
  }

  return descriptionsMap;
}

export async function fetchProductDetails(nmIds) {
  if (!nmIds.length) return new Map();

  const chunks = [];
  for (let i = 0; i < nmIds.length; i += 100) {
    chunks.push(nmIds.slice(i, i + 100));
  }

  const detailsMap = new Map();

  for (const chunk of chunks) {
    const params = new URLSearchParams({
      appType: '1',
      curr: WB_CURRENCY,
      dest: String(WB_DEST),
      nm: chunk.join(';'),
    });

    const data = await fetchJson(
      `https://card.wb.ru/cards/v4/detail?${params}`,
      getDefaultHeaders(process.env.WB_SUPPLIER_ID || 4277037)
    );
    for (const product of data.products || []) {
      detailsMap.set(product.id, product);
    }
    await sleep(300);
  }

  return detailsMap;
}

async function syncFromOfficialApi(basketData) {
  const [cards, pricesByNmId] = await Promise.all([
    fetchAllContentCards(),
    fetchAllPrices(),
  ]);

  let stocksBySku = new Map();
  const warehouseId = Number(process.env.WB_WAREHOUSE_ID || 0);

  if (warehouseId) {
    const skus = cards.flatMap((card) =>
      (card.sizes || []).flatMap((size) => size.skus || [])
    );
    stocksBySku = await fetchStocksForWarehouse(warehouseId, skus);
  } else if (hasOfficialWbApi()) {
    try {
      const warehouses = await fetchWarehouses();
      const firstWarehouse = warehouses.find((item) => item.id)?.id;
      if (firstWarehouse) {
        const skus = cards.flatMap((card) =>
          (card.sizes || []).flatMap((size) => size.skus || [])
        );
        stocksBySku = await fetchStocksForWarehouse(firstWarehouse, skus);
      }
    } catch {
      // Остатки опциональны: без склада показываем товары с ценой из Prices API.
    }
  }

  return cards.map((card) => transformContentCard(card, pricesByNmId, stocksBySku, basketData));
}

export async function syncWildberriesProducts({
  supplierId = Number(process.env.WB_SUPPLIER_ID || 4277037),
  includeDetails = true,
} = {}) {
  const basketData = await fetchBasketData();
  let products = [];

  if (hasOfficialWbApi()) {
    products = await syncFromOfficialApi(basketData);
  } else {
    const wbProducts = await fetchAllSellerProducts(supplierId);
    const ids = wbProducts.map((product) => product.id);
    let detailsMap = new Map();
    let descriptionsMap = new Map();

    if (includeDetails) {
      [detailsMap, descriptionsMap] = await Promise.all([
        fetchProductDetails(ids),
        fetchProductDescriptions(ids, basketData),
      ]);
    }

    products = wbProducts.map((product) => {
      const transformed = transformProduct(
        product,
        detailsMap.get(product.id),
        descriptionsMap,
        basketData
      );
      const images = getWbProductImageUrls(
        product.id,
        transformed.pics,
        basketData,
        'c246x328'
      );

      return {
        ...transformed,
        image: images[0] || buildWbImageUrl(product.id, 1, basketData, 'c246x328'),
        images,
        source: 'wb-public',
      };
    });
  }

  if (includeDetails && hasOfficialWbApi()) {
    const ids = products.map((product) => product.id);
    const descriptionsMap = await fetchProductDescriptions(ids, basketData);
    products = products.map((product) => {
      const description = descriptionsMap.get(product.id);
      return description ? { ...product, description } : product;
    });
  }

  products = products
    .sort(
      (a, b) =>
        Number(b.inStock) - Number(a.inStock) ||
        b.feedbacks - a.feedbacks ||
        b.rating - a.rating ||
        a.name.localeCompare(b.name, 'ru')
    );

  const categories = mapping.storeCategories;
  const categoryStats = categories.reduce((acc, category) => {
    acc[category] = products.filter((product) => product.category === category).length;
    return acc;
  }, {});
  const subcategories = buildSubcategories(products);
  const brands = buildBrandIndex(products);

  return {
    products,
    categories,
    categoryStats,
    subcategories,
    brands,
    supplierId,
    syncedAt: new Date().toISOString(),
    total: products.length,
    source: 'wildberries',
    sellerUrl: `https://www.wildberries.ru/seller/${supplierId}`,
  };
}
