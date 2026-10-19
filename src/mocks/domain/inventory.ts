import type { DocumentType, MovementType, StockStatus } from '../../app/core/api/schema';
import {
  db,
  findById,
  type BinStockEntity,
  type ProductEntity,
  type StockItemEntity,
  type StockMovementEntity,
  type WarehouseEntity,
} from '../db';

/**
 * Nghiệp vụ tồn kho dùng chung cho seed và handler:
 * - Tồn kho = tổng hợp từ StockMovement; mọi thay đổi tồn đều sinh movement kèm chứng từ.
 * - Tồn theo kho (`stockItem`) và theo ô (`binStock`) được cập nhật cùng lúc; mọi movement của
 *   kho có vị trí đều gắn ô → tổng tồn các ô = tồn của kho.
 * - Không cho phép tồn âm (ở cả cấp kho và cấp ô).
 * - Giá vốn: bình quân gia quyền di động theo từng kho.
 */

export interface MovementInput {
  /** Cho phép seed truyền id tất định; mặc định sinh UUID ngẫu nhiên. */
  id?: string;
  product: ProductEntity;
  warehouse: WarehouseEntity;
  /** Ô phát sinh biến động (bắt buộc với kho đã khai báo vị trí). */
  locationId: string | null;
  /** Số lượng có dấu: + nhập, − xuất. */
  quantity: number;
  /** Đơn giá vốn của dòng biến động (nhập: giá nhập; xuất: giá vốn bình quân hiện tại). */
  unitCost: number;
  type: MovementType;
  documentType: DocumentType;
  documentId: string;
  documentCode: string;
  occurredAt: string;
  createdById: string;
  note?: string | null;
}

export interface StockShortage {
  /** Vị trí dòng đầu tiên của sản phẩm trong danh sách input. */
  index: number;
  productId: string;
  sku: string;
  productName: string;
  locationId: string | null;
  available: number;
  requested: number;
}

export class InsufficientStockError extends Error {
  constructor(readonly shortages: readonly StockShortage[]) {
    super(shortages.map((s) => `${s.sku}: tồn ${s.available}, cần ${s.requested}`).join('; '));
    this.name = 'InsufficientStockError';
  }
}

export function stockItemId(productId: string, warehouseId: string): string {
  return `${productId}__${warehouseId}`;
}

export function binStockId(productId: string, locationId: string): string {
  return `${productId}__${locationId}`;
}

export function findStockItem(productId: string, warehouseId: string): StockItemEntity | null {
  return findById('stockItem', stockItemId(productId, warehouseId));
}

export function availableQuantity(productId: string, warehouseId: string): number {
  return findStockItem(productId, warehouseId)?.quantity ?? 0;
}

export function binQuantity(productId: string, locationId: string): number {
  return findById('binStock', binStockId(productId, locationId))?.quantity ?? 0;
}

export function currentAverageCost(productId: string, warehouseId: string): number {
  return findStockItem(productId, warehouseId)?.averageCost ?? 0;
}

export function stockStatusOf(quantity: number, minStock: number): StockStatus {
  if (quantity <= 0) {
    return 'OUT_OF_STOCK';
  }
  return quantity < minStock ? 'LOW_STOCK' : 'IN_STOCK';
}

/** Các ô đang chứa sản phẩm trong kho, nhiều hàng nhất trước. */
export function binsWithStock(productId: string, warehouseId: string): BinStockEntity[] {
  return db.binStock
    .getAll()
    .filter(
      (bin) => bin.productId === productId && bin.warehouseId === warehouseId && bin.quantity > 0,
    )
    .sort((a, b) => b.quantity - a.quantity);
}

export interface BinAllocation {
  locationId: string;
  quantity: number;
}

/**
 * Phân bổ lấy hàng từ các ô: ưu tiên ô chỉ định, sau đó ô nhiều hàng nhất.
 * Trả `null` nếu tổng tồn các ô không đủ.
 */
export function allocateFromBins(
  productId: string,
  warehouseId: string,
  quantity: number,
  preferredLocationId?: string | null,
): BinAllocation[] | null {
  const bins = binsWithStock(productId, warehouseId);
  if (preferredLocationId) {
    bins.sort(
      (a, b) =>
        Number(b.locationId === preferredLocationId) - Number(a.locationId === preferredLocationId),
    );
  }
  const allocations: BinAllocation[] = [];
  let remaining = quantity;
  for (const bin of bins) {
    if (remaining <= 0) break;
    const take = Math.min(bin.quantity, remaining);
    allocations.push({ locationId: bin.locationId, quantity: take });
    remaining -= take;
  }
  return remaining > 0 ? null : allocations;
}

/**
 * Chọn ô cất hàng: ô đang chứa sản phẩm (nhiều nhất) → nếu chưa có, ô hoạt động trống nhất.
 */
export function putawayLocationId(productId: string, warehouseId: string): string | null {
  const existing = binsWithStock(productId, warehouseId)[0];
  if (existing) {
    return existing.locationId;
  }
  const load = new Map<string, number>();
  for (const bin of db.binStock.getAll()) {
    if (bin.warehouseId === warehouseId) {
      load.set(bin.locationId, (load.get(bin.locationId) ?? 0) + bin.quantity);
    }
  }
  const candidates = db.location
    .getAll()
    .filter(
      (location) =>
        location.warehouseId === warehouseId &&
        location.type === 'BIN' &&
        location.status === 'ACTIVE',
    )
    .map((location) => ({
      id: location.id,
      fill: (load.get(location.id) ?? 0) / Math.max(1, location.capacity ?? 1),
      code: location.code,
    }))
    .sort((a, b) => a.fill - b.fill || a.code.localeCompare(b.code));
  return candidates[0]?.id ?? null;
}

/** Kiểm tra trước toàn bộ dòng xuất (gộp theo kho và theo ô) — không ghi gì. */
export function findShortages(inputs: readonly MovementInput[]): StockShortage[] {
  const required = new Map<string, StockShortage>();
  const add = (
    input: MovementInput,
    index: number,
    key: string,
    available: number,
    locationId: string | null,
  ) => {
    const entry: StockShortage = required.get(key) ?? {
      index,
      productId: input.product.id,
      sku: input.product.sku,
      productName: input.product.name,
      locationId,
      available,
      requested: 0,
    };
    entry.requested += -input.quantity;
    required.set(key, entry);
  };
  inputs.forEach((input, index) => {
    if (input.quantity >= 0) {
      return;
    }
    add(
      input,
      index,
      `W:${stockItemId(input.product.id, input.warehouse.id)}`,
      availableQuantity(input.product.id, input.warehouse.id),
      null,
    );
    if (input.locationId) {
      add(
        input,
        index,
        `B:${binStockId(input.product.id, input.locationId)}`,
        binQuantity(input.product.id, input.locationId),
        input.locationId,
      );
    }
  });
  return [...required.values()].filter((entry) => entry.requested > entry.available);
}

function nextAverageCost(
  currentQty: number,
  currentAvg: number,
  input: MovementInput,
  nextQty: number,
): number {
  const isInbound = input.quantity > 0;
  // Xuất, chuyển đi, điều chỉnh giảm không làm đổi giá vốn bình quân.
  const changesCost = isInbound || input.type === 'RECEIPT_CANCEL';
  if (!changesCost) {
    return currentAvg;
  }
  if (nextQty <= 0) {
    return isInbound ? input.unitCost : currentAvg;
  }
  const value = currentQty * currentAvg + input.quantity * input.unitCost;
  return Math.max(0, Math.round(value / nextQty));
}

function applyBin(input: MovementInput): void {
  if (!input.locationId) {
    return;
  }
  const id = binStockId(input.product.id, input.locationId);
  const existing = findById('binStock', id);
  const quantity = (existing?.quantity ?? 0) + input.quantity;
  if (existing && quantity <= 0) {
    db.binStock.delete({ where: { id: { equals: id } } });
  } else if (existing) {
    db.binStock.update({
      where: { id: { equals: id } },
      data: { quantity, updatedAt: input.occurredAt },
    });
  } else if (quantity > 0) {
    db.binStock.create({
      id,
      productId: input.product.id,
      warehouseId: input.warehouse.id,
      locationId: input.locationId,
      quantity,
      updatedAt: input.occurredAt,
    });
  }
}

function applyOne(input: MovementInput): StockMovementEntity {
  const id = stockItemId(input.product.id, input.warehouse.id);
  const existing = findById('stockItem', id);
  const currentQty = existing?.quantity ?? 0;
  const currentAvg = existing?.averageCost ?? 0;
  const nextQty = currentQty + input.quantity;
  const averageCost = nextAverageCost(currentQty, currentAvg, input, nextQty);

  if (existing) {
    db.stockItem.update({
      where: { id: { equals: id } },
      data: { quantity: nextQty, averageCost, lastMovementAt: input.occurredAt },
    });
  } else {
    db.stockItem.create({
      id,
      productId: input.product.id,
      warehouseId: input.warehouse.id,
      quantity: nextQty,
      averageCost,
      lastMovementAt: input.occurredAt,
    });
  }
  applyBin(input);

  return db.stockMovement.create({
    ...(input.id ? { id: input.id } : {}),
    occurredAt: input.occurredAt,
    type: input.type,
    productId: input.product.id,
    warehouseId: input.warehouse.id,
    locationId: input.locationId,
    quantity: input.quantity,
    balanceAfter: nextQty,
    unitCost: input.unitCost,
    documentType: input.documentType,
    documentId: input.documentId,
    documentCode: input.documentCode,
    createdById: input.createdById,
    note: input.note ?? null,
  });
}

/**
 * Ghi sổ một chứng từ: kiểm tra đủ tồn cho TẤT CẢ dòng trước, sau đó mới ghi
 * (all-or-nothing). Ném `InsufficientStockError` nếu bất kỳ dòng nào làm tồn âm.
 */
export function postMovements(inputs: readonly MovementInput[]): StockMovementEntity[] {
  const shortages = findShortages(inputs);
  if (shortages.length > 0) {
    throw new InsufficientStockError(shortages);
  }
  return inputs.map(applyOne);
}
