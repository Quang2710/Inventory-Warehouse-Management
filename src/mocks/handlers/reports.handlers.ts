import { http, HttpResponse } from 'msw';

import type {
  AbcBasis,
  AbcReport,
  AlertType,
  InventorySummaryPage,
  StockValuePage,
} from '../../app/core/api/schema';
import { MOCK_CONFIG } from '../config';
import { db, findById, type UserEntity } from '../db';
import { computeAlerts, summarizeAlerts } from '../domain/alerts';
import { parseExpiringDays } from '../domain/expiry';
import { abcAnalysis, inventorySummary, stockCard, stockValue } from '../domain/reports';
import { authorize } from '../utils/auth';
import { daysBetween, toLocalDate } from '../utils/date';
import { DATE_PATTERN, errors, Validator } from '../utils/http';
import { matchesFilter, parseListQuery, toPage } from '../utils/query';
import { assertWarehouseAccess, canAccessWarehouse } from '../utils/scope';

const API = MOCK_CONFIG.apiUrl;
const MAX_REPORT_DAYS = 366;

/** Kho trong phạm vi báo cáo: kho chỉ định (phải có quyền) hoặc mọi kho người dùng được xem. */
function warehouseScope(user: UserEntity, warehouseId: string | null): Set<string> {
  if (warehouseId) {
    if (!findById('warehouse', warehouseId)) throw errors.notFound('Không tìm thấy kho.');
    assertWarehouseAccess(user, warehouseId);
    return new Set([warehouseId]);
  }
  return new Set(
    db.warehouse
      .getAll()
      .filter((warehouse) => canAccessWarehouse(user, warehouse.id))
      .map((warehouse) => warehouse.id),
  );
}

function dateRange(params: URLSearchParams): { from: string; to: string } {
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const validator = new Validator()
    .require('from', from, 'Vui lòng chọn từ ngày.')
    .require('to', to, 'Vui lòng chọn đến ngày.');
  if (from && !DATE_PATTERN.test(from)) validator.add('from', 'Ngày không hợp lệ.');
  if (to && !DATE_PATTERN.test(to)) validator.add('to', 'Ngày không hợp lệ.');
  if (DATE_PATTERN.test(from) && DATE_PATTERN.test(to)) {
    if (from > to) validator.add('to', 'Đến ngày phải sau hoặc bằng từ ngày.');
    else if (daysBetween(from, to) >= MAX_REPORT_DAYS) {
      validator.add('to', `Khoảng thời gian tối đa ${MAX_REPORT_DAYS} ngày.`);
    }
  }
  validator.throwIfInvalid('Khoảng thời gian báo cáo không hợp lệ.');
  return { from, to };
}

function boundedInt(raw: string | null, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return raw !== null && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export const reportHandlers = [
  // ── Cảnh báo ──
  http.get(`${API}/alerts`, ({ request }) => {
    const user = authorize(request, 'stock:read');
    const query = parseListQuery(new URL(request.url));
    const type = query.params.get('type') as AlertType | null;
    const expiringDays = parseExpiringDays(query.params.get('days'));
    const alerts = computeAlerts({
      warehouseIds: warehouseScope(user, query.params.get('warehouseId')),
      asOf: toLocalDate(new Date()),
      expiringDays,
    }).filter((alert) => matchesFilter(alert.type, type));
    return HttpResponse.json(
      toPage(alerts, query, {
        sortable: [
          'sku',
          'productName',
          'warehouseName',
          'quantity',
          'expiryDate',
          'daysToExpiry',
          'value',
          'type',
        ],
        searchIn: (alert) => [alert.sku, alert.productName, alert.lotNumber, alert.warehouseName],
      }),
    );
  }),

  http.get(`${API}/alerts/summary`, ({ request }) => {
    const user = authorize(request, 'stock:read');
    const params = new URL(request.url).searchParams;
    const expiringDays = parseExpiringDays(params.get('days'));
    const alerts = computeAlerts({
      warehouseIds: warehouseScope(user, params.get('warehouseId')),
      asOf: toLocalDate(new Date()),
      expiringDays,
    });
    return HttpResponse.json(summarizeAlerts(alerts, expiringDays));
  }),

  // ── Báo cáo ──
  http.get(`${API}/reports/stock-card`, ({ request }) => {
    const user = authorize(request, 'stock-movement:read');
    const params = new URL(request.url).searchParams;
    const productId = params.get('productId');
    if (!productId) {
      throw errors.validation({ productId: ['Vui lòng chọn sản phẩm.'] });
    }
    const product = findById('product', productId);
    if (!product) throw errors.notFound('Không tìm thấy sản phẩm.');
    const warehouseId = params.get('warehouseId');
    return HttpResponse.json(
      stockCard(product, {
        ...dateRange(params),
        warehouseIds: warehouseScope(user, warehouseId),
        warehouseId,
        lotNumber: params.get('lotNumber')?.trim() || null,
      }),
    );
  }),

  http.get(`${API}/reports/inventory-summary`, ({ request }) => {
    const user = authorize(request, 'report:read');
    const query = parseListQuery(new URL(request.url));
    const range = dateRange(query.params);
    const { rows, totals } = inventorySummary({
      ...range,
      warehouseIds: warehouseScope(user, query.params.get('warehouseId')),
      categoryId: query.params.get('categoryId'),
      onlyActive: query.params.get('onlyActive') !== 'false',
    });
    const page = toPage(rows, query, {
      sortable: [
        'sku',
        'productName',
        'categoryName',
        'openingQuantity',
        'inboundQuantity',
        'outboundQuantity',
        'closingQuantity',
        'closingValue',
        'inboundValue',
        'outboundValue',
      ],
      defaultSort: 'sku,asc',
      searchIn: (row) => [row.sku, row.productName, row.categoryName],
    });
    const body: InventorySummaryPage = { ...page, ...range, totals };
    return HttpResponse.json(body);
  }),

  http.get(`${API}/reports/stock-value`, ({ request }) => {
    const user = authorize(request, 'report:read');
    const query = parseListQuery(new URL(request.url));
    const result = stockValue({
      warehouseIds: warehouseScope(user, query.params.get('warehouseId')),
      categoryId: query.params.get('categoryId'),
    });
    const page = toPage(result.rows, query, {
      sortable: ['sku', 'productName', 'categoryName', 'quantity', 'averageCost', 'value'],
      defaultSort: 'value,desc',
      searchIn: (row) => [row.sku, row.productName, row.categoryName],
    });
    const body: StockValuePage = {
      ...page,
      totalQuantity: result.totalQuantity,
      totalValue: result.totalValue,
      byCategory: result.byCategory,
      byWarehouse: result.byWarehouse,
    };
    return HttpResponse.json(body);
  }),

  http.get(`${API}/reports/abc`, ({ request }) => {
    const user = authorize(request, 'report:read');
    const query = parseListQuery(new URL(request.url));
    const range = dateRange(query.params);
    const basis = (query.params.get('basis') as AbcBasis | null) ?? 'ISSUE_VALUE';
    if (basis !== 'ISSUE_VALUE' && basis !== 'STOCK_VALUE') {
      throw errors.validation({ basis: ['Tiêu chí không hợp lệ.'] });
    }
    const thresholdA = boundedInt(query.params.get('thresholdA'), 80, 50, 95);
    const thresholdB = boundedInt(query.params.get('thresholdB'), 95, 55, 99);
    if (thresholdB <= thresholdA) {
      throw errors.validation({ thresholdB: ['Ngưỡng nhóm B phải lớn hơn ngưỡng nhóm A.'] });
    }
    const result = abcAnalysis({
      ...range,
      warehouseIds: warehouseScope(user, query.params.get('warehouseId')),
      basis,
      thresholdA,
      thresholdB,
    });
    const abcClass = query.params.get('abcClass');
    const page = toPage(
      result.rows.filter((row) => matchesFilter(row.abcClass, abcClass)),
      query,
      {
        sortable: ['rank', 'sku', 'productName', 'value', 'quantity'],
        defaultSort: 'rank,asc',
        searchIn: (row) => [row.sku, row.productName, row.categoryName],
      },
    );
    const body: AbcReport = {
      ...page,
      ...range,
      basis,
      thresholdA,
      thresholdB,
      totalValue: result.totalValue,
      classes: result.classes,
      pareto: result.pareto,
    };
    return HttpResponse.json(body);
  }),
];
