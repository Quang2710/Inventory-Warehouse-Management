import { drop } from '@mswjs/data';

import { db, findById } from './db';
import { isExpired } from './domain/expiry';
import { binStockId, isLotManaged, stockItemId } from './domain/inventory';
import { seedDatabase } from './seed';
import { toLocalDate } from './utils/date';

const NOW = new Date('2026-10-18T10:00:00+07:00');

/** Bất biến tồn theo lô / serial và FEFO của bộ dữ liệu demo. */
describe('seedDatabase — lô, hạn sử dụng, serial', () => {
  beforeAll(() => {
    drop(db);
    seedDatabase(NOW);
  });

  it('sản phẩm quản lý lô: tổng các lô của một ô = tồn ô; lô không âm', () => {
    const byBin = new Map<string, number>();
    for (const lot of db.stockLot.getAll()) {
      expect(lot.quantity).toBeGreaterThan(0);
      const product = findById('product', lot.productId)!;
      expect(isLotManaged(product)).toBe(true);
      if (product.trackLot) expect(lot.lotNumber).toBeTruthy();
      const key = binStockId(lot.productId, lot.locationId!);
      byBin.set(key, (byBin.get(key) ?? 0) + lot.quantity);
    }
    for (const bin of db.binStock.getAll()) {
      const product = findById('product', bin.productId)!;
      if (isLotManaged(product)) {
        expect(byBin.get(bin.id) ?? 0).toBe(bin.quantity);
      }
    }
  });

  it('sản phẩm quản lý serial: số serial trong kho = tồn từng ô, mỗi serial một nơi', () => {
    const byBin = new Map<string, number>();
    const serialProducts = new Set(
      db.product
        .getAll()
        .filter((p) => p.trackSerial)
        .map((p) => p.id),
    );
    expect(serialProducts.size).toBeGreaterThan(0);
    for (const unit of db.serialUnit.getAll()) {
      if (unit.status !== 'IN_STOCK') continue;
      const key = binStockId(unit.productId, unit.locationId!);
      byBin.set(key, (byBin.get(key) ?? 0) + 1);
    }
    for (const item of db.stockItem.getAll()) {
      if (!serialProducts.has(item.productId)) continue;
      const inStock = db.serialUnit
        .getAll()
        .filter(
          (unit) =>
            unit.productId === item.productId &&
            unit.warehouseId === item.warehouseId &&
            unit.status === 'IN_STOCK',
        ).length;
      expect(inStock).toBe(item.quantity);
    }
    for (const bin of db.binStock.getAll()) {
      if (serialProducts.has(bin.productId)) {
        expect(byBin.get(bin.id) ?? 0).toBe(bin.quantity);
      }
    }
    expect(db.serialUnit.getAll().some((unit) => unit.status === 'ISSUED')).toBe(true);
  });

  it('movement của sản phẩm quản lý lô luôn có lô; serial khớp số lượng', () => {
    for (const movement of db.stockMovement.getAll()) {
      const product = findById('product', movement.productId)!;
      if (product.trackLot) {
        expect(movement.lotNumber).toBeTruthy();
      }
      if (product.trackSerial) {
        expect(movement.serialNumbers.length).toBe(Math.abs(movement.quantity));
      }
    }
  });

  it('FEFO: xuất bán / chuyển kho không bao giờ lấy lô đã hết hạn (chỉ xuất hủy được)', () => {
    const outbound = db.stockMovement
      .getAll()
      .filter((m) => (m.type === 'ISSUE' || m.type === 'TRANSFER_OUT') && m.expiryDate);
    expect(outbound.length).toBeGreaterThan(0);
    for (const movement of outbound) {
      const asOf = toLocalDate(new Date(movement.occurredAt));
      if (!isExpired(movement.expiryDate, asOf)) continue;
      const issue = findById('goodsIssue', movement.documentId);
      expect(movement.type).toBe('ISSUE');
      expect(issue?.reason).toBe('DAMAGED');
    }
  });

  it('có lô sắp hết hạn và đã hết hạn để minh họa cảnh báo', () => {
    const today = toLocalDate(NOW);
    const lots = db.stockLot.getAll().filter((lot) => lot.expiryDate);
    expect(lots.some((lot) => isExpired(lot.expiryDate, today))).toBe(true);
    expect(
      lots.some(
        (lot) =>
          !isExpired(lot.expiryDate, today) &&
          lot.expiryDate! <= toLocalDate(new Date(NOW.getTime() + 30 * 86_400_000)),
      ),
    ).toBe(true);
  });

  it('tồn kho theo kho vẫn khớp tổng movement', () => {
    const totals = new Map<string, number>();
    for (const movement of db.stockMovement.getAll()) {
      const key = stockItemId(movement.productId, movement.warehouseId);
      totals.set(key, (totals.get(key) ?? 0) + movement.quantity);
    }
    for (const item of db.stockItem.getAll()) {
      expect(item.quantity).toBe(totals.get(item.id) ?? 0);
    }
  });
});
