import { http, HttpResponse } from 'msw';

import type {
  ReasonRequest,
  TransferReceiveRequest,
  TransferRequest,
  TransferStatus,
} from '../../app/core/api/schema';
import { MOCK_CONFIG } from '../config';
import { db, findById, type TransferEntity, type UserEntity } from '../db';
import { recordAudit } from '../domain/audit';
import { nextDocumentCode } from '../domain/document-code';
import { InsufficientStockError } from '../domain/inventory';
import { cancelTransfer, receiveTransfer, shipTransfer, transferLines } from '../domain/transfers';
import { toTransfer, toTransferSummary } from '../mappers/document.mapper';
import { authorize } from '../utils/auth';
import { nowIso, toLocalDate } from '../utils/date';
import {
  cleanText,
  DATE_PATTERN,
  errors,
  isNonNegativeInt,
  noContent,
  readJson,
  Validator,
} from '../utils/http';
import { inDateRange, matchesFilter, parseListQuery, toPage } from '../utils/query';
import { assertWarehouseAccess, canAccessWarehouse } from '../utils/scope';

const API = MOCK_CONFIG.apiUrl;

const STATUS_LABEL: Record<TransferStatus, string> = {
  DRAFT: 'Nháp',
  IN_TRANSIT: 'Đang vận chuyển',
  RECEIVED: 'Đã nhận',
  CANCELLED: 'Đã hủy',
};

function requireTransfer(id: string, user: UserEntity): TransferEntity {
  const transfer = findById('transfer', id);
  if (!transfer) {
    throw errors.notFound('Không tìm thấy phiếu chuyển kho.');
  }
  if (
    !canAccessWarehouse(user, transfer.fromWarehouseId) &&
    !canAccessWarehouse(user, transfer.toWarehouseId)
  ) {
    throw errors.forbidden('Bạn không được phân quyền tại kho đi hoặc kho đến của phiếu này.');
  }
  return transfer;
}

function requireStatus(transfer: TransferEntity, ...allowed: TransferStatus[]): void {
  if (!allowed.includes(transfer.status)) {
    throw errors.invalidState(
      `Phiếu ${transfer.code} đang ở trạng thái "${STATUS_LABEL[transfer.status]}", không thực hiện được thao tác này.`,
    );
  }
}

/** Validate & chuẩn hóa nội dung phiếu (dùng cho tạo và sửa). */
function validateTransfer(body: Partial<TransferRequest>, user: UserEntity) {
  const validator = new Validator()
    .require('fromWarehouseId', body.fromWarehouseId, 'Vui lòng chọn kho đi.')
    .require('toWarehouseId', body.toWarehouseId, 'Vui lòng chọn kho đến.')
    .require('transferDate', body.transferDate, 'Vui lòng chọn ngày chuyển.');
  const from = findById('warehouse', body.fromWarehouseId);
  const to = findById('warehouse', body.toWarehouseId);
  if (body.fromWarehouseId && (!from || from.status !== 'ACTIVE')) {
    validator.add('fromWarehouseId', 'Kho đi không tồn tại hoặc đã ngừng hoạt động.');
  }
  if (body.toWarehouseId && (!to || to.status !== 'ACTIVE')) {
    validator.add('toWarehouseId', 'Kho đến không tồn tại hoặc đã ngừng hoạt động.');
  }
  if (from && to && from.id === to.id) {
    validator.add('toWarehouseId', 'Kho đến phải khác kho đi.');
  }
  if (body.transferDate && !DATE_PATTERN.test(body.transferDate)) {
    validator.add('transferDate', 'Ngày không hợp lệ.');
  }
  if (body.expectedDate && body.transferDate && body.expectedDate < body.transferDate) {
    validator.add('expectedDate', 'Ngày dự kiến đến không được trước ngày chuyển.');
  }
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) {
    validator.add('lines', 'Phiếu cần ít nhất một dòng hàng.');
  }
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    const product = findById('product', line?.productId);
    if (!product) {
      validator.add(`lines.${index}.productId`, 'Vui lòng chọn sản phẩm.');
    } else if (product.status !== 'ACTIVE') {
      validator.add(`lines.${index}.productId`, 'Sản phẩm đã ngừng kinh doanh.');
    } else if (seen.has(product.id)) {
      validator.add(`lines.${index}.productId`, 'Sản phẩm bị lặp trong phiếu.');
    }
    if (product) seen.add(product.id);
    if (!(Number.isInteger(line?.quantity) && line.quantity >= 1)) {
      validator.add(`lines.${index}.quantity`, 'Số lượng phải là số nguyên ≥ 1.');
    }
    if (line?.fromLocationId) {
      const location = findById('location', line.fromLocationId);
      if (!location || location.type !== 'BIN' || location.warehouseId !== from?.id) {
        validator.add(`lines.${index}.fromLocationId`, 'Ô lấy hàng không thuộc kho đi.');
      }
    }
  });
  validator.throwIfInvalid();
  assertWarehouseAccess(user, from!.id);
  return {
    from: from!,
    to: to!,
    transferDate: body.transferDate!,
    expectedDate: cleanText(body.expectedDate),
    note: cleanText(body.note),
    lines: lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      fromLocationId: line.fromLocationId ?? null,
    })),
  };
}

function replaceLines(
  transferId: string,
  lines: ReturnType<typeof validateTransfer>['lines'],
): void {
  for (const line of transferLines(transferId)) {
    db.transferLine.delete({ where: { id: { equals: line.id } } });
  }
  lines.forEach((line, index) =>
    db.transferLine.create({
      transferId,
      lineNo: index + 1,
      productId: line.productId,
      quantity: line.quantity,
      fromLocationId: line.fromLocationId,
      picks: '[]',
      unitCost: null,
      receivedQuantity: null,
      toLocationId: null,
    }),
  );
}

function snapshot(transfer: TransferEntity) {
  const summary = toTransferSummary(transfer);
  return {
    fromWarehouse: summary.fromWarehouseName,
    toWarehouse: summary.toWarehouseName,
    transferDate: transfer.transferDate,
    expectedDate: transfer.expectedDate,
    note: transfer.note,
    lines: transferLines(transfer.id).map(
      (line) => `${findById('product', line.productId)?.sku} × ${line.quantity}`,
    ),
  };
}

function audit(
  user: UserEntity,
  transfer: TransferEntity,
  action: Parameters<typeof recordAudit>[0]['action'],
  summary: string,
  extra: { before?: object; after?: object } = {},
) {
  recordAudit({
    actor: user,
    action,
    entityType: 'TRANSFER',
    entityId: transfer.id,
    entityLabel: transfer.code,
    summary,
    ...extra,
  });
}

export const transferHandlers = [
  http.get(`${API}/transfers`, ({ request }) => {
    const user = authorize(request, 'transfer:read');
    const query = parseListQuery(new URL(request.url));
    const status = query.params.get('status');
    const fromWarehouseId = query.params.get('fromWarehouseId');
    const toWarehouseId = query.params.get('toWarehouseId');
    const from = query.params.get('from');
    const to = query.params.get('to');
    const linesByTransfer = new Map<string, ReturnType<typeof transferLines>>();
    for (const line of db.transferLine.getAll()) {
      const list = linesByTransfer.get(line.transferId) ?? [];
      list.push(line);
      linesByTransfer.set(line.transferId, list);
    }
    const items = db.transfer
      .getAll()
      .filter(
        (transfer) =>
          canAccessWarehouse(user, transfer.fromWarehouseId) ||
          canAccessWarehouse(user, transfer.toWarehouseId),
      )
      .filter((transfer) => matchesFilter(transfer.status, status))
      .filter((transfer) => matchesFilter(transfer.fromWarehouseId, fromWarehouseId))
      .filter((transfer) => matchesFilter(transfer.toWarehouseId, toWarehouseId))
      .filter((transfer) => inDateRange(transfer.transferDate, from, to))
      .map((transfer) => toTransferSummary(transfer, linesByTransfer.get(transfer.id) ?? []));
    return HttpResponse.json(
      toPage(items, query, {
        sortable: [
          'code',
          'transferDate',
          'status',
          'totalQuantity',
          'createdAt',
          'fromWarehouseName',
          'toWarehouseName',
        ],
        defaultSort: 'createdAt,desc',
        searchIn: (transfer) => [
          transfer.code,
          transfer.fromWarehouseName,
          transfer.toWarehouseName,
          transfer.createdBy.fullName,
        ],
      }),
    );
  }),

  http.post(`${API}/transfers`, async ({ request }) => {
    const user = authorize(request, 'transfer:write');
    const input = validateTransfer(await readJson<TransferRequest>(request), user);
    const now = nowIso();
    const transfer = db.transfer.create({
      code: nextDocumentCode('CK', toLocalDate(new Date())),
      fromWarehouseId: input.from.id,
      toWarehouseId: input.to.id,
      status: 'DRAFT',
      transferDate: input.transferDate,
      expectedDate: input.expectedDate,
      note: input.note,
      receiveNote: null,
      createdById: user.id,
      createdAt: now,
      updatedAt: now,
      shippedById: null,
      shippedAt: null,
      receivedById: null,
      receivedAt: null,
      cancelledById: null,
      cancelledAt: null,
      cancelReason: null,
    });
    replaceLines(transfer.id, input.lines);
    audit(
      user,
      transfer,
      'CREATE',
      `Tạo phiếu chuyển kho ${transfer.code}: ${input.from.name} → ${input.to.name}`,
      {
        after: snapshot(transfer),
      },
    );
    return HttpResponse.json(toTransfer(transfer), { status: 201 });
  }),

  http.get(`${API}/transfers/:id`, ({ request, params }) => {
    const user = authorize(request, 'transfer:read');
    return HttpResponse.json(toTransfer(requireTransfer(String(params['id']), user)));
  }),

  http.put(`${API}/transfers/:id`, async ({ request, params }) => {
    const user = authorize(request, 'transfer:write');
    const transfer = requireTransfer(String(params['id']), user);
    requireStatus(transfer, 'DRAFT');
    const before = snapshot(transfer);
    const input = validateTransfer(await readJson<TransferRequest>(request), user);
    const updated = db.transfer.update({
      where: { id: { equals: transfer.id } },
      data: {
        fromWarehouseId: input.from.id,
        toWarehouseId: input.to.id,
        transferDate: input.transferDate,
        expectedDate: input.expectedDate,
        note: input.note,
        updatedAt: nowIso(),
      },
    })!;
    replaceLines(updated.id, input.lines);
    audit(user, updated, 'UPDATE', `Sửa phiếu chuyển kho ${updated.code}`, {
      before,
      after: snapshot(updated),
    });
    return HttpResponse.json(toTransfer(updated));
  }),

  http.delete(`${API}/transfers/:id`, ({ request, params }) => {
    const user = authorize(request, 'transfer:write');
    const transfer = requireTransfer(String(params['id']), user);
    requireStatus(transfer, 'DRAFT');
    assertWarehouseAccess(user, transfer.fromWarehouseId);
    const before = snapshot(transfer);
    for (const line of transferLines(transfer.id)) {
      db.transferLine.delete({ where: { id: { equals: line.id } } });
    }
    db.transfer.delete({ where: { id: { equals: transfer.id } } });
    audit(user, transfer, 'DELETE', `Xóa phiếu chuyển kho nháp ${transfer.code}`, { before });
    return noContent();
  }),

  http.post(`${API}/transfers/:id/ship`, ({ request, params }) => {
    const user = authorize(request, 'transfer:write');
    const transfer = requireTransfer(String(params['id']), user);
    requireStatus(transfer, 'DRAFT');
    assertWarehouseAccess(user, transfer.fromWarehouseId);
    try {
      const shipped = shipTransfer(transfer, { actor: user, occurredAt: nowIso() });
      audit(user, shipped, 'SHIP', `Xuất hàng đi cho phiếu ${shipped.code}`, {
        before: { status: STATUS_LABEL[transfer.status] },
        after: { status: STATUS_LABEL[shipped.status] },
      });
      return HttpResponse.json(toTransfer(shipped));
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        const details: Record<string, string[]> = {};
        for (const shortage of error.shortages) {
          details[`lines.${shortage.index}.quantity`] = [
            `${shortage.sku}: kho đi chỉ còn ${shortage.available}, cần ${shortage.requested}.`,
          ];
        }
        throw errors.insufficientStock(details, 'Kho đi không đủ tồn để xuất chuyển.');
      }
      throw error;
    }
  }),

  http.post(`${API}/transfers/:id/receive`, async ({ request, params }) => {
    const user = authorize(request, 'transfer:receive');
    const transfer = requireTransfer(String(params['id']), user);
    requireStatus(transfer, 'IN_TRANSIT');
    assertWarehouseAccess(user, transfer.toWarehouseId);
    const body = await readJson<TransferReceiveRequest>(request);
    const lines = transferLines(transfer.id);
    const requested = Array.isArray(body.lines) ? body.lines : [];
    const validator = new Validator();
    requested.forEach((entry, index) => {
      const line = lines.find((item) => item.id === entry?.lineId);
      if (!line) {
        validator.add(`lines.${index}.lineId`, 'Dòng không thuộc phiếu.');
        return;
      }
      if (!isNonNegativeInt(entry.receivedQuantity) || entry.receivedQuantity > line.quantity) {
        validator.add(`lines.${index}.receivedQuantity`, `Số nhận từ 0 đến ${line.quantity}.`);
      }
      if (entry.toLocationId) {
        const location = findById('location', entry.toLocationId);
        if (
          !location ||
          location.type !== 'BIN' ||
          location.warehouseId !== transfer.toWarehouseId ||
          location.status !== 'ACTIVE'
        ) {
          validator.add(
            `lines.${index}.toLocationId`,
            'Ô cất hàng không thuộc kho đến hoặc đã ngừng sử dụng.',
          );
        }
      }
    });
    validator.throwIfInvalid();

    const received = receiveTransfer(
      transfer,
      requested.map((entry) => ({
        lineId: entry.lineId,
        receivedQuantity: entry.receivedQuantity,
        toLocationId: entry.toLocationId ?? null,
      })),
      cleanText(body.note),
      { actor: user, occurredAt: nowIso() },
    );
    const shortfall = transferLines(received.id).reduce(
      (sum, line) => sum + line.quantity - (line.receivedQuantity ?? 0),
      0,
    );
    audit(
      user,
      received,
      'RECEIVE',
      shortfall > 0
        ? `Nhận hàng phiếu ${received.code}, thiếu ${shortfall} so với số xuất`
        : `Nhận đủ hàng phiếu ${received.code}`,
      {
        before: { status: STATUS_LABEL[transfer.status] },
        after: { status: STATUS_LABEL[received.status] },
      },
    );
    return HttpResponse.json(toTransfer(received));
  }),

  http.post(`${API}/transfers/:id/cancel`, async ({ request, params }) => {
    const user = authorize(request, 'transfer:write');
    const transfer = requireTransfer(String(params['id']), user);
    requireStatus(transfer, 'DRAFT', 'IN_TRANSIT');
    assertWarehouseAccess(user, transfer.fromWarehouseId);
    const body = await readJson<ReasonRequest>(request);
    new Validator().require('reason', body.reason, 'Vui lòng nhập lý do hủy.').throwIfInvalid();
    const cancelled = cancelTransfer(transfer, body.reason!.trim(), {
      actor: user,
      occurredAt: nowIso(),
    });
    audit(
      user,
      cancelled,
      'CANCEL',
      transfer.status === 'IN_TRANSIT'
        ? `Hủy phiếu ${cancelled.code} đang vận chuyển, hàng hoàn về kho đi: ${body.reason}`
        : `Hủy phiếu nháp ${cancelled.code}: ${body.reason}`,
      {
        before: { status: STATUS_LABEL[transfer.status] },
        after: { status: STATUS_LABEL[cancelled.status] },
      },
    );
    return HttpResponse.json(toTransfer(cancelled));
  }),
];
