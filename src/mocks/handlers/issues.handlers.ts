import { http, HttpResponse } from 'msw';

import type {
  AllocationPreview,
  AllocationPreviewRequest,
  GoodsIssueRequest,
  IssueReason,
  ReasonRequest,
} from '../../app/core/api/schema';
import { MOCK_CONFIG } from '../config';
import { db, findById, type GoodsIssueEntity, type UserEntity } from '../db';
import { lotExists, toStockPick } from '../domain/allocation';
import { recordAudit } from '../domain/audit';
import { nextDocumentCode } from '../domain/document-code';
import { isLotManaged } from '../domain/inventory';
import {
  allocateIssueLines,
  approveIssue,
  cancelIssue,
  includesExpired,
  issueLines,
  type IssueAllocationLine,
} from '../domain/issues';
import { toGoodsIssue, toGoodsIssueSummary } from '../mappers/document.mapper';
import { authorize } from '../utils/auth';
import { nowIso, toLocalDate } from '../utils/date';
import {
  DOCUMENT_STATUS_LABEL,
  MAX_SERIALS_PER_LINE,
  requireDocumentStatus,
  rethrowStockError,
} from '../utils/documents';
import {
  cleanText,
  DATE_PATTERN,
  errors,
  noContent,
  readJson,
  Validator,
  type FieldErrors,
} from '../utils/http';
import { inDateRange, matchesFilter, parseListQuery, toPage } from '../utils/query';
import { assertWarehouseAccess, canAccessWarehouse } from '../utils/scope';

const API = MOCK_CONFIG.apiUrl;

const REASONS: readonly IssueReason[] = [
  'SALE',
  'RETURN_TO_SUPPLIER',
  'INTERNAL_USE',
  'DAMAGED',
  'OTHER',
];

function requireIssue(id: string, user: UserEntity): GoodsIssueEntity {
  const issue = findById('goodsIssue', id);
  if (!issue) {
    throw errors.notFound('Không tìm thấy phiếu xuất.');
  }
  assertWarehouseAccess(user, issue.warehouseId);
  return issue;
}

interface RawLine {
  productId?: string;
  quantity?: number;
  unitPrice?: number;
  lotNumber?: string | null;
  serialNumbers?: string[];
}

/** Validate dòng xuất (dùng cho lưu phiếu và gợi ý phân bổ). */
function validateLines(
  validator: Validator,
  rawLines: readonly RawLine[] | undefined,
  warehouseId: string | undefined,
  options: { requirePrice: boolean },
) {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  if (lines.length === 0) {
    validator.add('lines', 'Phiếu cần ít nhất một dòng hàng.');
  }
  return lines.map((line, index) => {
    const path = `lines.${index}`;
    const product = findById('product', line?.productId);
    if (!product) {
      validator.add(`${path}.productId`, 'Vui lòng chọn sản phẩm.');
    } else if (product.status !== 'ACTIVE') {
      validator.add(`${path}.productId`, 'Sản phẩm đã ngừng kinh doanh.');
    }
    const quantity = line?.quantity;
    if (!(Number.isInteger(quantity) && quantity! >= 1 && quantity! <= 1_000_000)) {
      validator.add(`${path}.quantity`, 'Số lượng phải là số nguyên từ 1 đến 1.000.000.');
    }
    if (options.requirePrice && !(Number.isInteger(line?.unitPrice) && line.unitPrice! >= 0)) {
      validator.add(`${path}.unitPrice`, 'Đơn giá phải là số nguyên ≥ 0.');
    }
    const lotNumber = cleanText(line?.lotNumber);
    if (lotNumber && product) {
      if (!isLotManaged(product)) {
        validator.add(`${path}.lotNumber`, 'Sản phẩm không quản lý theo lô.');
      } else if (warehouseId && !lotExists(product.id, warehouseId, lotNumber)) {
        validator.add(`${path}.lotNumber`, `Kho không còn tồn lô ${lotNumber}.`);
      }
    }
    const serialNumbers = (Array.isArray(line?.serialNumbers) ? line.serialNumbers : [])
      .map((serial: unknown) => String(serial ?? '').trim())
      .filter(Boolean);
    if (serialNumbers.length > 0 && product) {
      if (!product.trackSerial) {
        validator.add(`${path}.serialNumbers`, 'Sản phẩm không quản lý serial.');
      } else if (serialNumbers.length !== quantity) {
        validator.add(
          `${path}.serialNumbers`,
          `Đã chọn ${serialNumbers.length} serial — cần đúng ${quantity} (hoặc để trống để hệ thống chọn).`,
        );
      } else if (new Set(serialNumbers).size !== serialNumbers.length) {
        validator.add(`${path}.serialNumbers`, 'Serial bị lặp.');
      }
    }
    if (product?.trackSerial && Number.isInteger(quantity) && quantity! > MAX_SERIALS_PER_LINE) {
      validator.add(`${path}.quantity`, `Tối đa ${MAX_SERIALS_PER_LINE} đơn vị serial mỗi dòng.`);
    }
    return {
      productId: String(line?.productId ?? ''),
      quantity: quantity!,
      unitPrice: line?.unitPrice ?? 0,
      lotNumber,
      serialNumbers,
    };
  });
}

function validateIssue(body: Partial<GoodsIssueRequest>, user: UserEntity) {
  const validator = new Validator()
    .require('warehouseId', body.warehouseId, 'Vui lòng chọn kho xuất.')
    .require('issueDate', body.issueDate, 'Vui lòng chọn ngày xuất.')
    .require('reason', body.reason, 'Vui lòng chọn lý do xuất.');
  const warehouse = findById('warehouse', body.warehouseId);
  if (body.warehouseId && (!warehouse || warehouse.status !== 'ACTIVE')) {
    validator.add('warehouseId', 'Kho không tồn tại hoặc đã ngừng hoạt động.');
  }
  if (body.reason && !REASONS.includes(body.reason)) {
    validator.add('reason', 'Lý do xuất không hợp lệ.');
  }
  const customer = body.customerId ? findById('customer', body.customerId) : null;
  if (body.customerId && (!customer || customer.status !== 'ACTIVE')) {
    validator.add('customerId', 'Khách hàng không tồn tại hoặc đã ngừng giao dịch.');
  }
  const customerName = cleanText(body.customerName) ?? customer?.name ?? null;
  if (!customerName) {
    validator.add('customerName', 'Vui lòng nhập khách hàng / bộ phận nhận.');
  } else if (customerName.length > 200) {
    validator.add('customerName', 'Tối đa 200 ký tự.');
  }
  const issueDate = body.issueDate ?? '';
  if (issueDate && !DATE_PATTERN.test(issueDate)) {
    validator.add('issueDate', 'Ngày không hợp lệ.');
  } else if (issueDate > toLocalDate(new Date())) {
    validator.add('issueDate', 'Ngày xuất không được sau hôm nay.');
  }
  const referenceNo = cleanText(body.referenceNo);
  if (referenceNo && referenceNo.length > 50) validator.add('referenceNo', 'Tối đa 50 ký tự.');
  const note = cleanText(body.note);
  if (note && note.length > 1000) validator.add('note', 'Tối đa 1000 ký tự.');
  const lines = validateLines(validator, body.lines, warehouse?.id, { requirePrice: true });
  validator.throwIfInvalid();
  assertWarehouseAccess(user, warehouse!.id);
  return {
    warehouse: warehouse!,
    customerId: customer?.id ?? null,
    customerName: customerName!,
    reason: body.reason!,
    referenceNo,
    issueDate,
    note,
    lines,
  };
}

function replaceLines(issueId: string, lines: ReturnType<typeof validateIssue>['lines']): void {
  for (const line of issueLines(issueId)) {
    db.goodsIssueLine.delete({ where: { id: { equals: line.id } } });
  }
  lines.forEach((line, index) =>
    db.goodsIssueLine.create({
      goodsIssueId: issueId,
      lineNo: index + 1,
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      unitCost: null,
      lotNumber: line.lotNumber,
      serialNumbers: line.serialNumbers,
      picks: '[]',
    }),
  );
}

/** Kiểm tra đủ tồn theo FEFO cho toàn phiếu — ném 422 theo dòng nếu thiếu. */
function assertAllocatable(issue: GoodsIssueEntity): void {
  const lines = issueLines(issue.id);
  const results = allocateIssueLines(
    issue.warehouseId,
    issue.reason,
    lines.map((line) => ({
      product: findById('product', line.productId)!,
      quantity: line.quantity,
      lotNumber: line.lotNumber,
      serialNumbers: line.serialNumbers,
    })),
    toLocalDate(new Date()),
  );
  const details: FieldErrors = {};
  results.forEach((result, index) => {
    const sku = findById('product', lines[index].productId)?.sku;
    if (result.invalidSerials.length > 0) {
      details[`lines.${index}.serialNumbers`] = [
        `Serial không có trong kho: ${result.invalidSerials.join(', ')}.`,
      ];
    }
    if (result.shortage > 0) {
      details[`lines.${index}.quantity`] = [
        shortageMessage(sku ?? '', result, lines[index].quantity),
      ];
    }
  });
  if (Object.keys(details).length > 0) {
    throw errors.insufficientStock(details, 'Không đủ tồn có thể xuất cho phiếu này.');
  }
}

function shortageMessage(
  sku: string,
  result: { available: number; expiredExcluded: number },
  requested: number,
): string {
  const expired =
    result.expiredExcluded > 0 ? ` (không tính ${result.expiredExcluded} thuộc lô hết hạn)` : '';
  return `${sku}: có thể xuất ${result.available}${expired}, cần ${requested}.`;
}

function snapshot(issue: GoodsIssueEntity) {
  return {
    warehouse: findById('warehouse', issue.warehouseId)?.name,
    customerName: issue.customerName,
    reason: issue.reason,
    referenceNo: issue.referenceNo,
    issueDate: issue.issueDate,
    note: issue.note,
    lines: issueLines(issue.id).map((line) =>
      [
        `${findById('product', line.productId)?.sku} × ${line.quantity}`,
        line.lotNumber && `lô ${line.lotNumber}`,
      ]
        .filter(Boolean)
        .join(' · '),
    ),
  };
}

function audit(
  user: UserEntity,
  issue: GoodsIssueEntity,
  action: Parameters<typeof recordAudit>[0]['action'],
  summary: string,
  extra: { before?: object; after?: object } = {},
) {
  recordAudit({
    actor: user,
    action,
    entityType: 'GOODS_ISSUE',
    entityId: issue.id,
    entityLabel: issue.code,
    summary,
    ...extra,
  });
}

const statusChange = (from: GoodsIssueEntity, to: GoodsIssueEntity) => ({
  before: { status: DOCUMENT_STATUS_LABEL[from.status] },
  after: { status: DOCUMENT_STATUS_LABEL[to.status] },
});

export const issueHandlers = [
  http.get(`${API}/goods-issues`, ({ request }) => {
    const user = authorize(request, 'goods-issue:read');
    const query = parseListQuery(new URL(request.url));
    const status = query.params.get('status');
    const warehouseId = query.params.get('warehouseId');
    const reason = query.params.get('reason');
    const from = query.params.get('from');
    const to = query.params.get('to');
    const linesByIssue = new Map<string, ReturnType<typeof issueLines>>();
    for (const line of db.goodsIssueLine.getAll()) {
      const list = linesByIssue.get(line.goodsIssueId) ?? [];
      list.push(line);
      linesByIssue.set(line.goodsIssueId, list);
    }
    const items = db.goodsIssue
      .getAll()
      .filter((issue) => canAccessWarehouse(user, issue.warehouseId))
      .filter((issue) => matchesFilter(issue.status, status))
      .filter((issue) => matchesFilter(issue.warehouseId, warehouseId))
      .filter((issue) => matchesFilter(issue.reason, reason))
      .filter((issue) => inDateRange(issue.issueDate, from, to))
      .map((issue) => toGoodsIssueSummary(issue, linesByIssue.get(issue.id) ?? []));
    return HttpResponse.json(
      toPage(items, query, {
        sortable: [
          'code',
          'issueDate',
          'status',
          'reason',
          'customerName',
          'warehouseName',
          'totalQuantity',
          'totalAmount',
          'createdAt',
        ],
        defaultSort: 'createdAt,desc',
        searchIn: (issue) => [
          issue.code,
          issue.customerName,
          issue.referenceNo,
          issue.warehouseName,
          issue.createdBy.fullName,
        ],
      }),
    );
  }),

  http.post(`${API}/goods-issues/allocation-preview`, async ({ request }) => {
    const user = authorize(request, 'goods-issue:read');
    const body = await readJson<AllocationPreviewRequest>(request);
    const validator = new Validator()
      .require('warehouseId', body.warehouseId, 'Vui lòng chọn kho xuất.')
      .require('reason', body.reason, 'Vui lòng chọn lý do xuất.');
    const warehouse = findById('warehouse', body.warehouseId);
    if (body.warehouseId && !warehouse) validator.add('warehouseId', 'Kho không tồn tại.');
    const lines = validateLines(validator, body.lines, warehouse?.id, { requirePrice: false });
    validator.throwIfInvalid();
    assertWarehouseAccess(user, warehouse!.id);
    const asOf = toLocalDate(new Date());
    const allocationLines: IssueAllocationLine[] = lines.map((line) => ({
      product: findById('product', line.productId)!,
      quantity: line.quantity,
      lotNumber: line.lotNumber,
      serialNumbers: line.serialNumbers,
    }));
    const results = allocateIssueLines(warehouse!.id, body.reason!, allocationLines, asOf);
    const preview: AllocationPreview = {
      warehouseId: warehouse!.id,
      asOf,
      lines: results.map((result, index) => {
        const { product, quantity } = allocationLines[index];
        let message: string | undefined;
        if (result.invalidSerials.length > 0) {
          message = `Serial không có trong kho: ${result.invalidSerials.join(', ')}.`;
        } else if (result.shortage > 0) {
          message = shortageMessage(product.sku, result, quantity);
        } else if (result.expiredExcluded > 0 && !includesExpired(body.reason!)) {
          message = `Đã bỏ qua ${result.expiredExcluded} thuộc lô hết hạn (chỉ xuất được khi xuất hủy).`;
        }
        return {
          index,
          productId: product.id,
          requested: quantity,
          available: result.available,
          expiredExcluded: result.expiredExcluded,
          shortage: result.shortage,
          picks: result.picks.map(toStockPick),
          ...(message ? { message } : {}),
        };
      }),
    };
    return HttpResponse.json(preview);
  }),

  http.post(`${API}/goods-issues`, async ({ request }) => {
    const user = authorize(request, 'goods-issue:write');
    const input = validateIssue(await readJson<GoodsIssueRequest>(request), user);
    const now = nowIso();
    const issue = db.goodsIssue.create({
      code: nextDocumentCode('PX', toLocalDate(new Date())),
      warehouseId: input.warehouse.id,
      customerId: input.customerId,
      customerName: input.customerName,
      reason: input.reason,
      referenceNo: input.referenceNo,
      issueDate: input.issueDate,
      note: input.note,
      status: 'DRAFT',
      createdById: user.id,
      createdAt: now,
      updatedAt: now,
      submittedAt: null,
      approvedById: null,
      approvedAt: null,
      rejectedById: null,
      rejectedAt: null,
      rejectedReason: null,
      cancelledById: null,
      cancelledAt: null,
      cancelReason: null,
    });
    replaceLines(issue.id, input.lines);
    audit(user, issue, 'CREATE', `Tạo phiếu xuất ${issue.code} — ${input.warehouse.name}`, {
      after: snapshot(issue),
    });
    return HttpResponse.json(toGoodsIssue(issue), { status: 201 });
  }),

  http.get(`${API}/goods-issues/:id`, ({ request, params }) => {
    const user = authorize(request, 'goods-issue:read');
    return HttpResponse.json(toGoodsIssue(requireIssue(String(params['id']), user)));
  }),

  http.put(`${API}/goods-issues/:id`, async ({ request, params }) => {
    const user = authorize(request, 'goods-issue:write');
    const issue = requireIssue(String(params['id']), user);
    requireDocumentStatus(issue, 'DRAFT', 'REJECTED');
    const before = snapshot(issue);
    const input = validateIssue(await readJson<GoodsIssueRequest>(request), user);
    const updated = db.goodsIssue.update({
      where: { id: { equals: issue.id } },
      data: {
        warehouseId: input.warehouse.id,
        customerId: input.customerId,
        customerName: input.customerName,
        reason: input.reason,
        referenceNo: input.referenceNo,
        issueDate: input.issueDate,
        note: input.note,
        updatedAt: nowIso(),
      },
    })!;
    replaceLines(updated.id, input.lines);
    audit(user, updated, 'UPDATE', `Sửa phiếu xuất ${updated.code}`, {
      before,
      after: snapshot(updated),
    });
    return HttpResponse.json(toGoodsIssue(updated));
  }),

  http.delete(`${API}/goods-issues/:id`, ({ request, params }) => {
    const user = authorize(request, 'goods-issue:write');
    const issue = requireIssue(String(params['id']), user);
    requireDocumentStatus(issue, 'DRAFT');
    const before = snapshot(issue);
    for (const line of issueLines(issue.id)) {
      db.goodsIssueLine.delete({ where: { id: { equals: line.id } } });
    }
    db.goodsIssue.delete({ where: { id: { equals: issue.id } } });
    audit(user, issue, 'DELETE', `Xóa phiếu xuất nháp ${issue.code}`, { before });
    return noContent();
  }),

  http.post(`${API}/goods-issues/:id/submit`, ({ request, params }) => {
    const user = authorize(request, 'goods-issue:write');
    const issue = requireIssue(String(params['id']), user);
    requireDocumentStatus(issue, 'DRAFT', 'REJECTED');
    // Báo thiếu tồn ngay khi gửi duyệt thay vì để người duyệt phát hiện.
    assertAllocatable(issue);
    const now = nowIso();
    const submitted = db.goodsIssue.update({
      where: { id: { equals: issue.id } },
      data: { status: 'PENDING', submittedAt: now, updatedAt: now },
    })!;
    audit(
      user,
      submitted,
      'SUBMIT',
      `Gửi duyệt phiếu xuất ${submitted.code}`,
      statusChange(issue, submitted),
    );
    return HttpResponse.json(toGoodsIssue(submitted));
  }),

  http.post(`${API}/goods-issues/:id/approve`, ({ request, params }) => {
    const user = authorize(request, 'goods-issue:approve');
    const issue = requireIssue(String(params['id']), user);
    requireDocumentStatus(issue, 'PENDING');
    let approved: GoodsIssueEntity;
    try {
      approved = approveIssue(issue, { actor: user, occurredAt: nowIso() });
    } catch (error) {
      rethrowStockError(error, 'Không đủ tồn có thể xuất (FEFO, đã loại lô hết hạn).');
    }
    const lines = issueLines(approved.id);
    audit(
      user,
      approved,
      'APPROVE',
      `Duyệt phiếu xuất ${approved.code}, trừ tồn ${lines.length} dòng theo FEFO`,
      statusChange(issue, approved),
    );
    return HttpResponse.json(toGoodsIssue(approved));
  }),

  http.post(`${API}/goods-issues/:id/reject`, async ({ request, params }) => {
    const user = authorize(request, 'goods-issue:approve');
    const issue = requireIssue(String(params['id']), user);
    requireDocumentStatus(issue, 'PENDING');
    const body = await readJson<ReasonRequest>(request);
    new Validator().require('reason', body.reason, 'Vui lòng nhập lý do từ chối.').throwIfInvalid();
    const now = nowIso();
    const rejected = db.goodsIssue.update({
      where: { id: { equals: issue.id } },
      data: {
        status: 'REJECTED',
        rejectedById: user.id,
        rejectedAt: now,
        rejectedReason: body.reason!.trim(),
        updatedAt: now,
      },
    })!;
    audit(
      user,
      rejected,
      'REJECT',
      `Từ chối phiếu xuất ${rejected.code}: ${body.reason!.trim()}`,
      statusChange(issue, rejected),
    );
    return HttpResponse.json(toGoodsIssue(rejected));
  }),

  http.post(`${API}/goods-issues/:id/cancel`, async ({ request, params }) => {
    const user = authorize(request, 'goods-issue:approve');
    const issue = requireIssue(String(params['id']), user);
    requireDocumentStatus(issue, 'APPROVED');
    const body = await readJson<ReasonRequest>(request);
    new Validator().require('reason', body.reason, 'Vui lòng nhập lý do hủy.').throwIfInvalid();
    let cancelled: GoodsIssueEntity;
    try {
      cancelled = cancelIssue(issue, body.reason!.trim(), { actor: user, occurredAt: nowIso() });
    } catch (error) {
      rethrowStockError(error, 'Không hủy được phiếu xuất.');
    }
    audit(
      user,
      cancelled,
      'CANCEL',
      `Hủy phiếu xuất ${cancelled.code}, hoàn hàng về đúng ô/lô: ${body.reason!.trim()}`,
      statusChange(issue, cancelled),
    );
    return HttpResponse.json(toGoodsIssue(cancelled));
  }),
];
