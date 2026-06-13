import { fetchWbCatalogSnapshot } from '../../wb-unit-economics-sheet/lib/fetch-wb-catalog.js';
import { buildUnitRows } from '../../lib/unit-economics/build-rows.js';
import {
  collectSupplierPurchases,
  deserializeSupplierIndex,
  fetchSupplierPriceIndex,
} from '../../lib/supplier-price-list.js';

function readToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const fromHeader = String(header).replace(/^Bearer\s+/i, '').trim();
  if (fromHeader) return fromHeader;
  if (req.body?.token) return String(req.body.token).trim();
  return process.env.WB_API_TOKEN?.trim() || null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Используйте POST' });
  }

  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Укажите WB API токен в заголовке Authorization: Bearer …' });
  }

  try {
    const mode =
      req.body?.mode === 'full'
        ? 'full'
        : req.body?.mode === 'bootstrap'
          ? 'bootstrap'
          : 'quick';
    const phase =
      req.body?.phase === 'catalog'
        ? 'catalog'
        : req.body?.phase === 'realization'
          ? 'realization'
          : 'data';
    const wbCache = req.body?.wbCache || null;
    const snapshot = await fetchWbCatalogSnapshot(token, {
      mode,
      phase,
      wbCache,
      catalogCursor: req.body?.catalogCursor || null,
      catalogMaxPages: req.body?.catalogMaxPages,
      skipRealization: req.body?.skipRealization === true,
    });

    if (snapshot.phase === 'catalog') {
      return res.status(200).json({
        phase: 'catalog',
        syncedAt: snapshot.syncedAt,
        syncMode: snapshot.syncMode,
        catalogNextCursor: snapshot.catalogNextCursor,
        catalogDone: snapshot.catalogDone,
        catalogLoaded: snapshot.catalogLoaded,
        fullCatalogAt: snapshot.fullCatalogAt,
        cardsSyncedAt: snapshot.cardsSyncedAt,
        productCache: snapshot.productCache,
      });
    }

    const purchaseOverrides = req.body?.purchaseOverrides || {};
    const settings = req.body?.settings || {};

    let supplierIndex = null;
    let supplierMeta = null;

    if (req.body?.supplierCatalog?.byDigitKey) {
      supplierIndex = deserializeSupplierIndex(req.body.supplierCatalog);
      supplierMeta = {
        syncedAt: req.body.supplierCatalog.uploadedAt || null,
        source: 'upload',
        total: supplierIndex.size,
        matched: 0,
        fileName: req.body.supplierCatalog.fileName || null,
      };
    } else if (mode !== 'quick' && mode !== 'bootstrap') {
      const supplier = await fetchSupplierPriceIndex();
      supplierIndex = supplier.byDigitKey;
      supplierMeta = {
        syncedAt: supplier.syncedAt,
        source: supplier.source,
        total: supplier.byDigitKey.size,
        fallbackError: supplier.fallbackError || null,
      };
    } else {
      supplierIndex = new Map();
      supplierMeta = { skipped: true, source: 'quick' };
    }

    const payload = buildUnitRows(snapshot, {
      purchaseOverrides,
      settings,
      supplierIndex,
    });

    const supplierPurchases = collectSupplierPurchases(
      snapshot.products,
      supplierIndex,
      purchaseOverrides
    );

    return res.status(200).json({
      ...payload,
      phase: snapshot.phase || 'data',
      syncMode: snapshot.syncMode,
      realizationLoaded: snapshot.realizationLoaded ?? snapshot.syncMode !== 'bootstrap',
      realizationSnapshot: snapshot.realizationSnapshot || null,
      fullCatalogAt: snapshot.fullCatalogAt,
      cardsSyncedAt: snapshot.cardsSyncedAt,
      cardsDeltaCount: snapshot.cardsDeltaCount ?? 0,
      productCache: snapshot.productCache,
      tariffCache: snapshot.tariffCache || null,
      supplierPurchases,
      supplierMeta: {
        ...supplierMeta,
        matched: Object.keys(supplierPurchases).length,
      },
    });
  } catch (error) {
    console.error('[unit-calc/sync]', error);
    return res.status(500).json({ error: error.message || 'Ошибка загрузки WB API' });
  }
}
