import { http, HttpResponse } from 'msw';

import type {
  ReasonRequest,
  StocktakeCountBatch,
  StocktakeCountResult,
  StocktakeRequest,
  StocktakeStatus,
} from '../../app/core/api/schema';
import { hasPermission } from '../data/rbac';
import { MOCK_CONFIG } from '../config';
import {
  db,
  findById,
  type StocktakeEntity,
  type StocktakeLineEntity,
  type UserEntity,
} from '../db';
import { recordAudit } from '../domain/audit';
import {
  approveStocktake,
  binsInScope,
  findOrCreateLine,
  openStocktake,
  recordCount,
  stocktakeLines,
  stocktakeStats,
} from '../domain/stocktakes';
import { toStocktake, toStocktakeLine, toStocktakeSummary } from '../mappers/document.mapper';
import { authorize } from '../utils/auth';
import { nowIso } from '../utils/date';
import { cleanText, errors, isNonNegativeInt, readJson, Validator } from '../utils/http';
import { matchesFilter, parseListQuery, toPage } from '../utils/query';
import { assertWarehouseAccess, canAccessWarehouse } from '../utils/scope';

const API = MOCK_CONFIG.apiUrl;

const STATUS_LABEL: Record<StocktakeStatus, string> = {
  IN_PROGRESS: 'Đang đếm',
  SUBMITTED: 'Chờ duyệt',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
};
const OPEN_STATUSES: readonly StocktakeStatus[] = ['IN_PROGRESS', 'SUBMITTED'];

function requireStocktake(id: string, user: UserEntity): StocktakeEntity {
  const stocktake = findById('stocktake', id);
  if (!stocktake) {
    throw errors.notFound('Không tìm thấy phiên kiểm kê.');
  }
  assertWarehouseAccess(user, stocktake.warehouseId);
  return stocktake;
}

function requireStatus(stocktake: StocktakeEntity, ...allowed: StocktakeStatus[]): void {
  if (!allowed.includes(stocktake.status)) {
    throw errors.invalidState(
      `Phiên ${stocktake.code} đang ở trạng thái "${STATUS_LABEL[stocktake.status]}", không thực hiện được thao tác này.`,
    );
  }
}

/** Phạm vi giao nhau: một trong hai là toàn kho, hoặc có chung khu. */
function overlaps(a: readonly string[], b: readonly string[]): boolean {
  return a.length === 0 || b.length === 0 || a.some((zoneId) => b.includes(zoneId));
}

function audit(
  user: UserEntity,
  stocktake: StocktakeEntity,
  action: Parameters<typeof recordAudit>[0]['action'],
  summary: string,
  extra: { before?: object; after?: object } = {},
) {
  recordAudit({
    actor: user,
    action,
    entityType: 'STOCKTAKE',
    entityId: stocktake.id,
    entityLabel: stocktake.code,
    summary,
    ...extra,
  });
}

function setStatus(
  stocktake: StocktakeEntity,
  data: Partial<StocktakeEntity> & { status: StocktakeStatus },
): StocktakeEntity {
  return db.stocktake.update({
    where: { id: { equals: stocktake.id } },
    data: { ...data, updatedAt: nowIso() },
  })!;
}

export const stocktakeHandlers = [
  http.get(`${API}/stocktakes`, ({ request }) => {
    const user = authorize(request, 'stocktake:read');
    const query = parseListQuery(new URL(request.url));
    const status = query.params.get('status');
    const warehouseId = query.params.get('warehouseId');
    const linesByStocktake = new Map<string, StocktakeLineEntity[]>();
    for (const line of db.stocktakeLine.getAll()) {
      const list = linesByStocktake.get(line.stocktakeId) ?? [];
      list.push(line);
      linesByStocktake.set(line.stocktakeId, list);
    }
    const items = db.stocktake
      .getAll()
      .filter((stocktake) => canAccessWarehouse(user, stocktake.warehouseId))
      .filter((stocktake) => matchesFilter(stocktake.status, status))
      .filter((stocktake) => matchesFilter(stocktake.warehouseId, warehouseId))
      .map((stocktake) => toStocktakeSummary(stocktake, linesByStocktake.get(stocktake.id) ?? []));
    return HttpResponse.json(
      toPage(items, query, {
        sortable: [
          'code',
          'name',
          'status',
          'createdAt',
          'lineCount',
          'countedLineCount',
          'varianceValue',
          'warehouseName',
        ],
        defaultSort: 'createdAt,desc',
        searchIn: (stocktake) => [
          stocktake.code,
          stocktake.name,
          stocktake.warehouseName,
          stocktake.scopeLabel,
        ],
      }),
    );
  }),

  http.post(`${API}/stocktakes`, async ({ request }) => {
    const user = authorize(request, 'stocktake:write');
    const body = await readJson<StocktakeRequest>(request);
    const warehouse = findById('warehouse', body.warehouseId);
    const zoneIds = Array.isArray(body.zoneIds) ? [...new Set(body.zoneIds)] : [];
    const validator = new Validator()
      .require('warehouseId', body.warehouseId, 'Vui lòng chọn kho.')
      .require('name', body.name, 'Vui lòng đặt tên phiên kiểm kê.')
      .check(typeof body.blind === 'boolean', 'blind', 'Vui lòng chọn hình thức đếm.');
    if (body.warehouseId && (!warehouse || warehouse.status !== 'ACTIVE')) {
      validator.add('warehouseId', 'Kho không tồn tại hoặc đã ngừng hoạt động.');
    }
    zoneIds.forEach((zoneId, index) => {
      const zone = findById('location', zoneId);
      if (!zone || zone.type !== 'ZONE' || zone.warehouseId !== warehouse?.id) {
        validator.add(`zoneIds.${index}`, 'Khu không thuộc kho đã chọn.');
      }
    });
    validator.throwIfInvalid();
    assertWarehouseAccess(user, warehouse!.id);
    if (binsInScope(warehouse!.id, zoneIds).length === 0) {
      throw errors.validation({ zoneIds: ['Phạm vi đã chọn chưa có ô lưu trữ nào.'] });
    }
    const conflicting = db.stocktake
      .getAll()
      .find(
        (stocktake) =>
          stocktake.warehouseId === warehouse!.id &&
          OPEN_STATUSES.includes(stocktake.status) &&
          overlaps(stocktake.zoneIds, zoneIds),
      );
    if (conflicting) {
      throw errors.conflict(
        `Phiên ${conflicting.code} đang kiểm kê cùng phạm vi — hãy hoàn tất hoặc hủy phiên đó trước.`,
      );
    }
    const stocktake = openStocktake({
      warehouse: warehouse!,
      name: body.name!.trim(),
      zoneIds,
      blind: body.blind!,
      note: cleanText(body.note),
      actor: user,
      occurredAt: nowIso(),
    });
    audit(
      user,
      stocktake,
      'CREATE',
      `Mở phiên kiểm kê ${stocktake.code} — ${warehouse!.name} (${stocktakeLines(stocktake.id).length} dòng)`,
    );
    return HttpResponse.json(toStocktake(stocktake), { status: 201 });
  }),

  http.get(`${API}/stocktakes/:id`, ({ request, params }) => {
    const user = authorize(request, 'stocktake:read');
    return HttpResponse.json(toStocktake(requireStocktake(String(params['id']), user)));
  }),

  http.get(`${API}/stocktakes/:id/lines`, ({ request, params }) => {
    const user = authorize(request, 'stocktake:read');
    const stocktake = requireStocktake(String(params['id']), user);
    const options = {
      hideExpected: stocktake.blind && !hasPermission(user.role, 'stocktake:approve'),
      active: OPEN_STATUSES.includes(stocktake.status),
    };
    const lines = stocktakeLines(stocktake.id)
      .map((line) => toStocktakeLine(line, options))
      .sort(
        (a, b) =>
          a.locationCode.localeCompare(b.locationCode, 'vi', { numeric: true }) ||
          a.sku.localeCompare(b.sku),
      );
    return HttpResponse.json(lines);
  }),

  http.post(`${API}/stocktakes/:id/counts`, async ({ request, params }) => {
    const user = authorize(request, 'stocktake:count');
    const stocktake = requireStocktake(String(params['id']), user);
    requireStatus(stocktake, 'IN_PROGRESS');
    const body = await readJson<StocktakeCountBatch>(request);
    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (entries.length === 0 || entries.length > 500) {
      throw errors.validation({ entries: ['Mỗi lần gửi từ 1 đến 500 số đếm.'] });
    }
    const options = {
      hideExpected: stocktake.blind && !hasPermission(user.role, 'stocktake:approve'),
      active: true,
    };
    const scope = new Set(
      binsInScope(stocktake.warehouseId, stocktake.zoneIds).map((bin) => bin.id),
    );
    const result: StocktakeCountResult = { applied: [], skipped: [] };

    for (const entry of entries) {
      const clientId = typeof entry?.clientId === 'string' ? entry.clientId : '';
      const invalid = (message: string) =>
        result.skipped.push({ clientId, reason: 'INVALID', message });
      if (!clientId) {
        invalid('Thiếu clientId.');
        continue;
      }
      if (!isNonNegativeInt(entry.countedQuantity)) {
        invalid('Số đếm phải là số nguyên ≥ 0.');
        continue;
      }
      if (typeof entry.countedAt !== 'string' || Number.isNaN(Date.parse(entry.countedAt))) {
        invalid('Thời điểm đếm không hợp lệ.');
        continue;
      }
      let line: StocktakeLineEntity | null = null;
      if (entry.lineId) {
        line = findById('stocktakeLine', entry.lineId);
        if (!line || line.stocktakeId !== stocktake.id) {
          invalid('Dòng kiểm kê không thuộc phiên này.');
          continue;
        }
      } else if (entry.locationId && entry.productId) {
        const product = findById('product', entry.productId);
        if (!scope.has(entry.locationId) || !product) {
          invalid('Ô hoặc sản phẩm không thuộc phạm vi kiểm kê.');
          continue;
        }
        line = findOrCreateLine(stocktake, entry.locationId, product.id);
      } else {
        invalid('Cần lineId hoặc cặp locationId + productId.');
        continue;
      }
      const outcome = recordCount(line, {
        countedQuantity: entry.countedQuantity,
        countedAt: new Date(entry.countedAt).toISOString(),
        actor: user,
        note: cleanText(entry.note),
        clientId,
      });
      if (outcome.applied) {
        result.applied.push({ clientId, line: toStocktakeLine(outcome.line, options) });
      } else {
        result.skipped.push({
          clientId,
          reason: 'STALE',
          message: 'Đã có số đếm mới hơn từ thiết bị khác.',
          line: toStocktakeLine(outcome.line, options),
        });
      }
    }
    if (result.applied.length > 0) {
      db.stocktake.update({
        where: { id: { equals: stocktake.id } },
        data: { updatedAt: nowIso() },
      });
      audit(
        user,
        stocktake,
        'COUNT',
        `Ghi nhận ${result.applied.length} số đếm${result.skipped.length ? ` (bỏ qua ${result.skipped.length})` : ''}`,
      );
    }
    return HttpResponse.json(result);
  }),

  http.post(`${API}/stocktakes/:id/submit`, ({ request, params }) => {
    const user = authorize(request, 'stocktake:count');
    const stocktake = requireStocktake(String(params['id']), user);
    requireStatus(stocktake, 'IN_PROGRESS');
    if (stocktakeStats(stocktake).countedLineCount === 0) {
      throw errors.validation({}, 'Chưa có dòng nào được đếm — không thể gửi duyệt.');
    }
    const updated = setStatus(stocktake, {
      status: 'SUBMITTED',
      submittedById: user.id,
      submittedAt: nowIso(),
    });
    audit(user, updated, 'SUBMIT', `Gửi duyệt kết quả kiểm kê ${updated.code}`, {
      before: { status: STATUS_LABEL[stocktake.status] },
      after: { status: STATUS_LABEL[updated.status] },
    });
    return HttpResponse.json(toStocktake(updated));
  }),

  http.post(`${API}/stocktakes/:id/reopen`, ({ request, params }) => {
    const user = authorize(request, 'stocktake:approve');
    const stocktake = requireStocktake(String(params['id']), user);
    requireStatus(stocktake, 'SUBMITTED');
    const updated = setStatus(stocktake, {
      status: 'IN_PROGRESS',
      submittedById: null,
      submittedAt: null,
    });
    audit(user, updated, 'REOPEN', `Mở lại phiên ${updated.code} để đếm bổ sung`, {
      before: { status: STATUS_LABEL[stocktake.status] },
      after: { status: STATUS_LABEL[updated.status] },
    });
    return HttpResponse.json(toStocktake(updated));
  }),

  http.post(`${API}/stocktakes/:id/approve`, ({ request, params }) => {
    const user = authorize(request, 'stocktake:approve');
    const stocktake = requireStocktake(String(params['id']), user);
    requireStatus(stocktake, 'SUBMITTED');
    const stats = stocktakeStats(stocktake);
    const approved = approveStocktake(stocktake, { actor: user, occurredAt: nowIso() });
    audit(
      user,
      approved,
      'APPROVE',
      `Duyệt kiểm kê ${approved.code}: điều chỉnh ${stats.varianceLineCount} dòng, chênh lệch ${stats.varianceQuantity >= 0 ? '+' : ''}${stats.varianceQuantity}`,
      {
        before: { status: STATUS_LABEL[stocktake.status] },
        after: { status: STATUS_LABEL[approved.status] },
      },
    );
    return HttpResponse.json(toStocktake(approved));
  }),

  http.post(`${API}/stocktakes/:id/cancel`, async ({ request, params }) => {
    const user = authorize(request, 'stocktake:write');
    const stocktake = requireStocktake(String(params['id']), user);
    requireStatus(stocktake, 'IN_PROGRESS', 'SUBMITTED');
    const body = await readJson<ReasonRequest>(request);
    new Validator().require('reason', body.reason, 'Vui lòng nhập lý do hủy.').throwIfInvalid();
    const updated = setStatus(stocktake, {
      status: 'CANCELLED',
      cancelledById: user.id,
      cancelledAt: nowIso(),
      cancelReason: body.reason!.trim(),
    });
    audit(user, updated, 'CANCEL', `Hủy phiên kiểm kê ${updated.code}: ${body.reason}`, {
      before: { status: STATUS_LABEL[stocktake.status] },
      after: { status: STATUS_LABEL[updated.status] },
    });
    return HttpResponse.json(toStocktake(updated));
  }),
];
