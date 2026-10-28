import type {
  AuditChange,
  AuditLog,
  Customer,
  DocumentAudit,
  GoodsIssue,
  GoodsIssueLine,
  GoodsIssueSummary,
  GoodsReceipt,
  GoodsReceiptLine,
  GoodsReceiptSummary,
  StockMovement,
  Stocktake,
  StocktakeLine,
  StocktakeSummary,
  Supplier,
  Transfer,
  TransferLine,
  TransferSummary,
} from '../../app/core/api/schema';
import {
  findById,
  type AuditLogEntity,
  type CustomerEntity,
  type GoodsIssueEntity,
  type GoodsIssueLineEntity,
  type GoodsReceiptEntity,
  type GoodsReceiptLineEntity,
  type StockMovementEntity,
  type StocktakeEntity,
  type StocktakeLineEntity,
  type SupplierEntity,
  type TransferEntity,
  type TransferLineEntity,
} from '../db';
import { toStockPick } from '../domain/allocation';
import { binQuantity } from '../domain/inventory';
import { issueLines, parseIssuePicks } from '../domain/issues';
import { locationPath } from '../domain/locations';
import { lineVariance, stocktakeLines, stocktakeStats } from '../domain/stocktakes';
import { receiptLines } from '../domain/receipts';
import { parsePicks, transferLines } from '../domain/transfers';
import { opt, requiredUserRef, userRef, warehouseName } from './common';

// ── Phiếu nhập / xuất ──

type ApprovalFields = Pick<
  GoodsReceiptEntity,
  | 'createdById'
  | 'createdAt'
  | 'updatedAt'
  | 'submittedAt'
  | 'approvedById'
  | 'approvedAt'
  | 'rejectedById'
  | 'rejectedAt'
  | 'rejectedReason'
  | 'cancelledById'
  | 'cancelledAt'
  | 'cancelReason'
>;

function documentAudit(document: ApprovalFields): DocumentAudit {
  return {
    createdBy: requiredUserRef(document.createdById),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    submittedAt: opt(document.submittedAt),
    approvedBy: userRef(document.approvedById),
    approvedAt: opt(document.approvedAt),
    rejectedBy: userRef(document.rejectedById),
    rejectedAt: opt(document.rejectedAt),
    rejectedReason: opt(document.rejectedReason),
    cancelledBy: userRef(document.cancelledById),
    cancelledAt: opt(document.cancelledAt),
    cancelReason: opt(document.cancelReason),
  };
}

function productFields(productId: string) {
  const product = findById('product', productId);
  return {
    productId,
    sku: product?.sku ?? '—',
    productName: product?.name ?? '—',
    unit: product?.unit ?? '',
    trackLot: product?.trackLot ?? false,
    trackExpiry: product?.trackExpiry ?? false,
    trackSerial: product?.trackSerial ?? false,
  };
}

export function toGoodsReceiptLine(line: GoodsReceiptLineEntity): GoodsReceiptLine {
  return {
    id: line.id,
    ...productFields(line.productId),
    quantity: line.quantity,
    unitCost: line.unitCost,
    amount: line.quantity * line.unitCost,
    lotNumber: opt(line.lotNumber),
    expiryDate: opt(line.expiryDate),
    serialNumbers: [...line.serialNumbers],
    locationId: line.locationId,
    locationCode: findById('location', line.locationId)?.code ?? null,
  };
}

export function toGoodsReceiptSummary(
  receipt: GoodsReceiptEntity,
  lines = receiptLines(receipt.id),
): GoodsReceiptSummary {
  return {
    id: receipt.id,
    code: receipt.code,
    warehouseId: receipt.warehouseId,
    warehouseName: warehouseName(receipt.warehouseId),
    supplierId: receipt.supplierId,
    supplierName: receipt.supplierName,
    referenceNo: opt(receipt.referenceNo),
    receiptDate: receipt.receiptDate,
    status: receipt.status,
    lineCount: lines.length,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    totalAmount: lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
    createdBy: requiredUserRef(receipt.createdById),
    createdAt: receipt.createdAt,
  };
}

export function toGoodsReceipt(receipt: GoodsReceiptEntity): GoodsReceipt {
  const lines = receiptLines(receipt.id);
  return {
    ...toGoodsReceiptSummary(receipt, lines),
    ...documentAudit(receipt),
    note: opt(receipt.note),
    lines: lines.map(toGoodsReceiptLine),
  };
}

export function toGoodsIssueLine(line: GoodsIssueLineEntity): GoodsIssueLine {
  return {
    id: line.id,
    ...productFields(line.productId),
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    amount: line.quantity * line.unitPrice,
    unitCost: opt(line.unitCost),
    lotNumber: line.lotNumber,
    serialNumbers: [...line.serialNumbers],
    picks: parseIssuePicks(line).map(toStockPick),
  };
}

export function toGoodsIssueSummary(
  issue: GoodsIssueEntity,
  lines = issueLines(issue.id),
): GoodsIssueSummary {
  return {
    id: issue.id,
    code: issue.code,
    warehouseId: issue.warehouseId,
    warehouseName: warehouseName(issue.warehouseId),
    customerId: issue.customerId,
    customerName: issue.customerName,
    reason: issue.reason,
    referenceNo: opt(issue.referenceNo),
    issueDate: issue.issueDate,
    status: issue.status,
    lineCount: lines.length,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    totalAmount: lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    createdBy: requiredUserRef(issue.createdById),
    createdAt: issue.createdAt,
  };
}

export function toGoodsIssue(issue: GoodsIssueEntity): GoodsIssue {
  const lines = issueLines(issue.id);
  return {
    ...toGoodsIssueSummary(issue, lines),
    ...documentAudit(issue),
    note: opt(issue.note),
    lines: lines.map(toGoodsIssueLine),
  };
}

// ── Biến động tồn ──

export function toStockMovement(movement: StockMovementEntity): StockMovement {
  const product = findById('product', movement.productId);
  return {
    id: movement.id,
    occurredAt: movement.occurredAt,
    type: movement.type,
    productId: movement.productId,
    sku: product?.sku ?? '—',
    productName: product?.name ?? '—',
    unit: product?.unit ?? '',
    warehouseId: movement.warehouseId,
    warehouseName: warehouseName(movement.warehouseId),
    locationId: movement.locationId,
    locationCode: findById('location', movement.locationId)?.code ?? null,
    quantity: movement.quantity,
    balanceAfter: movement.balanceAfter,
    unitCost: movement.unitCost,
    documentType: movement.documentType,
    documentId: movement.documentId,
    documentCode: movement.documentCode,
    createdBy: requiredUserRef(movement.createdById),
    note: opt(movement.note),
    lotNumber: movement.lotNumber,
    expiryDate: movement.expiryDate,
    serialNumbers: [...movement.serialNumbers],
  };
}

// ── Chuyển kho ──

export function toTransferLine(line: TransferLineEntity): TransferLine {
  const product = findById('product', line.productId);
  return {
    id: line.id,
    productId: line.productId,
    sku: product?.sku ?? '—',
    productName: product?.name ?? '—',
    unit: product?.unit ?? '',
    quantity: line.quantity,
    fromLocationId: line.fromLocationId,
    picks: parsePicks(line).map((pick) => ({
      locationId: pick.locationId,
      locationCode: findById('location', pick.locationId)?.code ?? null,
      quantity: pick.quantity,
      lotNumber: pick.lotNumber,
      expiryDate: pick.expiryDate,
      ...(pick.serialNumbers?.length ? { serialNumbers: [...pick.serialNumbers] } : {}),
    })),
    receivedQuantity: line.receivedQuantity,
    toLocationId: line.toLocationId,
    toLocationCode: findById('location', line.toLocationId)?.code ?? null,
  };
}

export function toTransferSummary(
  transfer: TransferEntity,
  lines = transferLines(transfer.id),
): TransferSummary {
  const received =
    transfer.status === 'RECEIVED'
      ? lines.reduce((sum, line) => sum + (line.receivedQuantity ?? 0), 0)
      : null;
  return {
    id: transfer.id,
    code: transfer.code,
    fromWarehouseId: transfer.fromWarehouseId,
    fromWarehouseName: warehouseName(transfer.fromWarehouseId),
    toWarehouseId: transfer.toWarehouseId,
    toWarehouseName: warehouseName(transfer.toWarehouseId),
    status: transfer.status,
    transferDate: transfer.transferDate,
    expectedDate: transfer.expectedDate,
    lineCount: lines.length,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    receivedQuantity: received,
    createdBy: requiredUserRef(transfer.createdById),
    createdAt: transfer.createdAt,
  };
}

export function toTransfer(transfer: TransferEntity): Transfer {
  const lines = transferLines(transfer.id);
  return {
    ...toTransferSummary(transfer, lines),
    note: opt(transfer.note),
    lines: lines.map(toTransferLine),
    updatedAt: transfer.updatedAt,
    shippedBy: userRef(transfer.shippedById),
    shippedAt: opt(transfer.shippedAt),
    receivedBy: userRef(transfer.receivedById),
    receivedAt: opt(transfer.receivedAt),
    receiveNote: opt(transfer.receiveNote),
    cancelledBy: userRef(transfer.cancelledById),
    cancelledAt: opt(transfer.cancelledAt),
    cancelReason: opt(transfer.cancelReason),
  };
}

// ── Kiểm kê ──

export function scopeLabel(stocktake: StocktakeEntity): string {
  if (stocktake.zoneIds.length === 0) {
    return 'Toàn kho';
  }
  return stocktake.zoneIds.map((id) => findById('location', id)?.name ?? '—').join(', ');
}

export function toStocktakeSummary(
  stocktake: StocktakeEntity,
  lines = stocktakeLines(stocktake.id),
): StocktakeSummary {
  return {
    id: stocktake.id,
    code: stocktake.code,
    warehouseId: stocktake.warehouseId,
    warehouseName: warehouseName(stocktake.warehouseId),
    name: stocktake.name,
    status: stocktake.status,
    blind: stocktake.blind,
    zoneIds: [...stocktake.zoneIds],
    scopeLabel: scopeLabel(stocktake),
    ...stocktakeStats(stocktake, lines),
    createdBy: requiredUserRef(stocktake.createdById),
    createdAt: stocktake.createdAt,
  };
}

export function toStocktake(stocktake: StocktakeEntity): Stocktake {
  return {
    ...toStocktakeSummary(stocktake),
    note: opt(stocktake.note),
    updatedAt: stocktake.updatedAt,
    submittedBy: userRef(stocktake.submittedById),
    submittedAt: opt(stocktake.submittedAt),
    approvedBy: userRef(stocktake.approvedById),
    approvedAt: opt(stocktake.approvedAt),
    cancelledBy: userRef(stocktake.cancelledById),
    cancelledAt: opt(stocktake.cancelledAt),
    cancelReason: opt(stocktake.cancelReason),
  };
}

export function toStocktakeLine(
  line: StocktakeLineEntity,
  options: { hideExpected: boolean; active: boolean },
): StocktakeLine {
  const product = findById('product', line.productId);
  const location = findById('location', line.locationId);
  const current = options.active ? binQuantity(line.productId, line.locationId) : null;
  const changedBeforeCount =
    line.systemQuantityAtCount !== null && line.systemQuantityAtCount !== line.expectedQuantity;
  const changedAfter =
    current !== null && current !== (line.systemQuantityAtCount ?? line.expectedQuantity);
  return {
    id: line.id,
    locationId: line.locationId,
    locationCode: location?.code ?? '—',
    locationPath: location ? locationPath(location) : '—',
    productId: line.productId,
    sku: product?.sku ?? '—',
    productName: product?.name ?? '—',
    barcode: opt(product?.barcode),
    unit: product?.unit ?? '',
    expectedQuantity: options.hideExpected ? null : line.expectedQuantity,
    countedQuantity: line.countedQuantity,
    variance: options.hideExpected ? null : lineVariance(line),
    countedBy: userRef(line.countedById),
    countedAt: opt(line.countedAt),
    note: opt(line.note),
    stockChanged: changedBeforeCount || changedAfter,
    unexpected: line.unexpected,
  };
}

// ── Đối tác ──

export function toSupplier(supplier: SupplierEntity, receiptCount: number): Supplier {
  return {
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    taxCode: opt(supplier.taxCode),
    contactName: opt(supplier.contactName),
    phone: opt(supplier.phone),
    email: opt(supplier.email),
    address: opt(supplier.address),
    paymentTermDays: supplier.paymentTermDays,
    status: supplier.status,
    note: opt(supplier.note),
    receiptCount,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

export function toCustomer(customer: CustomerEntity, issueCount: number): Customer {
  return {
    id: customer.id,
    code: customer.code,
    name: customer.name,
    type: customer.type,
    taxCode: opt(customer.taxCode),
    contactName: opt(customer.contactName),
    phone: opt(customer.phone),
    email: opt(customer.email),
    address: opt(customer.address),
    status: customer.status,
    note: opt(customer.note),
    issueCount,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

// ── Nhật ký ──

export function toAuditLog(entry: AuditLogEntity): AuditLog {
  let changes: AuditChange[] = [];
  try {
    const parsed: unknown = JSON.parse(entry.changes || '[]');
    changes = Array.isArray(parsed) ? (parsed as AuditChange[]) : [];
  } catch {
    changes = [];
  }
  return {
    id: entry.id,
    occurredAt: entry.occurredAt,
    userId: entry.userId,
    userName: entry.userName,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityLabel: entry.entityLabel,
    summary: entry.summary,
    changes,
    ipAddress: opt(entry.ipAddress),
    userAgent: opt(entry.userAgent),
  };
}
