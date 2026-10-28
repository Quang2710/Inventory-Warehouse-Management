import { db, findById, type TransferEntity, type TransferLineEntity, type UserEntity } from '../db';
import { toLocalDate } from '../utils/date';
import {
  AllocationLedger,
  allocateStock,
  parseAllocations,
  type StockAllocation,
} from './allocation';
import {
  currentAverageCost,
  InsufficientStockError,
  postMovements,
  putawayLocationId,
  writeOffSerials,
  type MovementInput,
  type StockShortage,
} from './inventory';

/**
 * Nghiệp vụ chuyển kho:
 * DRAFT → ship (trừ tồn kho đi theo FEFO: ô/lô/serial, TRANSFER_OUT) → IN_TRANSIT
 *       → receive (cộng tồn kho đến, giữ nguyên lô/serial, TRANSFER_IN; nhận thiếu = hao hụt,
 *         serial không nhận được bị loại) → RECEIVED
 * IN_TRANSIT → cancel (hoàn hàng về đúng các ô/lô đã lấy, TRANSFER_CANCEL) → CANCELLED
 * Không chuyển lô đã hết hạn.
 */

export function transferLines(transferId: string): TransferLineEntity[] {
  return db.transferLine
    .getAll()
    .filter((line) => line.transferId === transferId)
    .sort((a, b) => a.lineNo - b.lineNo);
}

export function parsePicks(line: Pick<TransferLineEntity, 'picks'>): StockAllocation[] {
  return parseAllocations(line.picks);
}

interface ActionContext {
  actor: Pick<UserEntity, 'id'>;
  occurredAt: string;
  /** Sinh id movement tất định (seed). */
  nextId?: () => string;
}

function requireEntities(transfer: TransferEntity) {
  const from = findById('warehouse', transfer.fromWarehouseId);
  const to = findById('warehouse', transfer.toWarehouseId);
  if (!from || !to) {
    throw new Error(`Phiếu ${transfer.code} tham chiếu kho không tồn tại`);
  }
  return { from, to };
}

export function shipTransfer(transfer: TransferEntity, context: ActionContext): TransferEntity {
  const { from } = requireEntities(transfer);
  const lines = transferLines(transfer.id);
  const shortages: StockShortage[] = [];
  const ledger = new AllocationLedger();
  const asOf = toLocalDate(new Date(context.occurredAt));
  const plans = lines.map((line, index) => {
    const product = findById('product', line.productId)!;
    const result = allocateStock(
      {
        product,
        warehouseId: from.id,
        quantity: line.quantity,
        asOf,
        preferredLocationId: line.fromLocationId,
      },
      ledger,
    );
    if (result.shortage > 0) {
      shortages.push({
        index,
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        locationId: line.fromLocationId,
        available: result.available,
        requested: line.quantity,
      });
    }
    ledger.reserve(product, from.id, result.picks);
    return {
      line,
      product,
      allocations: result.picks,
      unitCost: currentAverageCost(product.id, from.id),
    };
  });
  if (shortages.length > 0) {
    throw new InsufficientStockError(shortages);
  }

  const inputs: MovementInput[] = plans.flatMap(({ product, allocations, unitCost }) =>
    allocations.map((allocation) => ({
      ...(context.nextId ? { id: context.nextId() } : {}),
      product,
      warehouse: from,
      locationId: allocation.locationId,
      quantity: -allocation.quantity,
      lotNumber: allocation.lotNumber,
      expiryDate: allocation.expiryDate,
      serialNumbers: allocation.serialNumbers,
      unitCost,
      type: 'TRANSFER_OUT' as const,
      documentType: 'TRANSFER' as const,
      documentId: transfer.id,
      documentCode: transfer.code,
      occurredAt: context.occurredAt,
      createdById: context.actor.id,
    })),
  );
  postMovements(inputs);

  for (const { line, allocations, unitCost } of plans) {
    db.transferLine.update({
      where: { id: { equals: line.id } },
      data: { picks: JSON.stringify(allocations), unitCost },
    });
  }
  return db.transfer.update({
    where: { id: { equals: transfer.id } },
    data: {
      status: 'IN_TRANSIT',
      shippedById: context.actor.id,
      shippedAt: context.occurredAt,
      updatedAt: context.occurredAt,
    },
  })!;
}

export interface ReceiveLineInput {
  lineId: string;
  receivedQuantity: number;
  toLocationId?: string | null;
}

export function receiveTransfer(
  transfer: TransferEntity,
  receipts: readonly ReceiveLineInput[],
  note: string | null,
  context: ActionContext,
): TransferEntity {
  const { to } = requireEntities(transfer);
  const byLine = new Map(receipts.map((receipt) => [receipt.lineId, receipt]));
  const inputs: MovementInput[] = [];
  const updates: { line: TransferLineEntity; received: number; locationId: string | null }[] = [];
  const lost: { productId: string; serials: string[] }[] = [];

  for (const line of transferLines(transfer.id)) {
    const product = findById('product', line.productId)!;
    const receipt = byLine.get(line.id);
    const received = Math.min(
      line.quantity,
      Math.max(0, receipt?.receivedQuantity ?? line.quantity),
    );
    const locationId = receipt?.toLocationId || putawayLocationId(product.id, to.id);
    updates.push({ line, received, locationId });
    // Nhận theo thứ tự các phần đã lấy (giữ lô/serial); phần cuối thiếu coi như hao hụt.
    let remaining = received;
    for (const pick of parsePicks(line)) {
      const take = Math.min(pick.quantity, remaining);
      remaining -= take;
      const serials = pick.serialNumbers ?? [];
      if (serials.length > take) {
        lost.push({ productId: product.id, serials: serials.slice(take) });
      }
      if (take <= 0) continue;
      inputs.push({
        ...(context.nextId ? { id: context.nextId() } : {}),
        product,
        warehouse: to,
        locationId,
        quantity: take,
        lotNumber: pick.lotNumber,
        expiryDate: pick.expiryDate,
        ...(product.trackSerial ? { serialNumbers: serials.slice(0, take) } : {}),
        unitCost: line.unitCost ?? product.costPrice,
        type: 'TRANSFER_IN',
        documentType: 'TRANSFER',
        documentId: transfer.id,
        documentCode: transfer.code,
        occurredAt: context.occurredAt,
        createdById: context.actor.id,
        note: received < line.quantity ? `Nhận thiếu ${line.quantity - received}` : null,
      });
    }
  }
  postMovements(inputs);
  for (const entry of lost) {
    writeOffSerials(entry.productId, entry.serials, {
      documentType: 'TRANSFER',
      documentId: transfer.id,
      documentCode: transfer.code,
      occurredAt: context.occurredAt,
    });
  }

  for (const { line, received, locationId } of updates) {
    db.transferLine.update({
      where: { id: { equals: line.id } },
      data: { receivedQuantity: received, toLocationId: locationId },
    });
  }
  return db.transfer.update({
    where: { id: { equals: transfer.id } },
    data: {
      status: 'RECEIVED',
      receivedById: context.actor.id,
      receivedAt: context.occurredAt,
      receiveNote: note,
      updatedAt: context.occurredAt,
    },
  })!;
}

export function cancelTransfer(
  transfer: TransferEntity,
  reason: string,
  context: ActionContext,
): TransferEntity {
  if (transfer.status === 'IN_TRANSIT') {
    const { from } = requireEntities(transfer);
    const inputs: MovementInput[] = transferLines(transfer.id).flatMap((line) => {
      const product = findById('product', line.productId)!;
      return parsePicks(line).map((pick) => ({
        ...(context.nextId ? { id: context.nextId() } : {}),
        product,
        warehouse: from,
        locationId: pick.locationId,
        quantity: pick.quantity,
        lotNumber: pick.lotNumber,
        expiryDate: pick.expiryDate,
        serialNumbers: pick.serialNumbers,
        unitCost: line.unitCost ?? product.costPrice,
        type: 'TRANSFER_CANCEL' as const,
        documentType: 'TRANSFER' as const,
        documentId: transfer.id,
        documentCode: transfer.code,
        occurredAt: context.occurredAt,
        createdById: context.actor.id,
        note: reason,
      }));
    });
    postMovements(inputs);
  }
  return db.transfer.update({
    where: { id: { equals: transfer.id } },
    data: {
      status: 'CANCELLED',
      cancelledById: context.actor.id,
      cancelledAt: context.occurredAt,
      cancelReason: reason,
      updatedAt: context.occurredAt,
    },
  })!;
}
