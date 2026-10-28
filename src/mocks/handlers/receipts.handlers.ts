import { http, HttpResponse } from 'msw';

import type { GoodsReceiptRequest, ReasonRequest } from '../../app/core/api/schema';
import { MOCK_CONFIG } from '../config';
import { db, findById, type GoodsReceiptEntity, type UserEntity } from '../db';
import { recordAudit } from '../domain/audit';
import { nextDocumentCode } from '../domain/document-code';
import { approveReceipt, cancelReceipt, receiptLines } from '../domain/receipts';
import { toGoodsReceipt, toGoodsReceiptSummary } from '../mappers/document.mapper';
import { authorize } from '../utils/auth';
import { nowIso, toLocalDate } from '../utils/date';
import {
  DOCUMENT_STATUS_LABEL,
  formatDate,
  LOT_PATTERN,
  MAX_SERIALS_PER_LINE,
  requireDocumentStatus,
  rethrowStockError,
  SERIAL_PATTERN,
} from '../utils/documents';
import { cleanText, DATE_PATTERN, errors, noContent, readJson, Validator } from '../utils/http';
import { inDateRange, matchesFilter, parseListQuery, toPage } from '../utils/query';
import { assertWarehouseAccess, canAccessWarehouse } from '../utils/scope';

const API = MOCK_CONFIG.apiUrl;

function requireReceipt(id: string, user: UserEntity): GoodsReceiptEntity {
  const receipt = findById('goodsReceipt', id);
  if (!receipt) {
    throw errors.notFound('Không tìm thấy phiếu nhập.');
  }
  assertWarehouseAccess(user, receipt.warehouseId);
  return receipt;
}

/** Validate & chuẩn hóa nội dung phiếu nhập (tạo và sửa). */
function validateReceipt(body: Partial<GoodsReceiptRequest>, user: UserEntity) {
  const validator = new Validator()
    .require('warehouseId', body.warehouseId, 'Vui lòng chọn kho nhập.')
    .require('receiptDate', body.receiptDate, 'Vui lòng chọn ngày nhập.');
  const warehouse = findById('warehouse', body.warehouseId);
  if (body.warehouseId && (!warehouse || warehouse.status !== 'ACTIVE')) {
    validator.add('warehouseId', 'Kho không tồn tại hoặc đã ngừng hoạt động.');
  }
  const supplier = body.supplierId ? findById('supplier', body.supplierId) : null;
  if (body.supplierId && (!supplier || supplier.status !== 'ACTIVE')) {
    validator.add('supplierId', 'Nhà cung cấp không tồn tại hoặc đã ngừng giao dịch.');
  }
  const supplierName = cleanText(body.supplierName) ?? supplier?.name ?? null;
  if (!supplierName) {
    validator.add('supplierName', 'Vui lòng nhập nhà cung cấp / nguồn hàng.');
  } else if (supplierName.length > 200) {
    validator.add('supplierName', 'Tối đa 200 ký tự.');
  }
  const receiptDate = body.receiptDate ?? '';
  if (receiptDate && !DATE_PATTERN.test(receiptDate)) {
    validator.add('receiptDate', 'Ngày không hợp lệ.');
  } else if (receiptDate > toLocalDate(new Date())) {
    validator.add('receiptDate', 'Ngày nhập không được sau hôm nay.');
  }
  const referenceNo = cleanText(body.referenceNo);
  if (referenceNo && referenceNo.length > 50) validator.add('referenceNo', 'Tối đa 50 ký tự.');
  const note = cleanText(body.note);
  if (note && note.length > 1000) validator.add('note', 'Tối đa 1000 ký tự.');

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) {
    validator.add('lines', 'Phiếu cần ít nhất một dòng hàng.');
  }
  const serialsInDocument = new Map<string, number>();
  const normalized = lines.map((line, index) => {
    const path = `lines.${index}`;
    const product = findById('product', line?.productId);
    if (!product) {
      validator.add(`${path}.productId`, 'Vui lòng chọn sản phẩm.');
    } else if (product.status !== 'ACTIVE') {
      validator.add(`${path}.productId`, 'Sản phẩm đã ngừng kinh doanh.');
    }
    const quantity = line?.quantity;
    if (!(Number.isInteger(quantity) && quantity >= 1 && quantity <= 1_000_000)) {
      validator.add(`${path}.quantity`, 'Số lượng phải là số nguyên từ 1 đến 1.000.000.');
    }
    if (!(Number.isInteger(line?.unitCost) && line.unitCost >= 0)) {
      validator.add(`${path}.unitCost`, 'Đơn giá phải là số nguyên ≥ 0.');
    }

    const lotNumber = product?.trackLot ? cleanText(line?.lotNumber) : null;
    if (product?.trackLot) {
      if (!lotNumber) validator.add(`${path}.lotNumber`, 'Sản phẩm quản lý theo lô — nhập số lô.');
      else if (!LOT_PATTERN.test(lotNumber)) {
        validator.add(`${path}.lotNumber`, 'Số lô chỉ gồm chữ, số và . _ / - (tối đa 50 ký tự).');
      }
    }
    const expiryDate = product?.trackExpiry ? cleanText(line?.expiryDate) : null;
    if (product?.trackExpiry) {
      if (!expiryDate) {
        validator.add(`${path}.expiryDate`, 'Sản phẩm quản lý hạn sử dụng — nhập HSD.');
      } else if (!DATE_PATTERN.test(expiryDate)) {
        validator.add(`${path}.expiryDate`, 'Ngày không hợp lệ.');
      } else if (receiptDate && expiryDate <= receiptDate) {
        validator.add(
          `${path}.expiryDate`,
          'Hạn sử dụng phải sau ngày nhập (không nhận hàng hết hạn).',
        );
      }
    }
    if (product && lotNumber && expiryDate) {
      const existing = db.stockLot
        .getAll()
        .find((lot) => lot.productId === product.id && lot.lotNumber === lotNumber);
      if (existing?.expiryDate && existing.expiryDate !== expiryDate) {
        validator.add(
          `${path}.expiryDate`,
          `Lô ${lotNumber} đang có HSD ${formatDate(existing.expiryDate)} — HSD của một lô phải thống nhất.`,
        );
      }
    }

    const serialNumbers = product?.trackSerial
      ? (Array.isArray(line?.serialNumbers) ? line.serialNumbers : [])
          .map((serial) => String(serial ?? '').trim())
          .filter(Boolean)
      : [];
    if (product?.trackSerial && Number.isInteger(quantity)) {
      if (quantity > MAX_SERIALS_PER_LINE) {
        validator.add(`${path}.quantity`, `Tối đa ${MAX_SERIALS_PER_LINE} serial mỗi dòng.`);
      } else if (serialNumbers.length !== quantity) {
        validator.add(
          `${path}.serialNumbers`,
          `Sản phẩm quản lý serial — cần đúng ${quantity} số serial (đang có ${serialNumbers.length}).`,
        );
      }
      for (const serial of serialNumbers) {
        const key = `${product.id}__${serial}`;
        if (!SERIAL_PATTERN.test(serial)) {
          validator.add(`${path}.serialNumbers`, `Serial "${serial}" không hợp lệ.`);
        } else if (serialsInDocument.has(key)) {
          validator.add(`${path}.serialNumbers`, `Serial ${serial} bị lặp trong phiếu.`);
        } else {
          const unit = findById('serialUnit', key);
          if (unit && (unit.status === 'IN_STOCK' || unit.status === 'IN_TRANSIT')) {
            validator.add(`${path}.serialNumbers`, `Serial ${serial} đang có trong hệ thống.`);
          }
        }
        serialsInDocument.set(key, index);
      }
    }

    let locationId: string | null = null;
    if (line?.locationId) {
      const location = findById('location', line.locationId);
      if (
        !location ||
        location.type !== 'BIN' ||
        location.status !== 'ACTIVE' ||
        location.warehouseId !== warehouse?.id
      ) {
        validator.add(
          `${path}.locationId`,
          'Ô cất hàng không thuộc kho nhập hoặc đã ngừng sử dụng.',
        );
      } else {
        locationId = location.id;
      }
    }
    return {
      productId: String(line?.productId ?? ''),
      quantity,
      unitCost: line?.unitCost,
      lotNumber,
      expiryDate,
      serialNumbers,
      locationId,
    };
  });
  validator.throwIfInvalid();
  assertWarehouseAccess(user, warehouse!.id);
  return {
    warehouse: warehouse!,
    supplierId: supplier?.id ?? null,
    supplierName: supplierName!,
    referenceNo,
    receiptDate,
    note,
    lines: normalized,
  };
}

function replaceLines(receiptId: string, lines: ReturnType<typeof validateReceipt>['lines']): void {
  for (const line of receiptLines(receiptId)) {
    db.goodsReceiptLine.delete({ where: { id: { equals: line.id } } });
  }
  lines.forEach((line, index) =>
    db.goodsReceiptLine.create({
      goodsReceiptId: receiptId,
      lineNo: index + 1,
      productId: line.productId,
      quantity: line.quantity,
      unitCost: line.unitCost!,
      lotNumber: line.lotNumber,
      expiryDate: line.expiryDate,
      serialNumbers: line.serialNumbers,
      locationId: line.locationId,
    }),
  );
}

function snapshot(receipt: GoodsReceiptEntity) {
  return {
    warehouse: findById('warehouse', receipt.warehouseId)?.name,
    supplierName: receipt.supplierName,
    referenceNo: receipt.referenceNo,
    receiptDate: receipt.receiptDate,
    note: receipt.note,
    lines: receiptLines(receipt.id).map((line) =>
      [
        `${findById('product', line.productId)?.sku} × ${line.quantity}`,
        line.lotNumber && `lô ${line.lotNumber}`,
        line.expiryDate && `HSD ${formatDate(line.expiryDate)}`,
      ]
        .filter(Boolean)
        .join(' · '),
    ),
  };
}

function audit(
  user: UserEntity,
  receipt: GoodsReceiptEntity,
  action: Parameters<typeof recordAudit>[0]['action'],
  summary: string,
  extra: { before?: object; after?: object } = {},
) {
  recordAudit({
    actor: user,
    action,
    entityType: 'GOODS_RECEIPT',
    entityId: receipt.id,
    entityLabel: receipt.code,
    summary,
    ...extra,
  });
}

const statusChange = (from: GoodsReceiptEntity, to: GoodsReceiptEntity) => ({
  before: { status: DOCUMENT_STATUS_LABEL[from.status] },
  after: { status: DOCUMENT_STATUS_LABEL[to.status] },
});

export const receiptHandlers = [
  http.get(`${API}/goods-receipts`, ({ request }) => {
    const user = authorize(request, 'goods-receipt:read');
    const query = parseListQuery(new URL(request.url));
    const status = query.params.get('status');
    const warehouseId = query.params.get('warehouseId');
    const from = query.params.get('from');
    const to = query.params.get('to');
    const linesByReceipt = new Map<string, ReturnType<typeof receiptLines>>();
    for (const line of db.goodsReceiptLine.getAll()) {
      const list = linesByReceipt.get(line.goodsReceiptId) ?? [];
      list.push(line);
      linesByReceipt.set(line.goodsReceiptId, list);
    }
    const items = db.goodsReceipt
      .getAll()
      .filter((receipt) => canAccessWarehouse(user, receipt.warehouseId))
      .filter((receipt) => matchesFilter(receipt.status, status))
      .filter((receipt) => matchesFilter(receipt.warehouseId, warehouseId))
      .filter((receipt) => inDateRange(receipt.receiptDate, from, to))
      .map((receipt) => toGoodsReceiptSummary(receipt, linesByReceipt.get(receipt.id) ?? []));
    return HttpResponse.json(
      toPage(items, query, {
        sortable: [
          'code',
          'receiptDate',
          'status',
          'supplierName',
          'warehouseName',
          'totalQuantity',
          'totalAmount',
          'createdAt',
        ],
        defaultSort: 'createdAt,desc',
        searchIn: (receipt) => [
          receipt.code,
          receipt.supplierName,
          receipt.referenceNo,
          receipt.warehouseName,
          receipt.createdBy.fullName,
        ],
      }),
    );
  }),

  http.post(`${API}/goods-receipts`, async ({ request }) => {
    const user = authorize(request, 'goods-receipt:write');
    const input = validateReceipt(await readJson<GoodsReceiptRequest>(request), user);
    const now = nowIso();
    const receipt = db.goodsReceipt.create({
      code: nextDocumentCode('PN', toLocalDate(new Date())),
      warehouseId: input.warehouse.id,
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      referenceNo: input.referenceNo,
      receiptDate: input.receiptDate,
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
    replaceLines(receipt.id, input.lines);
    audit(user, receipt, 'CREATE', `Tạo phiếu nhập ${receipt.code} — ${input.warehouse.name}`, {
      after: snapshot(receipt),
    });
    return HttpResponse.json(toGoodsReceipt(receipt), { status: 201 });
  }),

  http.get(`${API}/goods-receipts/:id`, ({ request, params }) => {
    const user = authorize(request, 'goods-receipt:read');
    return HttpResponse.json(toGoodsReceipt(requireReceipt(String(params['id']), user)));
  }),

  http.put(`${API}/goods-receipts/:id`, async ({ request, params }) => {
    const user = authorize(request, 'goods-receipt:write');
    const receipt = requireReceipt(String(params['id']), user);
    requireDocumentStatus(receipt, 'DRAFT', 'REJECTED');
    const before = snapshot(receipt);
    const input = validateReceipt(await readJson<GoodsReceiptRequest>(request), user);
    const updated = db.goodsReceipt.update({
      where: { id: { equals: receipt.id } },
      data: {
        warehouseId: input.warehouse.id,
        supplierId: input.supplierId,
        supplierName: input.supplierName,
        referenceNo: input.referenceNo,
        receiptDate: input.receiptDate,
        note: input.note,
        updatedAt: nowIso(),
      },
    })!;
    replaceLines(updated.id, input.lines);
    audit(user, updated, 'UPDATE', `Sửa phiếu nhập ${updated.code}`, {
      before,
      after: snapshot(updated),
    });
    return HttpResponse.json(toGoodsReceipt(updated));
  }),

  http.delete(`${API}/goods-receipts/:id`, ({ request, params }) => {
    const user = authorize(request, 'goods-receipt:write');
    const receipt = requireReceipt(String(params['id']), user);
    requireDocumentStatus(receipt, 'DRAFT');
    const before = snapshot(receipt);
    for (const line of receiptLines(receipt.id)) {
      db.goodsReceiptLine.delete({ where: { id: { equals: line.id } } });
    }
    db.goodsReceipt.delete({ where: { id: { equals: receipt.id } } });
    audit(user, receipt, 'DELETE', `Xóa phiếu nhập nháp ${receipt.code}`, { before });
    return noContent();
  }),

  http.post(`${API}/goods-receipts/:id/submit`, ({ request, params }) => {
    const user = authorize(request, 'goods-receipt:write');
    const receipt = requireReceipt(String(params['id']), user);
    requireDocumentStatus(receipt, 'DRAFT', 'REJECTED');
    const now = nowIso();
    const submitted = db.goodsReceipt.update({
      where: { id: { equals: receipt.id } },
      data: { status: 'PENDING', submittedAt: now, updatedAt: now },
    })!;
    audit(
      user,
      submitted,
      'SUBMIT',
      `Gửi duyệt phiếu nhập ${submitted.code}`,
      statusChange(receipt, submitted),
    );
    return HttpResponse.json(toGoodsReceipt(submitted));
  }),

  http.post(`${API}/goods-receipts/:id/approve`, ({ request, params }) => {
    const user = authorize(request, 'goods-receipt:approve');
    const receipt = requireReceipt(String(params['id']), user);
    requireDocumentStatus(receipt, 'PENDING');
    let approved: GoodsReceiptEntity;
    try {
      approved = approveReceipt(receipt, { actor: user, occurredAt: nowIso() });
    } catch (error) {
      rethrowStockError(error, 'Không ghi sổ được phiếu nhập.');
    }
    const lines = receiptLines(approved.id);
    audit(
      user,
      approved,
      'APPROVE',
      `Duyệt phiếu nhập ${approved.code}, cộng tồn ${lines.length} dòng (${lines.reduce((sum, line) => sum + line.quantity, 0)} đơn vị)`,
      statusChange(receipt, approved),
    );
    return HttpResponse.json(toGoodsReceipt(approved));
  }),

  http.post(`${API}/goods-receipts/:id/reject`, async ({ request, params }) => {
    const user = authorize(request, 'goods-receipt:approve');
    const receipt = requireReceipt(String(params['id']), user);
    requireDocumentStatus(receipt, 'PENDING');
    const body = await readJson<ReasonRequest>(request);
    new Validator().require('reason', body.reason, 'Vui lòng nhập lý do từ chối.').throwIfInvalid();
    const now = nowIso();
    const rejected = db.goodsReceipt.update({
      where: { id: { equals: receipt.id } },
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
      `Từ chối phiếu nhập ${rejected.code}: ${body.reason!.trim()}`,
      statusChange(receipt, rejected),
    );
    return HttpResponse.json(toGoodsReceipt(rejected));
  }),

  http.post(`${API}/goods-receipts/:id/cancel`, async ({ request, params }) => {
    const user = authorize(request, 'goods-receipt:approve');
    const receipt = requireReceipt(String(params['id']), user);
    requireDocumentStatus(receipt, 'APPROVED');
    const body = await readJson<ReasonRequest>(request);
    new Validator().require('reason', body.reason, 'Vui lòng nhập lý do hủy.').throwIfInvalid();
    let cancelled: GoodsReceiptEntity;
    try {
      cancelled = cancelReceipt(receipt, body.reason!.trim(), {
        actor: user,
        occurredAt: nowIso(),
      });
    } catch (error) {
      rethrowStockError(
        error,
        'Không hủy được: một phần hàng của phiếu đã được xuất / chuyển đi. Hãy lập phiếu xuất trả nhà cung cấp.',
      );
    }
    audit(
      user,
      cancelled,
      'CANCEL',
      `Hủy phiếu nhập ${cancelled.code} bằng bút toán đảo: ${body.reason!.trim()}`,
      statusChange(receipt, cancelled),
    );
    return HttpResponse.json(toGoodsReceipt(cancelled));
  }),
];
