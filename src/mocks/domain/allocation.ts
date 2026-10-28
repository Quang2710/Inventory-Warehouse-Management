import type { StockPick } from '../../app/core/api/schema';
import { db, findById, type ProductEntity } from '../db';
import { isExpired } from './expiry';
import {
  binsWithStock,
  findStockItem,
  isLotManaged,
  lotsOf,
  serialsInStock,
  serialUnitId,
  stockLotId,
} from './inventory';

/**
 * Phân bổ lấy hàng (FEFO) cho xuất kho, chuyển kho, gợi ý picking:
 * - Sản phẩm quản lý lô/HSD: lấy lô hết hạn trước → cùng hạn thì lô vào ô trước → ưu tiên ô chỉ
 *   định → ô nhiều hàng. Lô đã hết hạn bị loại (trừ khi `includeExpired`, vd xuất hủy).
 * - Sản phẩm thường: ưu tiên ô chỉ định → ô nhiều hàng nhất.
 * - Sản phẩm quản lý serial: serial chỉ định, hoặc tự chọn serial nhập trước trong từng phần lấy.
 */

export interface StockAllocation {
  locationId: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
  quantity: number;
  serialNumbers?: string[];
}

export interface AllocationRequest {
  product: ProductEntity;
  warehouseId: string;
  quantity: number;
  /** Ngày tham chiếu `YYYY-MM-DD` để xác định lô hết hạn. */
  asOf: string;
  includeExpired?: boolean;
  preferredLocationId?: string | null;
  /** Chỉ lấy từ lô này. */
  lotNumber?: string | null;
  /** Serial chỉ định (phải đủ `quantity` số). */
  serialNumbers?: readonly string[];
}

export interface AllocationResult {
  picks: StockAllocation[];
  /** Tồn có thể lấy theo điều kiện (sau khi trừ phần đã giữ chỗ trong cùng chứng từ). */
  available: number;
  /** Tồn thuộc lô đã hết hạn bị loại khỏi phân bổ. */
  expiredExcluded: number;
  shortage: number;
  /** Lỗi serial chỉ định (không tồn tại, không ở kho này…). */
  invalidSerials: string[];
}

/**
 * Sổ giữ chỗ trong phạm vi một chứng từ: các dòng phân bổ lần lượt không lấy trùng phần tồn.
 */
export class AllocationLedger {
  private readonly buckets = new Map<string, number>();
  private readonly serials = new Set<string>();

  used(key: string): number {
    return this.buckets.get(key) ?? 0;
  }

  hasSerial(productId: string, serialNumber: string): boolean {
    return this.serials.has(serialUnitId(productId, serialNumber));
  }

  reserve(product: ProductEntity, warehouseId: string, picks: readonly StockAllocation[]): void {
    for (const pick of picks) {
      const key = bucketKey(product, warehouseId, pick);
      this.buckets.set(key, this.used(key) + pick.quantity);
      pick.serialNumbers?.forEach((serial) => this.serials.add(serialUnitId(product.id, serial)));
    }
  }
}

function bucketKey(
  product: ProductEntity,
  warehouseId: string,
  pick: Pick<StockAllocation, 'locationId' | 'lotNumber' | 'expiryDate'>,
): string {
  return isLotManaged(product)
    ? stockLotId(product.id, pick.locationId, pick.lotNumber, pick.expiryDate)
    : `${product.id}__${pick.locationId ?? warehouseId}`;
}

interface Bucket {
  locationId: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
  free: number;
}

function locationCode(locationId: string | null): string {
  return findById('location', locationId)?.code ?? '';
}

function candidateBuckets(
  request: AllocationRequest,
  ledger: AllocationLedger,
): { buckets: Bucket[]; expiredExcluded: number } {
  const { product, warehouseId } = request;
  const preferred = request.preferredLocationId ?? null;
  const byPreference = (a: Bucket, b: Bucket) =>
    Number(b.locationId === preferred) - Number(a.locationId === preferred) ||
    b.free - a.free ||
    locationCode(a.locationId).localeCompare(locationCode(b.locationId));

  if (isLotManaged(product)) {
    let expiredExcluded = 0;
    const buckets: (Bucket & { receivedAt: string })[] = [];
    for (const lot of lotsOf(product.id, warehouseId)) {
      if (request.lotNumber && lot.lotNumber !== request.lotNumber) continue;
      const free = lot.quantity - ledger.used(lot.id);
      if (free <= 0) continue;
      if (!request.includeExpired && isExpired(lot.expiryDate, request.asOf)) {
        expiredExcluded += free;
        continue;
      }
      buckets.push({
        locationId: lot.locationId,
        lotNumber: lot.lotNumber,
        expiryDate: lot.expiryDate,
        receivedAt: lot.receivedAt,
        free,
      });
    }
    // lotsOf đã theo FEFO; sort ổn định giữ FEFO và chỉ đổi thứ tự trong cùng hạn + ngày nhập.
    buckets.sort(
      (a, b) =>
        (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999') ||
        a.receivedAt.slice(0, 10).localeCompare(b.receivedAt.slice(0, 10)) ||
        byPreference(a, b),
    );
    return { buckets, expiredExcluded };
  }

  const bins = binsWithStock(product.id, warehouseId);
  const buckets: Bucket[] =
    bins.length > 0
      ? bins.map((bin) => ({
          locationId: bin.locationId,
          lotNumber: null,
          expiryDate: null,
          free:
            bin.quantity -
            ledger.used(
              bucketKey(product, warehouseId, {
                locationId: bin.locationId,
                lotNumber: null,
                expiryDate: null,
              }),
            ),
        }))
      : [
          {
            // Kho chưa khai báo vị trí: tồn không gắn ô.
            locationId: null,
            lotNumber: null,
            expiryDate: null,
            free:
              (findStockItem(product.id, warehouseId)?.quantity ?? 0) -
              ledger.used(`${product.id}__${warehouseId}`),
          },
        ];
  return {
    buckets: buckets.filter((bucket) => bucket.free > 0).sort(byPreference),
    expiredExcluded: 0,
  };
}

function allocateSerials(request: AllocationRequest, ledger: AllocationLedger): AllocationResult {
  const { product, warehouseId } = request;
  const groups = new Map<string, StockAllocation>();
  const invalidSerials: string[] = [];
  let expiredExcluded = 0;
  for (const serialNumber of request.serialNumbers ?? []) {
    const unit = findById('serialUnit', serialUnitId(product.id, serialNumber));
    const valid =
      unit &&
      unit.status === 'IN_STOCK' &&
      unit.warehouseId === warehouseId &&
      !ledger.hasSerial(product.id, serialNumber) &&
      (!request.lotNumber || unit.lotNumber === request.lotNumber);
    if (!valid) {
      invalidSerials.push(serialNumber);
      continue;
    }
    if (!request.includeExpired && isExpired(unit.expiryDate, request.asOf)) {
      expiredExcluded++;
      invalidSerials.push(serialNumber);
      continue;
    }
    const key = `${unit.locationId ?? ''}__${unit.lotNumber ?? ''}|${unit.expiryDate ?? ''}`;
    const group = groups.get(key) ?? {
      locationId: unit.locationId,
      lotNumber: unit.lotNumber,
      expiryDate: unit.expiryDate,
      quantity: 0,
      serialNumbers: [],
    };
    group.quantity++;
    group.serialNumbers!.push(serialNumber);
    groups.set(key, group);
  }
  const picks = [...groups.values()];
  const available = picks.reduce((sum, pick) => sum + pick.quantity, 0);
  return {
    picks,
    available,
    expiredExcluded,
    shortage: Math.max(0, request.quantity - available),
    invalidSerials,
  };
}

/**
 * Phân bổ một dòng. Không ghi dữ liệu; gọi `ledger.reserve` sau khi chấp nhận kết quả để dòng
 * sau không lấy trùng.
 */
export function allocateStock(
  request: AllocationRequest,
  ledger: AllocationLedger = new AllocationLedger(),
): AllocationResult {
  if (request.product.trackSerial && request.serialNumbers?.length) {
    return allocateSerials(request, ledger);
  }
  const { buckets, expiredExcluded } = candidateBuckets(request, ledger);
  const picks: StockAllocation[] = [];
  let remaining = request.quantity;
  for (const bucket of buckets) {
    if (remaining <= 0) break;
    const take = Math.min(bucket.free, remaining);
    picks.push({
      locationId: bucket.locationId,
      lotNumber: bucket.lotNumber,
      expiryDate: bucket.expiryDate,
      quantity: take,
    });
    remaining -= take;
  }
  if (request.product.trackSerial) {
    for (const pick of picks) {
      const lot = isLotManaged(request.product)
        ? { lotNumber: pick.lotNumber, expiryDate: pick.expiryDate }
        : undefined;
      pick.serialNumbers = serialsInStock(
        request.product.id,
        request.warehouseId,
        pick.locationId,
        lot,
      )
        .filter((unit) => !ledger.hasSerial(request.product.id, unit.serialNumber))
        .slice(0, pick.quantity)
        .map((unit) => unit.serialNumber);
    }
  }
  const available = buckets.reduce((sum, bucket) => sum + bucket.free, 0);
  return {
    picks,
    available,
    expiredExcluded,
    shortage: Math.max(0, remaining),
    invalidSerials: [],
  };
}

/** Tồn có thể bán (loại lô hết hạn) của sản phẩm tại kho. */
export function sellableQuantity(
  product: ProductEntity,
  warehouseId: string,
  asOf: string,
): number {
  return allocateStock({ product, warehouseId, quantity: 0, asOf }).available;
}

/** Phân bổ → DTO cho contract (`StockPick`). */
export function toStockPick(pick: StockAllocation): StockPick {
  return {
    locationId: pick.locationId,
    locationCode: findById('location', pick.locationId)?.code ?? null,
    lotNumber: pick.lotNumber,
    expiryDate: pick.expiryDate,
    quantity: pick.quantity,
    ...(pick.serialNumbers?.length ? { serialNumbers: [...pick.serialNumbers] } : {}),
  };
}

export function parseAllocations(raw: string | null | undefined): StockAllocation[] {
  try {
    const value: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(value)) return [];
    // Dữ liệu cũ (giai đoạn 2) chỉ có { locationId, quantity }.
    return (value as Partial<StockAllocation>[]).map((pick) => ({
      locationId: pick.locationId ?? null,
      lotNumber: pick.lotNumber ?? null,
      expiryDate: pick.expiryDate ?? null,
      quantity: pick.quantity ?? 0,
      ...(pick.serialNumbers?.length ? { serialNumbers: pick.serialNumbers } : {}),
    }));
  } catch {
    return [];
  }
}

/** Số lô hiện có (để kiểm tra lô chỉ định có tồn tại). */
export function lotExists(productId: string, warehouseId: string, lotNumber: string): boolean {
  return db.stockLot
    .getAll()
    .some(
      (lot) =>
        lot.productId === productId &&
        lot.warehouseId === warehouseId &&
        lot.lotNumber === lotNumber &&
        lot.quantity > 0,
    );
}
