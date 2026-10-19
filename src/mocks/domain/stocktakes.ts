import {
  db,
  findById,
  type LocationEntity,
  type StocktakeEntity,
  type StocktakeLineEntity,
  type UserEntity,
  type WarehouseEntity,
} from '../db';
import { nextDocumentCode } from './document-code';
import { binQuantity, currentAverageCost, postMovements, type MovementInput } from './inventory';
import { descendantIds, locationsOf } from './locations';
import { toLocalDate } from '../utils/date';

/**
 * Nghiệp vụ kiểm kê:
 * - Mở phiên: chốt tồn hệ thống theo (ô × sản phẩm) trong phạm vi khu đã chọn.
 * - Đếm: ghi số đếm TUYỆT ĐỐI, kèm tồn hệ thống tại thời điểm đếm; xung đột giữa các thiết bị
 *   giải theo `countedAt` mới nhất (idempotent khi đồng bộ lại hàng đợi offline).
 * - Chênh lệch = số đếm − tồn hệ thống tại thời điểm đếm (không bị sai lệch bởi nhập/xuất
 *   phát sinh trước hoặc sau lúc đếm ô đó).
 * - Duyệt: sinh bút toán ADJUSTMENT (chứng từ STOCKTAKE) cho các dòng có chênh lệch.
 */

export function stocktakeLines(stocktakeId: string): StocktakeLineEntity[] {
  return db.stocktakeLine.getAll().filter((line) => line.stocktakeId === stocktakeId);
}

/** Ô (BIN) thuộc phạm vi phiên kiểm kê. */
export function binsInScope(warehouseId: string, zoneIds: readonly string[]): LocationEntity[] {
  const locations = locationsOf(warehouseId);
  const allowed =
    zoneIds.length === 0
      ? null
      : zoneIds.reduce((set, zoneId) => {
          descendantIds(zoneId, locations).forEach((id) => set.add(id));
          return set;
        }, new Set<string>());
  return locations.filter(
    (location) => location.type === 'BIN' && (allowed === null || allowed.has(location.id)),
  );
}

export interface OpenStocktakeInput {
  warehouse: WarehouseEntity;
  name: string;
  zoneIds: string[];
  blind: boolean;
  note: string | null;
  actor: Pick<UserEntity, 'id'>;
  occurredAt: string;
  id?: string;
  nextLineId?: () => string;
}

export function openStocktake(input: OpenStocktakeInput): StocktakeEntity {
  const code = nextDocumentCode('KK', toLocalDate(new Date(input.occurredAt)));
  const stocktake = db.stocktake.create({
    ...(input.id ? { id: input.id } : {}),
    code,
    warehouseId: input.warehouse.id,
    name: input.name,
    status: 'IN_PROGRESS',
    blind: input.blind,
    zoneIds: input.zoneIds,
    note: input.note,
    createdById: input.actor.id,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    submittedById: null,
    submittedAt: null,
    approvedById: null,
    approvedAt: null,
    cancelledById: null,
    cancelledAt: null,
    cancelReason: null,
  });
  const scope = new Set(binsInScope(input.warehouse.id, input.zoneIds).map((bin) => bin.id));
  for (const bin of db.binStock.getAll()) {
    if (bin.warehouseId === input.warehouse.id && bin.quantity > 0 && scope.has(bin.locationId)) {
      createLine(
        stocktake.id,
        bin.locationId,
        bin.productId,
        bin.quantity,
        false,
        input.nextLineId?.(),
      );
    }
  }
  return stocktake;
}

function createLine(
  stocktakeId: string,
  locationId: string,
  productId: string,
  expectedQuantity: number,
  unexpected: boolean,
  id?: string,
): StocktakeLineEntity {
  return db.stocktakeLine.create({
    ...(id ? { id } : {}),
    stocktakeId,
    locationId,
    productId,
    expectedQuantity,
    countedQuantity: null,
    systemQuantityAtCount: null,
    countedById: null,
    countedAt: null,
    note: null,
    unexpected,
    lastClientId: null,
  });
}

export interface CountInput {
  countedQuantity: number;
  countedAt: string;
  actor: Pick<UserEntity, 'id'>;
  note?: string | null;
  clientId?: string | null;
}

export type CountOutcome =
  { applied: true; line: StocktakeLineEntity } | { applied: false; line: StocktakeLineEntity };

/** Ghi số đếm theo last-write-wins trên `countedAt`. */
export function recordCount(line: StocktakeLineEntity, input: CountInput): CountOutcome {
  if (line.lastClientId && input.clientId && line.lastClientId === input.clientId) {
    return { applied: true, line }; // gửi lại cùng entry (đồng bộ lặp) — đã áp dụng
  }
  if (line.countedAt && line.countedAt > input.countedAt) {
    return { applied: false, line };
  }
  const updated = db.stocktakeLine.update({
    where: { id: { equals: line.id } },
    data: {
      countedQuantity: input.countedQuantity,
      systemQuantityAtCount: binQuantity(line.productId, line.locationId),
      countedById: input.actor.id,
      countedAt: input.countedAt,
      note: input.note ?? null,
      lastClientId: input.clientId ?? null,
    },
  })!;
  return { applied: true, line: updated };
}

/** Hàng phát hiện trong ô nhưng không có trong danh sách chốt. */
export function findOrCreateLine(
  stocktake: StocktakeEntity,
  locationId: string,
  productId: string,
): StocktakeLineEntity {
  const existing = stocktakeLines(stocktake.id).find(
    (line) => line.locationId === locationId && line.productId === productId,
  );
  return existing ?? createLine(stocktake.id, locationId, productId, 0, true);
}

export function lineVariance(line: StocktakeLineEntity): number | null {
  return line.countedQuantity === null
    ? null
    : line.countedQuantity - (line.systemQuantityAtCount ?? line.expectedQuantity);
}

export interface StocktakeStats {
  lineCount: number;
  countedLineCount: number;
  varianceLineCount: number;
  varianceQuantity: number;
  varianceValue: number;
}

export function stocktakeStats(
  stocktake: StocktakeEntity,
  lines = stocktakeLines(stocktake.id),
): StocktakeStats {
  const stats: StocktakeStats = {
    lineCount: lines.length,
    countedLineCount: 0,
    varianceLineCount: 0,
    varianceQuantity: 0,
    varianceValue: 0,
  };
  for (const line of lines) {
    const variance = lineVariance(line);
    if (variance === null) continue;
    stats.countedLineCount++;
    if (variance !== 0) {
      stats.varianceLineCount++;
      stats.varianceQuantity += variance;
      stats.varianceValue += variance * currentAverageCost(line.productId, stocktake.warehouseId);
    }
  }
  return stats;
}

/** Duyệt: ghi bút toán điều chỉnh cho mọi dòng đã đếm có chênh lệch (all-or-nothing). */
export function approveStocktake(
  stocktake: StocktakeEntity,
  context: { actor: Pick<UserEntity, 'id'>; occurredAt: string; nextId?: () => string },
): StocktakeEntity {
  const warehouse = findById('warehouse', stocktake.warehouseId)!;
  const inputs: MovementInput[] = [];
  for (const line of stocktakeLines(stocktake.id)) {
    const variance = lineVariance(line);
    if (!variance) continue;
    const product = findById('product', line.productId);
    if (!product) continue;
    // Không để tồn ô âm nếu hàng đã bị xuất sau thời điểm đếm.
    const delta = Math.max(variance, -binQuantity(line.productId, line.locationId));
    if (delta === 0) continue;
    const averageCost = currentAverageCost(product.id, warehouse.id) || product.costPrice;
    inputs.push({
      ...(context.nextId ? { id: context.nextId() } : {}),
      product,
      warehouse,
      locationId: line.locationId,
      quantity: delta,
      unitCost: averageCost,
      type: 'ADJUSTMENT',
      documentType: 'STOCKTAKE',
      documentId: stocktake.id,
      documentCode: stocktake.code,
      occurredAt: context.occurredAt,
      createdById: context.actor.id,
      note: `Kiểm kê: ${delta > 0 ? 'thừa' : 'thiếu'} ${Math.abs(delta)}`,
    });
  }
  postMovements(inputs);
  return db.stocktake.update({
    where: { id: { equals: stocktake.id } },
    data: {
      status: 'COMPLETED',
      approvedById: context.actor.id,
      approvedAt: context.occurredAt,
      updatedAt: context.occurredAt,
    },
  })!;
}
