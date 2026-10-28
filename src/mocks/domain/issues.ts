import type { IssueReason } from '../../app/core/api/schema';
import {
  db,
  findById,
  type GoodsIssueEntity,
  type GoodsIssueLineEntity,
  type ProductEntity,
} from '../db';
import { toLocalDate } from '../utils/date';
import {
  AllocationLedger,
  allocateStock,
  parseAllocations,
  type AllocationResult,
  type StockAllocation,
} from './allocation';
import {
  currentAverageCost,
  InsufficientStockError,
  movementsOf,
  postMovements,
  SerialError,
  type MovementInput,
  type SerialProblem,
  type StockShortage,
} from './inventory';
import type { DocumentActionContext } from './receipts';

/**
 * Nghiệp vụ phiếu xuất (dùng chung cho handler và seed):
 * PENDING → approve: phân bổ FEFO theo ô/lô/serial, kiểm tra đủ tồn, trừ tồn (ISSUE),
 *           chốt giá vốn bình quân → APPROVED
 * APPROVED → cancel: hoàn đúng ô/lô/serial đã lấy (ISSUE_CANCEL) → CANCELLED.
 * Lô đã hết hạn chỉ được xuất với lý do `DAMAGED` (xuất hủy).
 */

export function issueLines(issueId: string): GoodsIssueLineEntity[] {
  return db.goodsIssueLine
    .getAll()
    .filter((line) => line.goodsIssueId === issueId)
    .sort((a, b) => a.lineNo - b.lineNo);
}

export function parseIssuePicks(line: Pick<GoodsIssueLineEntity, 'picks'>): StockAllocation[] {
  return parseAllocations(line.picks);
}

export interface IssueAllocationLine {
  product: ProductEntity;
  quantity: number;
  lotNumber?: string | null;
  serialNumbers?: readonly string[];
}

/** Xuất hủy được phép lấy cả lô đã hết hạn (và FEFO sẽ lấy chúng trước). */
export function includesExpired(reason: IssueReason): boolean {
  return reason === 'DAMAGED';
}

/** Phân bổ tất cả dòng theo thứ tự, các dòng sau không lấy trùng phần của dòng trước. */
export function allocateIssueLines(
  warehouseId: string,
  reason: IssueReason,
  lines: readonly IssueAllocationLine[],
  asOf: string,
): AllocationResult[] {
  const ledger = new AllocationLedger();
  return lines.map((line) => {
    const result = allocateStock(
      {
        product: line.product,
        warehouseId,
        quantity: line.quantity,
        asOf,
        includeExpired: includesExpired(reason),
        lotNumber: line.lotNumber ?? null,
        serialNumbers: line.serialNumbers,
      },
      ledger,
    );
    ledger.reserve(line.product, warehouseId, result.picks);
    return result;
  });
}

export function approveIssue(
  issue: GoodsIssueEntity,
  context: DocumentActionContext,
): GoodsIssueEntity {
  const warehouse = findById('warehouse', issue.warehouseId);
  if (!warehouse) {
    throw new Error(`Phiếu ${issue.code} tham chiếu kho không tồn tại`);
  }
  const lines = issueLines(issue.id).map((line) => ({
    line,
    product: findById('product', line.productId)!,
  }));
  const results = allocateIssueLines(
    warehouse.id,
    issue.reason,
    lines.map(({ line, product }) => ({
      product,
      quantity: line.quantity,
      lotNumber: line.lotNumber,
      serialNumbers: line.serialNumbers,
    })),
    toLocalDate(new Date(context.occurredAt)),
  );

  const shortages: StockShortage[] = [];
  const serialProblems: SerialProblem[] = [];
  results.forEach((result, index) => {
    const { line, product } = lines[index];
    for (const serialNumber of result.invalidSerials) {
      serialProblems.push({
        index,
        sku: product.sku,
        serialNumber,
        message: `Serial ${serialNumber} không có trong kho (hoặc đã hết hạn / đã chọn ở dòng khác).`,
      });
    }
    if (result.shortage > 0) {
      shortages.push({
        index,
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        locationId: null,
        lotNumber: line.lotNumber,
        available: result.available,
        requested: line.quantity,
      });
    }
  });
  if (serialProblems.length > 0) {
    throw new SerialError(serialProblems);
  }
  if (shortages.length > 0) {
    throw new InsufficientStockError(shortages);
  }

  // Xuất kho không làm đổi giá vốn bình quân → chốt giá vốn trước khi ghi sổ.
  const costs = lines.map(({ product }) => currentAverageCost(product.id, warehouse.id));
  const inputs: MovementInput[] = lines.flatMap(({ product }, index) =>
    results[index].picks.map((pick) => ({
      ...(context.nextId ? { id: context.nextId() } : {}),
      product,
      warehouse,
      locationId: pick.locationId,
      quantity: -pick.quantity,
      lotNumber: pick.lotNumber,
      expiryDate: pick.expiryDate,
      serialNumbers: pick.serialNumbers,
      unitCost: costs[index],
      type: 'ISSUE' as const,
      documentType: 'GOODS_ISSUE' as const,
      documentId: issue.id,
      documentCode: issue.code,
      occurredAt: context.occurredAt,
      createdById: context.actor.id,
    })),
  );
  postMovements(inputs);

  lines.forEach(({ line }, index) =>
    db.goodsIssueLine.update({
      where: { id: { equals: line.id } },
      data: { unitCost: costs[index], picks: JSON.stringify(results[index].picks) },
    }),
  );
  return db.goodsIssue.update({
    where: { id: { equals: issue.id } },
    data: {
      status: 'APPROVED',
      approvedById: context.actor.id,
      approvedAt: context.occurredAt,
      updatedAt: context.occurredAt,
    },
  })!;
}

export function cancelIssue(
  issue: GoodsIssueEntity,
  reason: string,
  context: DocumentActionContext,
): GoodsIssueEntity {
  const warehouse = findById('warehouse', issue.warehouseId)!;
  postMovements(
    movementsOf(issue.id, 'ISSUE').map((movement) => ({
      ...(context.nextId ? { id: context.nextId() } : {}),
      product: findById('product', movement.productId)!,
      warehouse,
      locationId: movement.locationId,
      quantity: -movement.quantity,
      unitCost: movement.unitCost,
      lotNumber: movement.lotNumber,
      expiryDate: movement.expiryDate,
      serialNumbers: movement.serialNumbers,
      type: 'ISSUE_CANCEL' as const,
      documentType: 'GOODS_ISSUE' as const,
      documentId: issue.id,
      documentCode: issue.code,
      occurredAt: context.occurredAt,
      createdById: context.actor.id,
      note: reason,
    })),
  );
  return db.goodsIssue.update({
    where: { id: { equals: issue.id } },
    data: {
      status: 'CANCELLED',
      cancelledById: context.actor.id,
      cancelledAt: context.occurredAt,
      cancelReason: reason,
      updatedAt: context.occurredAt,
    },
  })!;
}
