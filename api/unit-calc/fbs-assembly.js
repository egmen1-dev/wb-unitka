import {
  aggregateFbsPickList,
  buildCatalogLookup,
  createFbsSuppliesFromGroups,
  fetchNewFbsOrders,
  groupOrdersForSupplies,
  summarizeFbsAssembly,
} from '../../lib/wb-fbs-assembly.js';

function readToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const fromHeader = String(header).replace(/^Bearer\s+/i, '').trim();
  if (fromHeader) return fromHeader;
  if (req.body?.token) return String(req.body.token).trim();
  return process.env.WB_API_TOKEN?.trim() || null;
}

function serializeOrder(order) {
  return {
    id: order.id,
    article: order.article,
    nmId: order.nmId,
    chrtId: order.chrtId,
    createdAt: order.createdAt,
    officeId: order.officeId,
    warehouseId: order.warehouseId,
    offices: order.offices,
    cargoType: order.cargoType,
    crossBorderType: order.crossBorderType,
    isB2B: Boolean(order.options?.isB2B),
    price: order.price,
    skus: order.skus,
    requiredMeta: order.requiredMeta,
    optionalMeta: order.optionalMeta,
  };
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

  const action = req.body?.action === 'create-supplies' ? 'create-supplies' : 'load';

  try {
    const orders = await fetchNewFbsOrders(token);
    const catalogRows = Array.isArray(req.body?.catalogRows) ? req.body.catalogRows : [];
    const supplierDigitKeys = Array.isArray(req.body?.supplierDigitKeys)
      ? req.body.supplierDigitKeys
      : Object.keys(req.body?.supplierCatalog?.byDigitKey || {});
    const catalogByVendor = buildCatalogLookup(catalogRows, { supplierDigitKeys });
    const pickList = aggregateFbsPickList(orders, catalogByVendor, supplierDigitKeys);
    const supplyGroups = groupOrdersForSupplies(orders).map((group) => ({
      key: group.key,
      officeId: group.officeId,
      officeLabel: group.officeLabel,
      cargoType: group.cargoType,
      cargoTypeLabel: group.cargoTypeLabel,
      crossBorderType: group.crossBorderType,
      isB2B: group.isB2B,
      orderCount: group.orderIds.length,
      orderIds: group.orderIds,
    }));

    if (action === 'load') {
      return res.status(200).json({
        action: 'load',
        orders: orders.map(serializeOrder),
        pickList,
        supplyGroups,
        summary: summarizeFbsAssembly(orders, pickList, supplyGroups),
        manualSteps: [
          'После создания поставки в ЛК WB: распределите товары по коробам (для ПВЗ), распечатайте QR коробов и поставки.',
          'Передайте поставку в доставку (deliver) — только когда все метаданные (КИЗ, UIN и т.д.) заполнены.',
          'Заказы из разных складов WB или разного типа габарита нельзя смешивать в одной поставке.',
        ],
        tokenScope: 'Marketplace — сборочные задания и поставки FBS',
      });
    }

    const selectedKeys = new Set(
      (Array.isArray(req.body?.groupKeys) ? req.body.groupKeys : []).map(String)
    );
    const groupsToCreate = selectedKeys.size
      ? supplyGroups.filter((g) => selectedKeys.has(g.key))
      : supplyGroups;

    if (!groupsToCreate.length) {
      return res.status(400).json({ error: 'Нет групп для создания поставок' });
    }

    const created = await createFbsSuppliesFromGroups(token, groupsToCreate, {
      namePrefix: String(req.body?.namePrefix || 'Unitka').trim() || 'Unitka',
    });

    return res.status(200).json({
      action: 'create-supplies',
      created,
      summary: summarizeFbsAssembly(orders, pickList, supplyGroups),
      manualSteps: [
        'Поставки созданы в статусе «на сборке». Откройте seller.wildberries.ru → Маркетплейс → Сборочные задания.',
        'Для ПВЗ: добавьте короба, распечатайте стикеры. Затем передайте поставку в доставку.',
      ],
    });
  } catch (error) {
    console.error('[unit-calc/fbs-assembly]', error);
    const message = error.message || 'Ошибка FBS API';
    const status = /401|403/.test(message) ? 403 : 500;
    return res.status(status).json({
      error: message,
      hint:
        status === 403
          ? 'Нужен токен категории Marketplace (сборочные задания и поставки FBS).'
          : undefined,
    });
  }
}
