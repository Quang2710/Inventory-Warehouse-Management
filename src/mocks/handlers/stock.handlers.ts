import { http, HttpResponse } from 'msw';

import type { ExpiryStatus, SerialStatus } from '../../app/core/api/schema';
import { MOCK_CONFIG } from '../config';
import { db } from '../db';
import { parseExpiringDays } from '../domain/expiry';
import { toStockMovement } from '../mappers/document.mapper';
import { toSerialUnit, toStockLot } from '../mappers/warehouse.mapper';
import { authorize } from '../utils/auth';
import { toLocalDate } from '../utils/date';
import { errors } from '../utils/http';
import { inDateRange, matchesFilter, parseListQuery, toPage } from '../utils/query';
import { assertWarehouseAccess, canAccessWarehouse } from '../utils/scope';

const API = MOCK_CONFIG.apiUrl;

/** Tồn theo lô/HSD, tra cứu serial và lịch sử biến động. */
export const stockHandlers = [
  http.get(`${API}/stock/lots`, ({ request }) => {
    const user = authorize(request, 'stock:read');
    const query = parseListQuery(new URL(request.url));
    const warehouseId = query.params.get('warehouseId');
    const productId = query.params.get('productId');
    const expiryStatus = query.params.get('expiryStatus') as ExpiryStatus | null;
    const days = parseExpiringDays(query.params.get('days'));
    if (warehouseId) assertWarehouseAccess(user, warehouseId);
    const asOf = toLocalDate(new Date());
    const items = db.stockLot
      .getAll()
      .filter((lot) => lot.quantity > 0 && canAccessWarehouse(user, lot.warehouseId))
      .filter((lot) => matchesFilter(lot.warehouseId, warehouseId))
      .filter((lot) => matchesFilter(lot.productId, productId))
      .map((lot) => toStockLot(lot, asOf, days))
      .filter((lot) => matchesFilter(lot.expiryStatus, expiryStatus));
    return HttpResponse.json(
      toPage(items, query, {
        sortable: [
          'expiryDate',
          'lotNumber',
          'sku',
          'productName',
          'warehouseName',
          'locationCode',
          'quantity',
          'receivedAt',
        ],
        defaultSort: 'expiryDate,asc',
        searchIn: (lot) => [lot.sku, lot.productName, lot.lotNumber, lot.locationCode],
      }),
    );
  }),

  http.get(`${API}/serials`, ({ request }) => {
    const user = authorize(request, 'stock:read');
    const query = parseListQuery(new URL(request.url));
    const warehouseId = query.params.get('warehouseId');
    const productId = query.params.get('productId');
    const locationId = query.params.get('locationId');
    const status = query.params.get('status') as SerialStatus | null;
    if (warehouseId) assertWarehouseAccess(user, warehouseId);
    const items = db.serialUnit
      .getAll()
      .filter((unit) => !unit.warehouseId || canAccessWarehouse(user, unit.warehouseId))
      .filter((unit) => matchesFilter(unit.warehouseId, warehouseId))
      .filter((unit) => matchesFilter(unit.productId, productId))
      .filter((unit) => matchesFilter(unit.locationId, locationId))
      .filter((unit) => matchesFilter(unit.status, status))
      .map(toSerialUnit);
    return HttpResponse.json(
      toPage(items, query, {
        sortable: ['serialNumber', 'sku', 'status', 'receivedAt', 'updatedAt', 'locationCode'],
        defaultSort: 'receivedAt,asc',
        searchIn: (unit) => [unit.serialNumber, unit.sku, unit.productName, unit.lastDocumentCode],
      }),
    );
  }),

  http.get(`${API}/serials/:serialNumber`, ({ request, params }) => {
    const user = authorize(request, 'stock:read');
    const serialNumber = String(params['serialNumber']).trim();
    const units = db.serialUnit.getAll().filter((unit) => unit.serialNumber === serialNumber);
    // Cùng số serial ở nhiều sản phẩm (hiếm): ưu tiên đơn vị đang trong kho.
    const unit = units.find((item) => item.status === 'IN_STOCK') ?? units[0];
    if (!unit) {
      throw errors.notFound(`Không tìm thấy serial ${serialNumber}.`);
    }
    if (unit.warehouseId && !canAccessWarehouse(user, unit.warehouseId)) {
      throw errors.forbidden('Serial thuộc kho bạn không được phân quyền.');
    }
    return HttpResponse.json(toSerialUnit(unit));
  }),

  http.get(`${API}/stock-movements`, ({ request }) => {
    const user = authorize(request, 'stock-movement:read');
    const query = parseListQuery(new URL(request.url));
    const productId = query.params.get('productId');
    const warehouseId = query.params.get('warehouseId');
    const type = query.params.get('type');
    const lotNumber = query.params.get('lotNumber');
    const from = query.params.get('from');
    const to = query.params.get('to');
    if (warehouseId) assertWarehouseAccess(user, warehouseId);
    const items = db.stockMovement
      .getAll()
      .filter((movement) => canAccessWarehouse(user, movement.warehouseId))
      .filter((movement) => matchesFilter(movement.productId, productId))
      .filter((movement) => matchesFilter(movement.warehouseId, warehouseId))
      .filter((movement) => matchesFilter(movement.type, type))
      .filter((movement) => matchesFilter(movement.lotNumber, lotNumber))
      .filter((movement) => inDateRange(toLocalDate(new Date(movement.occurredAt)), from, to))
      .map(toStockMovement);
    return HttpResponse.json(
      toPage(items, query, {
        sortable: ['occurredAt', 'sku', 'quantity', 'documentCode', 'type', 'warehouseName'],
        defaultSort: 'occurredAt,desc',
        searchIn: (movement) => [
          movement.documentCode,
          movement.sku,
          movement.productName,
          movement.lotNumber,
        ],
      }),
    );
  }),
];
