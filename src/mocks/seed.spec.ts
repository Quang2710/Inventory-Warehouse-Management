import { drop } from '@mswjs/data';

import { db, findById } from './db';
import {
  InsufficientStockError,
  postMovements,
  stockItemId,
  stockStatusOf,
} from './domain/inventory';
import { createSnapshot, restoreSnapshot } from './persistence';
import { seedDatabase, type SeedSummary } from './seed';

const NOW = new Date('2026-10-18T10:00:00+07:00');

function movementKey(movement: { productId: string; warehouseId: string }): string {
  return stockItemId(movement.productId, movement.warehouseId);
}

describe('seedDatabase', () => {
  let summary: SeedSummary;

  beforeAll(() => {
    drop(db);
    summary = seedDatabase(NOW);
  });

  it('sinh đúng quy mô dữ liệu demo', () => {
    expect(summary.products).toBe(200);
    expect(summary.warehouses).toBe(3);
    expect(summary.categories).toBe(20);
    expect(summary.users).toBe(12);
    expect(summary.suppliers).toBe(12);
    expect(summary.customers).toBe(21);
    expect(summary.locations).toBeGreaterThan(400);
    expect(summary.goodsReceipts + summary.goodsIssues).toBeGreaterThanOrEqual(300);
    expect(summary.transfers).toBeGreaterThanOrEqual(20);
    expect(summary.stocktakes).toBe(4);
    expect(summary.stockMovements).toBeGreaterThan(1000);
    expect(summary.auditLogs).toBeGreaterThan(500);
  });

  it('có 4 tài khoản demo, mỗi vai trò một tài khoản; nhân viên kho demo chỉ ở kho Hà Nội', () => {
    const byName = (username: string) =>
      db.user.findFirst({ where: { username: { equals: username } } })!;
    const roles = ['admin', 'quanly', 'nhanvien', 'ketoan'].map(
      (username) => byName(username).role,
    );
    expect(new Set(roles)).toEqual(
      new Set(['ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_STAFF', 'ACCOUNTANT']),
    );
    const hanoi = db.warehouse.findFirst({ where: { code: { equals: 'HN01' } } })!;
    expect(byName('nhanvien').warehouseIds).toEqual([hanoi.id]);
    expect(byName('quanly').warehouseIds).toEqual([]);
  });

  it('tồn kho = tổng StockMovement và không bao giờ âm', () => {
    const totals = new Map<string, number>();
    for (const movement of db.stockMovement.getAll()) {
      const key = movementKey(movement);
      totals.set(key, (totals.get(key) ?? 0) + movement.quantity);
    }
    const items = db.stockItem.getAll();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.quantity).toBeGreaterThanOrEqual(0);
      expect(item.quantity).toBe(totals.get(item.id) ?? 0);
    }
  });

  it('mọi movement gắn ô; tổng tồn các ô = tồn của kho; tồn ô không âm', () => {
    const byWarehouse = new Map<string, number>();
    for (const bin of db.binStock.getAll()) {
      expect(bin.quantity).toBeGreaterThan(0);
      const location = findById('location', bin.locationId)!;
      expect(location.type).toBe('BIN');
      expect(location.warehouseId).toBe(bin.warehouseId);
      const key = stockItemId(bin.productId, bin.warehouseId);
      byWarehouse.set(key, (byWarehouse.get(key) ?? 0) + bin.quantity);
    }
    for (const item of db.stockItem.getAll()) {
      expect(byWarehouse.get(item.id) ?? 0).toBe(item.quantity);
    }
    expect(db.stockMovement.getAll().every((movement) => movement.locationId !== null)).toBe(true);
  });

  it('balanceAfter là số dư lũy kế theo đúng thứ tự thời gian', () => {
    const running = new Map<string, number>();
    const lastAt = new Map<string, string>();
    for (const movement of db.stockMovement.getAll()) {
      const key = movementKey(movement);
      const balance = (running.get(key) ?? 0) + movement.quantity;
      running.set(key, balance);
      expect(movement.balanceAfter).toBe(balance);
      expect(movement.balanceAfter).toBeGreaterThanOrEqual(0);
      expect(movement.occurredAt >= (lastAt.get(key) ?? '')).toBe(true);
      lastAt.set(key, movement.occurredAt);
    }
  });

  it('chỉ chứng từ đã duyệt (hoặc đã hủy sau duyệt) mới sinh movement', () => {
    const documentIds = new Set(db.stockMovement.getAll().map((movement) => movement.documentId));
    for (const receipt of db.goodsReceipt.getAll()) {
      const posted = receipt.status === 'APPROVED' || receipt.status === 'CANCELLED';
      expect(documentIds.has(receipt.id)).toBe(posted);
    }
    for (const transfer of db.transfer.getAll()) {
      expect(documentIds.has(transfer.id)).toBe(transfer.status !== 'DRAFT');
    }
  });

  it('chuyển kho: hàng đang đi đường = số đã xuất; phiếu đã nhận cộng đúng số nhận ở kho đến', () => {
    const statuses = new Set(db.transfer.getAll().map((transfer) => transfer.status));
    expect(statuses.has('RECEIVED')).toBe(true);
    expect(statuses.has('IN_TRANSIT')).toBe(true);
    for (const transfer of db.transfer.getAll()) {
      const movements = db.stockMovement
        .getAll()
        .filter((movement) => movement.documentId === transfer.id);
      const shipped = movements
        .filter((movement) => movement.type === 'TRANSFER_OUT')
        .reduce((sum, movement) => sum - movement.quantity, 0);
      const inbound = movements.filter((movement) => movement.type === 'TRANSFER_IN');
      const lines = db.transferLine.getAll().filter((line) => line.transferId === transfer.id);
      if (transfer.status === 'IN_TRANSIT') {
        expect(shipped).toBe(lines.reduce((sum, line) => sum + line.quantity, 0));
        expect(inbound).toHaveLength(0);
      }
      if (transfer.status === 'RECEIVED') {
        expect(inbound.reduce((sum, movement) => sum + movement.quantity, 0)).toBe(
          lines.reduce((sum, line) => sum + (line.receivedQuantity ?? 0), 0),
        );
        expect(inbound.every((movement) => movement.warehouseId === transfer.toWarehouseId)).toBe(
          true,
        );
      }
    }
  });

  it('kiểm kê: đủ trạng thái; phiên hoàn tất sinh bút toán điều chỉnh đúng chênh lệch', () => {
    const stocktakes = db.stocktake.getAll();
    expect(new Set(stocktakes.map((item) => item.status))).toEqual(
      new Set(['COMPLETED', 'SUBMITTED', 'IN_PROGRESS']),
    );
    for (const stocktake of stocktakes.filter((item) => item.status === 'COMPLETED')) {
      const adjusted = db.stockMovement
        .getAll()
        .filter(
          (movement) => movement.documentId === stocktake.id && movement.type === 'ADJUSTMENT',
        )
        .reduce((sum, movement) => sum + movement.quantity, 0);
      const variance = db.stocktakeLine
        .getAll()
        .filter((line) => line.stocktakeId === stocktake.id && line.countedQuantity !== null)
        .reduce((sum, line) => sum + line.countedQuantity! - line.systemQuantityAtCount!, 0);
      expect(adjusted).toBe(variance);
    }
    const inProgress = stocktakes.find((item) => item.status === 'IN_PROGRESS')!;
    const lines = db.stocktakeLine.getAll().filter((line) => line.stocktakeId === inProgress.id);
    const counted = lines.filter((line) => line.countedQuantity !== null).length;
    expect(counted).toBeGreaterThan(0);
    expect(counted).toBeLessThan(lines.length);
  });

  it('có đủ trạng thái chứng từ và tình huống tồn thấp để demo', () => {
    const statuses = new Set(
      [...db.goodsReceipt.getAll(), ...db.goodsIssue.getAll()].map((document) => document.status),
    );
    expect(statuses).toEqual(new Set(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']));
    const lowOrOut = db.stockItem
      .getAll()
      .filter(
        (item) =>
          stockStatusOf(item.quantity, findById('product', item.productId)!.minStock) !==
          'IN_STOCK',
      );
    expect(lowOrOut.length).toBeGreaterThan(0);
  });

  it('mã chứng từ không trùng', () => {
    const codes = [
      ...db.goodsReceipt.getAll(),
      ...db.goodsIssue.getAll(),
      ...db.transfer.getAll(),
      ...db.stocktake.getAll(),
    ].map((document) => document.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('tất định: cùng seed + cùng thời điểm → cùng dữ liệu', () => {
    const fingerprint = () =>
      db.product
        .getAll()
        .slice(0, 20)
        .map((product) => `${product.id}|${product.sku}|${product.name}|${product.costPrice}`)
        .join(';') + `#${db.stockMovement.count()}#${db.transfer.count()}#${db.auditLog.count()}`;
    const first = fingerprint();
    drop(db);
    seedDatabase(NOW);
    expect(fingerprint()).toBe(first);
  });

  it('snapshot → restore giữ nguyên dữ liệu, quan hệ và mảng giá trị', () => {
    const before = createSnapshot();
    const product = db.product.getAll()[10];
    const staff = db.user.findFirst({ where: { username: { equals: 'nhanvien' } } })!;

    restoreSnapshot(JSON.parse(JSON.stringify(before)));

    expect(createSnapshot().models).toEqual(before.models);
    expect(findById('product', product.id)?.category?.name).toBe(product.category?.name);
    expect(findById('user', staff.id)?.warehouseIds).toEqual(staff.warehouseIds);
    expect(findById('roleDefinition', 'WAREHOUSE_STAFF')?.permissions.length).toBeGreaterThan(5);
    expect(db.category.getAll().find((category) => category.parent)?.parent?.code).toBeTruthy();
  });
});

describe('postMovements', () => {
  beforeEach(() => {
    drop(db);
    seedDatabase(NOW);
  });

  it('chặn tồn âm ở cấp ô và không ghi gì khi một dòng thiếu hàng (all-or-nothing)', () => {
    const bin = db.binStock.getAll().find((item) => item.quantity > 1)!;
    const product = findById('product', bin.productId)!;
    const warehouse = findById('warehouse', bin.warehouseId)!;
    const user = db.user.findFirst({ where: { username: { equals: 'quanly' } } })!;
    const movementCount = db.stockMovement.count();
    const base = {
      product,
      warehouse,
      locationId: bin.locationId,
      unitCost: 1000,
      type: 'ISSUE' as const,
      documentType: 'GOODS_ISSUE' as const,
      documentId: 'test',
      documentCode: 'PX-TEST',
      occurredAt: NOW.toISOString(),
      createdById: user.id,
    };

    expect(() =>
      postMovements([
        { ...base, quantity: -1 },
        { ...base, quantity: -bin.quantity },
      ]),
    ).toThrow(InsufficientStockError);
    expect(db.stockMovement.count()).toBe(movementCount);
    expect(findById('binStock', bin.id)?.quantity).toBe(bin.quantity);

    postMovements([{ ...base, quantity: -bin.quantity }]);
    expect(findById('binStock', bin.id)).toBeNull();
  });

  it('nhập kho cập nhật giá vốn bình quân gia quyền', () => {
    const item = db.stockItem.getAll().find((stock) => stock.quantity > 0)!;
    const product = findById('product', item.productId)!;
    const warehouse = findById('warehouse', item.warehouseId)!;
    const locationId = db.binStock
      .getAll()
      .find(
        (bin) => bin.productId === item.productId && bin.warehouseId === item.warehouseId,
      )!.locationId;
    const user = db.user.findFirst({ where: { username: { equals: 'quanly' } } })!;
    const incomingCost = item.averageCost * 2;

    postMovements([
      {
        product,
        warehouse,
        locationId,
        quantity: item.quantity,
        unitCost: incomingCost,
        type: 'RECEIPT',
        documentType: 'GOODS_RECEIPT',
        documentId: 'test',
        documentCode: 'PN-TEST',
        occurredAt: NOW.toISOString(),
        createdById: user.id,
      },
    ]);

    const updated = findById('stockItem', item.id)!;
    expect(updated.quantity).toBe(item.quantity * 2);
    expect(updated.averageCost).toBe(Math.round((item.averageCost + incomingCost) / 2));
  });
});
