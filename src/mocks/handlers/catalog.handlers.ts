import { http, HttpResponse } from 'msw';

import type {
  BinStockItem,
  Product,
  ProductStatus,
  StockItem,
  StockStatus,
} from '../../app/core/api/schema';
import { MOCK_CONFIG } from '../config';
import { db, findById } from '../db';
import { stockStatusOf } from '../domain/inventory';
import { descendantIds, locationsOf } from '../domain/locations';
import { toBinStockItem, toProduct, toStockItem } from '../mappers/warehouse.mapper';
import { authorize } from '../utils/auth';
import { errors } from '../utils/http';
import { matchesFilter, parseListQuery, toPage } from '../utils/query';
import { assertWarehouseAccess, canAccessWarehouse } from '../utils/scope';

const API = MOCK_CONFIG.apiUrl;

function totalStockByProduct(): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of db.stockItem.getAll()) {
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
  }
  return totals;
}

function productDto(id: string): Product | null {
  const product = findById('product', id);
  if (!product) return null;
  const total = db.stockItem
    .getAll()
    .filter((item) => item.productId === id)
    .reduce((sum, item) => sum + item.quantity, 0);
  return toProduct(product, total);
}

/**
 * Sản phẩm & tồn kho — phần ĐỌC phục vụ ô chọn hàng, chuyển kho, kiểm kê, sơ đồ kho.
 * (Tạo/sửa sản phẩm thuộc giai đoạn Hàng hóa.)
 */
export const catalogHandlers = [
  http.get(`${API}/products`, ({ request }) => {
    authorize(request, 'product:read');
    const query = parseListQuery(new URL(request.url));
    const categoryId = query.params.get('categoryId');
    const status = query.params.get('status') as ProductStatus | null;
    const stockStatus = query.params.get('stockStatus') as StockStatus | null;
    const totals = totalStockByProduct();
    const items = db.product
      .getAll()
      .filter(
        (product) =>
          !categoryId ||
          product.category?.id === categoryId ||
          product.category?.parent?.id === categoryId,
      )
      .filter((product) => matchesFilter(product.status, status))
      .map((product) => toProduct(product, totals.get(product.id) ?? 0))
      .filter(
        (product) =>
          !stockStatus || stockStatusOf(product.totalStock, product.minStock) === stockStatus,
      );
    return HttpResponse.json(
      toPage(items, query, {
        sortable: [
          'sku',
          'name',
          'categoryName',
          'costPrice',
          'salePrice',
          'totalStock',
          'createdAt',
        ],
        defaultSort: 'sku,asc',
        searchIn: (product) => [product.sku, product.name, product.barcode],
      }),
    );
  }),

  http.get(`${API}/products/by-barcode/:barcode`, ({ request, params }) => {
    authorize(request, 'product:read');
    const product = db.product.getAll().find((item) => item.barcode === String(params['barcode']));
    if (!product) {
      throw errors.notFound(`Không tìm thấy sản phẩm có mã vạch ${String(params['barcode'])}.`);
    }
    return HttpResponse.json(productDto(product.id)!);
  }),

  http.get(`${API}/products/:id`, ({ request, params }) => {
    authorize(request, 'product:read');
    const product = productDto(String(params['id']));
    if (!product) {
      throw errors.notFound('Không tìm thấy sản phẩm.');
    }
    return HttpResponse.json(product);
  }),

  http.get(`${API}/stock`, ({ request }) => {
    const user = authorize(request, 'stock:read');
    const query = parseListQuery(new URL(request.url));
    const warehouseId = query.params.get('warehouseId');
    const categoryId = query.params.get('categoryId');
    const status = query.params.get('status') as StockStatus | null;
    if (warehouseId) {
      assertWarehouseAccess(user, warehouseId);
    }
    const items: StockItem[] = db.stockItem
      .getAll()
      .filter((item) => canAccessWarehouse(user, item.warehouseId))
      .filter((item) => matchesFilter(item.warehouseId, warehouseId))
      .filter((item) => {
        if (!categoryId) return true;
        const category = findById('product', item.productId)?.category;
        return category?.id === categoryId || category?.parent?.id === categoryId;
      })
      .map(toStockItem)
      .filter((item) => matchesFilter(item.status, status));
    return HttpResponse.json(
      toPage(items, query, {
        sortable: [
          'sku',
          'productName',
          'warehouseName',
          'quantity',
          'stockValue',
          'averageCost',
          'lastMovementAt',
        ],
        defaultSort: 'sku,asc',
        searchIn: (item) => [item.sku, item.productName, item.warehouseName],
      }),
    );
  }),

  http.get(`${API}/stock/by-product/:productId`, ({ request, params }) => {
    const user = authorize(request, 'stock:read');
    const productId = String(params['productId']);
    if (!findById('product', productId)) {
      throw errors.notFound('Không tìm thấy sản phẩm.');
    }
    const items = db.stockItem
      .getAll()
      .filter((item) => item.productId === productId && canAccessWarehouse(user, item.warehouseId))
      .map(toStockItem);
    return HttpResponse.json(items);
  }),

  http.get(`${API}/stock/bins`, ({ request }) => {
    const user = authorize(request, 'stock:read');
    const query = parseListQuery(new URL(request.url));
    const warehouseId = query.params.get('warehouseId');
    const locationId = query.params.get('locationId');
    const productId = query.params.get('productId');
    if (warehouseId) {
      assertWarehouseAccess(user, warehouseId);
    }
    let scope: Set<string> | null = null;
    if (locationId) {
      const location = findById('location', locationId);
      if (!location) {
        throw errors.notFound('Không tìm thấy vị trí.');
      }
      assertWarehouseAccess(user, location.warehouseId);
      scope = descendantIds(location.id, locationsOf(location.warehouseId));
    }
    const items: BinStockItem[] = db.binStock
      .getAll()
      .filter((bin) => bin.quantity > 0 && canAccessWarehouse(user, bin.warehouseId))
      .filter((bin) => matchesFilter(bin.warehouseId, warehouseId))
      .filter((bin) => matchesFilter(bin.productId, productId))
      .filter((bin) => scope === null || scope.has(bin.locationId))
      .map(toBinStockItem);
    return HttpResponse.json(
      toPage(items, query, {
        sortable: ['locationCode', 'sku', 'productName', 'quantity', 'updatedAt'],
        defaultSort: 'locationCode,asc',
        searchIn: (item) => [item.sku, item.productName, item.locationCode, item.barcode],
      }),
    );
  }),
];
