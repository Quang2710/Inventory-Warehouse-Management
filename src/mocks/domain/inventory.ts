import type {
  DocumentType,
  MovementType,
  SerialStatus,
  StockStatus,
} from '../../app/core/api/schema';
import {
  db,
  findById,
  type BinStockEntity,
  type ProductEntity,
  type SerialUnitEntity,
  type StockItemEntity,
  type StockLotEntity,
  type StockMovementEntity,
  type WarehouseEntity,
} from '../db';

/**
 * Nghiệp vụ tồn kho dùng chung cho seed và handler:
 * - Tồn kho = tổng hợp từ StockMovement; mọi thay đổi tồn đều sinh movement kèm chứng từ.
 * - Tồn theo kho (`stockItem`), theo ô (`binStock`), theo lô (`stockLot`, sản phẩm quản lý lô/HSD)
 *   và trạng thái từng serial (`serialUnit`) được cập nhật cùng lúc trong `postMovements`.
 *   Mọi movement của kho có vị trí đều gắn ô → tổng tồn các ô = tồn của kho; tổng các lô của
 *   một ô = tồn của ô.
 * - Không cho phép tồn âm (ở cả cấp kho, ô và lô).
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
  /**
   * Lô / hạn của sản phẩm quản lý lô hoặc HSD. Bỏ trống (`undefined`):
   * xuất → tự chia theo FEFO trong ô; nhập → gộp vào lô nhập gần nhất của ô (vd kiểm kê thừa).
   */
  lotNumber?: string | null;
  expiryDate?: string | null;
  /**
   * Serial của sản phẩm quản lý serial, đủ |quantity| số. Bỏ trống: xuất → tự chọn serial trong
   * ô/lô (nhập trước xuất trước); nhập → sinh serial tạm theo mã chứng từ (vd kiểm kê thừa).
   */
  serialNumbers?: readonly string[];
}

export interface StockShortage {
  /** Vị trí dòng đầu tiên của sản phẩm trong danh sách input. */
  index: number;
  productId: string;
  sku: string;
  productName: string;
  locationId: string | null;
  lotNumber?: string | null;
  available: number;
  requested: number;
}

export class InsufficientStockError extends Error {
  constructor(readonly shortages: readonly StockShortage[]) {
    super(shortages.map((s) => `${s.sku}: tồn ${s.available}, cần ${s.requested}`).join('; '));
    this.name = 'InsufficientStockError';
  }
}

export interface SerialProblem {
  /** Vị trí input gây lỗi. */
  index: number;
  sku: string;
  serialNumber: string | null;
  message: string;
}

export class SerialError extends Error {
  constructor(readonly problems: readonly SerialProblem[]) {
    super(problems.map((problem) => problem.message).join('; '));
    this.name = 'SerialError';
  }
}

// ── khóa & tra cứu ──

export function stockItemId(productId: string, warehouseId: string): string {
  return `${productId}__${warehouseId}`;
}

export function binStockId(productId: string, locationId: string): string {
  return `${productId}__${locationId}`;
}

export function lotKey(lotNumber: string | null, expiryDate: string | null): string {
  return `${lotNumber ?? ''}|${expiryDate ?? ''}`;
}

export function stockLotId(
  productId: string,
  locationId: string | null,
  lotNumber: string | null,
  expiryDate: string | null,
): string {
  return `${productId}__${locationId ?? ''}__${lotKey(lotNumber, expiryDate)}`;
}

export function serialUnitId(productId: string, serialNumber: string): string {
  return `${productId}__${serialNumber}`;
}

/** Sản phẩm được theo dõi tồn theo lô (lô và/hoặc hạn sử dụng). */
export function isLotManaged(product: Pick<ProductEntity, 'trackLot' | 'trackExpiry'>): boolean {
  return product.trackLot || product.trackExpiry;
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

/** Thứ tự FEFO: hạn gần nhất trước (không có hạn xếp cuối), cùng hạn thì lô vào ô trước. */
export function compareFefo(
  a: Pick<StockLotEntity, 'expiryDate' | 'receivedAt'>,
  b: Pick<StockLotEntity, 'expiryDate' | 'receivedAt'>,
): number {
  if (a.expiryDate !== b.expiryDate) {
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;
    return a.expiryDate < b.expiryDate ? -1 : 1;
  }
  return a.receivedAt.localeCompare(b.receivedAt);
}

/**
 * Lô còn tồn của sản phẩm trong kho, theo thứ tự FEFO.
 * @param locationId `undefined` = mọi ô; `null` = phần tồn không gắn ô.
 */
export function lotsOf(
  productId: string,
  warehouseId: string,
  locationId?: string | null,
): StockLotEntity[] {
  return db.stockLot
    .getAll()
    .filter(
      (lot) =>
        lot.productId === productId &&
        lot.warehouseId === warehouseId &&
        lot.quantity > 0 &&
        (locationId === undefined || lot.locationId === locationId),
    )
    .sort(compareFefo);
}

/** Serial đang trong kho tại ô/lô, nhập trước đứng trước. */
export function serialsInStock(
  productId: string,
  warehouseId: string,
  locationId?: string | null,
  lot?: { lotNumber: string | null; expiryDate: string | null },
): SerialUnitEntity[] {
  return db.serialUnit
    .getAll()
    .filter(
      (unit) =>
        unit.productId === productId &&
        unit.status === 'IN_STOCK' &&
        unit.warehouseId === warehouseId &&
        (locationId === undefined || unit.locationId === locationId) &&
        (!lot || (unit.lotNumber === lot.lotNumber && unit.expiryDate === lot.expiryDate)),
    )
    .sort(
      (a, b) =>
        a.receivedAt.localeCompare(b.receivedAt) || a.serialNumber.localeCompare(b.serialNumber),
    );
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

// ── chuẩn hóa input: chia lô, chọn serial ──

interface PlannedMovement {
  input: MovementInput;
  /** Vị trí input gốc (báo lỗi theo dòng chứng từ). */
  index: number;
}

/** Xuất không chỉ định lô → chia theo FEFO trong đúng ô (gồm cả lô đã hết hạn — hàng thật). */
function splitByLots(input: MovementInput, consumed: Map<string, number>): MovementInput[] {
  const parts: MovementInput[] = [];
  let remaining = -input.quantity;
  for (const lot of lotsOf(input.product.id, input.warehouse.id, input.locationId)) {
    if (remaining <= 0) break;
    const free = lot.quantity - (consumed.get(lot.id) ?? 0);
    if (free <= 0) continue;
    const take = Math.min(free, remaining);
    consumed.set(lot.id, (consumed.get(lot.id) ?? 0) + take);
    parts.push({
      ...input,
      quantity: -take,
      lotNumber: lot.lotNumber,
      expiryDate: lot.expiryDate,
    });
    remaining -= take;
  }
  if (remaining > 0) {
    // Không đủ lô — để kiểm tra tồn báo thiếu ở cấp lô.
    parts.push({ ...input, quantity: -remaining, lotNumber: null, expiryDate: null });
  }
  return parts;
}

/** Nhập không rõ lô → gộp vào lô vào ô gần nhất (hoặc của kho), nếu không có thì lô trống. */
function defaultLot(input: MovementInput): Pick<MovementInput, 'lotNumber' | 'expiryDate'> {
  const newest = (lots: StockLotEntity[]) =>
    [...lots].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  const lot =
    newest(lotsOf(input.product.id, input.warehouse.id, input.locationId)) ??
    newest(lotsOf(input.product.id, input.warehouse.id));
  return { lotNumber: lot?.lotNumber ?? null, expiryDate: lot?.expiryDate ?? null };
}

function withSerials(input: MovementInput, used: Set<string>): MovementInput {
  if (input.serialNumbers?.length) {
    input.serialNumbers.forEach((serial) => used.add(serialUnitId(input.product.id, serial)));
    return input;
  }
  const count = Math.abs(input.quantity);
  if (input.quantity < 0) {
    const lot = isLotManaged(input.product)
      ? { lotNumber: input.lotNumber ?? null, expiryDate: input.expiryDate ?? null }
      : undefined;
    const picked = serialsInStock(input.product.id, input.warehouse.id, input.locationId, lot)
      .filter((unit) => !used.has(unit.id))
      .slice(0, count);
    picked.forEach((unit) => used.add(unit.id));
    return { ...input, serialNumbers: picked.map((unit) => unit.serialNumber) };
  }
  // Nhập không có serial (kiểm kê thừa): sinh serial tạm theo chứng từ để vẫn truy vết được.
  const generated: string[] = [];
  for (let seq = 1; generated.length < count; seq++) {
    const serial = `${input.documentCode}-${String(seq).padStart(3, '0')}`;
    const id = serialUnitId(input.product.id, serial);
    if (!used.has(id) && findById('serialUnit', id)?.status !== 'IN_STOCK') {
      used.add(id);
      generated.push(serial);
    }
  }
  return { ...input, serialNumbers: generated };
}

function plan(inputs: readonly MovementInput[]): PlannedMovement[] {
  const consumedLots = new Map<string, number>();
  const usedSerials = new Set<string>();
  const planned: PlannedMovement[] = [];
  inputs.forEach((input, index) => {
    let parts: MovementInput[] = [input];
    if (isLotManaged(input.product)) {
      if (input.lotNumber === undefined && input.expiryDate === undefined) {
        parts =
          input.quantity < 0
            ? splitByLots(input, consumedLots)
            : [{ ...input, ...defaultLot(input) }];
      }
    } else {
      parts = [{ ...input, lotNumber: null, expiryDate: null }];
    }
    if (input.product.trackSerial) {
      parts = parts.map((part) => withSerials(part, usedSerials));
    }
    parts.forEach((part) => planned.push({ input: part, index }));
  });
  return planned;
}

// ── kiểm tra ──

function shortagesOf(planned: readonly PlannedMovement[]): StockShortage[] {
  const required = new Map<string, StockShortage>();
  const add = (
    { input, index }: PlannedMovement,
    key: string,
    available: number,
    locationId: string | null,
    lotNumber?: string | null,
  ) => {
    const entry: StockShortage = required.get(key) ?? {
      index,
      productId: input.product.id,
      sku: input.product.sku,
      productName: input.product.name,
      locationId,
      ...(lotNumber !== undefined ? { lotNumber } : {}),
      available,
      requested: 0,
    };
    entry.requested += -input.quantity;
    required.set(key, entry);
  };
  for (const item of planned) {
    const { input } = item;
    if (input.quantity >= 0) continue;
    add(
      item,
      `W:${stockItemId(input.product.id, input.warehouse.id)}`,
      availableQuantity(input.product.id, input.warehouse.id),
      null,
    );
    if (input.locationId) {
      add(
        item,
        `B:${binStockId(input.product.id, input.locationId)}`,
        binQuantity(input.product.id, input.locationId),
        input.locationId,
      );
    }
    if (isLotManaged(input.product)) {
      const lotNumber = input.lotNumber ?? null;
      const id = stockLotId(
        input.product.id,
        input.locationId,
        lotNumber,
        input.expiryDate ?? null,
      );
      add(item, `L:${id}`, findById('stockLot', id)?.quantity ?? 0, input.locationId, lotNumber);
    }
  }
  return [...required.values()].filter((entry) => entry.requested > entry.available);
}

/** Trạng thái serial hợp lệ trước khi NHẬP theo từng loại biến động. */
const INBOUND_SERIAL_FROM: Partial<Record<MovementType, readonly (SerialStatus | null)[]>> = {
  RECEIPT: [null, 'ISSUED', 'WRITTEN_OFF'],
  ADJUSTMENT: [null, 'ISSUED', 'WRITTEN_OFF'],
  TRANSFER_IN: ['IN_TRANSIT'],
  TRANSFER_CANCEL: ['IN_TRANSIT'],
  ISSUE_CANCEL: ['ISSUED'],
};

const SERIAL_STATUS_LABEL: Record<SerialStatus, string> = {
  IN_STOCK: 'đang trong kho',
  IN_TRANSIT: 'đang vận chuyển',
  ISSUED: 'đã xuất',
  WRITTEN_OFF: 'đã loại khỏi kho',
};

function serialProblemsOf(planned: readonly PlannedMovement[]): SerialProblem[] {
  const problems: SerialProblem[] = [];
  const seen = new Set<string>();
  for (const { input, index } of planned) {
    if (!input.product.trackSerial) continue;
    const serials = input.serialNumbers ?? [];
    const sku = input.product.sku;
    if (serials.length !== Math.abs(input.quantity)) {
      problems.push({
        index,
        sku,
        serialNumber: null,
        message: `${sku}: cần ${Math.abs(input.quantity)} serial, có ${serials.length}.`,
      });
    }
    for (const serial of serials) {
      const id = serialUnitId(input.product.id, serial);
      const unit = findById('serialUnit', id);
      if (seen.has(id)) {
        problems.push({ index, sku, serialNumber: serial, message: `Serial ${serial} bị lặp.` });
        continue;
      }
      seen.add(id);
      if (input.quantity < 0) {
        const lotMatches =
          !isLotManaged(input.product) ||
          (unit?.lotNumber === (input.lotNumber ?? null) &&
            unit?.expiryDate === (input.expiryDate ?? null));
        if (
          !unit ||
          unit.status !== 'IN_STOCK' ||
          unit.warehouseId !== input.warehouse.id ||
          (input.locationId !== null && unit.locationId !== input.locationId) ||
          !lotMatches
        ) {
          problems.push({
            index,
            sku,
            serialNumber: serial,
            message: unit
              ? `Serial ${serial} ${unit.status === 'IN_STOCK' ? 'không ở kho/ô/lô này' : SERIAL_STATUS_LABEL[unit.status]}.`
              : `Serial ${serial} không tồn tại.`,
          });
        }
      } else {
        const allowed = INBOUND_SERIAL_FROM[input.type] ?? [null];
        if (!allowed.includes(unit?.status ?? null)) {
          problems.push({
            index,
            sku,
            serialNumber: serial,
            message: unit
              ? `Serial ${serial} ${SERIAL_STATUS_LABEL[unit.status]}, không nhập được.`
              : `Serial ${serial} không tồn tại.`,
          });
        }
      }
    }
  }
  return problems;
}

/** Kiểm tra trước toàn bộ dòng xuất (gộp theo kho, ô và lô) — không ghi gì. */
export function findShortages(inputs: readonly MovementInput[]): StockShortage[] {
  return shortagesOf(plan(inputs));
}

// ── ghi sổ ──

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

function applyLot(input: MovementInput): void {
  if (!isLotManaged(input.product)) {
    return;
  }
  const lotNumber = input.lotNumber ?? null;
  const expiryDate = input.expiryDate ?? null;
  const id = stockLotId(input.product.id, input.locationId, lotNumber, expiryDate);
  const existing = findById('stockLot', id);
  const quantity = (existing?.quantity ?? 0) + input.quantity;
  if (existing && quantity <= 0) {
    db.stockLot.delete({ where: { id: { equals: id } } });
  } else if (existing) {
    db.stockLot.update({
      where: { id: { equals: id } },
      data: { quantity, updatedAt: input.occurredAt },
    });
  } else if (quantity > 0) {
    db.stockLot.create({
      id,
      productId: input.product.id,
      warehouseId: input.warehouse.id,
      locationId: input.locationId,
      lotNumber,
      expiryDate,
      receivedAt: input.occurredAt,
      quantity,
      updatedAt: input.occurredAt,
    });
  }
}

/** Trạng thái serial sau khi XUẤT theo loại biến động. */
function outboundSerialStatus(type: MovementType): SerialStatus {
  switch (type) {
    case 'ISSUE':
      return 'ISSUED';
    case 'TRANSFER_OUT':
      return 'IN_TRANSIT';
    default:
      return 'WRITTEN_OFF';
  }
}

function applySerials(input: MovementInput): void {
  if (!input.product.trackSerial) {
    return;
  }
  const inbound = input.quantity > 0;
  for (const serialNumber of input.serialNumbers ?? []) {
    const id = serialUnitId(input.product.id, serialNumber);
    const existing = findById('serialUnit', id);
    const data = {
      status: inbound ? ('IN_STOCK' as const) : outboundSerialStatus(input.type),
      warehouseId: inbound || input.type === 'TRANSFER_OUT' ? input.warehouse.id : null,
      locationId: inbound ? input.locationId : null,
      lotNumber: isLotManaged(input.product) ? (input.lotNumber ?? null) : null,
      expiryDate: isLotManaged(input.product) ? (input.expiryDate ?? null) : null,
      lastDocumentType: input.documentType,
      lastDocumentId: input.documentId,
      lastDocumentCode: input.documentCode,
      updatedAt: input.occurredAt,
    };
    if (existing) {
      db.serialUnit.update({
        where: { id: { equals: id } },
        data: input.type === 'RECEIPT' ? { ...data, receivedAt: input.occurredAt } : data,
      });
    } else {
      db.serialUnit.create({
        id,
        productId: input.product.id,
        serialNumber,
        receivedAt: input.occurredAt,
        ...data,
      });
    }
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
  applyLot(input);
  applySerials(input);

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
    lotNumber: input.lotNumber ?? null,
    expiryDate: input.expiryDate ?? null,
    serialNumbers: [...(input.serialNumbers ?? [])],
  });
}

/**
 * Ghi sổ một chứng từ: chuẩn hóa lô/serial, kiểm tra đủ tồn và serial hợp lệ cho TẤT CẢ dòng
 * trước, sau đó mới ghi (all-or-nothing). Ném `InsufficientStockError` nếu bất kỳ dòng nào làm
 * tồn âm (kho/ô/lô), `SerialError` nếu serial không hợp lệ.
 */
export function postMovements(inputs: readonly MovementInput[]): StockMovementEntity[] {
  const planned = plan(inputs);
  const shortages = shortagesOf(planned);
  if (shortages.length > 0) {
    throw new InsufficientStockError(shortages);
  }
  const problems = serialProblemsOf(planned);
  if (problems.length > 0) {
    throw new SerialError(problems);
  }
  return planned.map(({ input }) => applyOne(input));
}

/** Movement của một chứng từ theo thứ tự ghi. */
export function movementsOf(documentId: string, type?: MovementType): StockMovementEntity[] {
  return db.stockMovement
    .getAll()
    .filter((movement) => movement.documentId === documentId && (!type || movement.type === type));
}

/** Loại serial khỏi kho mà không có biến động tồn (vd hàng thất lạc khi đang vận chuyển). */
export function writeOffSerials(
  productId: string,
  serialNumbers: readonly string[],
  document: {
    documentType: DocumentType;
    documentId: string;
    documentCode: string;
    occurredAt: string;
  },
): void {
  for (const serialNumber of serialNumbers) {
    const id = serialUnitId(productId, serialNumber);
    if (!findById('serialUnit', id)) continue;
    db.serialUnit.update({
      where: { id: { equals: id } },
      data: {
        status: 'WRITTEN_OFF',
        warehouseId: null,
        locationId: null,
        lastDocumentType: document.documentType,
        lastDocumentId: document.documentId,
        lastDocumentCode: document.documentCode,
        updatedAt: document.occurredAt,
      },
    });
  }
}
