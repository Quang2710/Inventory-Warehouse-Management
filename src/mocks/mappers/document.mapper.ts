import type {
  AuditChange,
  AuditLog,
  Customer,
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
  type StocktakeEntity,
  type StocktakeLineEntity,
  type SupplierEntity,
  type TransferEntity,
  type TransferLineEntity,
} from '../db';
import { binQuantity } from '../domain/inventory';
import { locationPath } from '../domain/locations';
import { lineVariance, stocktakeLines, stocktakeStats } from '../domain/stocktakes';
import { parsePicks, transferLines } from '../domain/transfers';
import { opt, requiredUserRef, userRef, warehouseName } from './common';

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
      locationCode: findById('location', pick.locationId)?.code ?? '—',
      quantity: pick.quantity,
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
