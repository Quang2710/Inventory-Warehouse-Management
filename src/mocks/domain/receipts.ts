import {
  db,
  findById,
  type GoodsReceiptEntity,
  type GoodsReceiptLineEntity,
  type UserEntity,
} from '../db';
import { isLotManaged, movementsOf, postMovements, putawayLocationId } from './inventory';

/**
 * Nghiệp vụ phiếu nhập (dùng chung cho handler và seed):
 * PENDING → approve: cộng tồn theo ô cất hàng, ghi lô/HSD/serial (RECEIPT) → APPROVED
 * APPROVED → cancel: bút toán đảo đúng ô/lô/serial đã nhập (RECEIPT_CANCEL) → CANCELLED.
 * Hủy không được nếu hàng của phiếu đã bị xuất (tồn lô không đủ) → `InsufficientStockError`.
 */

export interface DocumentActionContext {
  actor: Pick<UserEntity, 'id'>;
  occurredAt: string;
  /** Sinh id movement tất định (seed). */
  nextId?: () => string;
}

export function receiptLines(receiptId: string): GoodsReceiptLineEntity[] {
  return db.goodsReceiptLine
    .getAll()
    .filter((line) => line.goodsReceiptId === receiptId)
    .sort((a, b) => a.lineNo - b.lineNo);
}

export function approveReceipt(
  receipt: GoodsReceiptEntity,
  context: DocumentActionContext,
): GoodsReceiptEntity {
  const warehouse = findById('warehouse', receipt.warehouseId);
  if (!warehouse) {
    throw new Error(`Phiếu ${receipt.code} tham chiếu kho không tồn tại`);
  }
  const plans = receiptLines(receipt.id).map((line) => {
    const product = findById('product', line.productId)!;
    return {
      line,
      product,
      locationId: line.locationId ?? putawayLocationId(product.id, warehouse.id),
    };
  });
  postMovements(
    plans.map(({ line, product, locationId }) => ({
      ...(context.nextId ? { id: context.nextId() } : {}),
      product,
      warehouse,
      locationId,
      quantity: line.quantity,
      unitCost: line.unitCost,
      ...(isLotManaged(product)
        ? {
            lotNumber: product.trackLot ? line.lotNumber : null,
            expiryDate: product.trackExpiry ? line.expiryDate : null,
          }
        : {}),
      ...(product.trackSerial ? { serialNumbers: line.serialNumbers } : {}),
      type: 'RECEIPT' as const,
      documentType: 'GOODS_RECEIPT' as const,
      documentId: receipt.id,
      documentCode: receipt.code,
      occurredAt: context.occurredAt,
      createdById: context.actor.id,
    })),
  );
  for (const { line, locationId } of plans) {
    if (line.locationId !== locationId) {
      db.goodsReceiptLine.update({ where: { id: { equals: line.id } }, data: { locationId } });
    }
  }
  return db.goodsReceipt.update({
    where: { id: { equals: receipt.id } },
    data: {
      status: 'APPROVED',
      approvedById: context.actor.id,
      approvedAt: context.occurredAt,
      updatedAt: context.occurredAt,
    },
  })!;
}

export function cancelReceipt(
  receipt: GoodsReceiptEntity,
  reason: string,
  context: DocumentActionContext,
): GoodsReceiptEntity {
  const warehouse = findById('warehouse', receipt.warehouseId)!;
  postMovements(
    movementsOf(receipt.id, 'RECEIPT').map((movement) => ({
      ...(context.nextId ? { id: context.nextId() } : {}),
      product: findById('product', movement.productId)!,
      warehouse,
      locationId: movement.locationId,
      quantity: -movement.quantity,
      unitCost: movement.unitCost,
      lotNumber: movement.lotNumber,
      expiryDate: movement.expiryDate,
      serialNumbers: movement.serialNumbers,
      type: 'RECEIPT_CANCEL' as const,
      documentType: 'GOODS_RECEIPT' as const,
      documentId: receipt.id,
      documentCode: receipt.code,
      occurredAt: context.occurredAt,
      createdById: context.actor.id,
      note: reason,
    })),
  );
  return db.goodsReceipt.update({
    where: { id: { equals: receipt.id } },
    data: {
      status: 'CANCELLED',
      cancelledById: context.actor.id,
      cancelledAt: context.occurredAt,
      cancelReason: reason,
      updatedAt: context.occurredAt,
    },
  })!;
}
