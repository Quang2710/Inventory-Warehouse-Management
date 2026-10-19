import { drop } from '@mswjs/data';

import type {
  AuditLogPage,
  BinStockPage,
  Location,
  RoleDefinition,
  StocktakeCountResult,
  StocktakeLine,
  Transfer,
  WarehouseMap,
  WarehousePage,
} from '../../app/core/api/schema';
import { db, findById } from '../db';
import { availableQuantity, binQuantity } from '../domain/inventory';
import { seedDatabase } from '../seed';
import { call, tokenOf } from '../testing/mock-api';

const NOW = new Date('2026-10-18T10:00:00+07:00');

const warehouseId = (code: string) =>
  db.warehouse.findFirst({ where: { code: { equals: code } } })!.id;

/** Sản phẩm có đủ tồn ở kho để chuyển. */
function stockedProduct(warehouseCode: string, minimum = 20) {
  const id = warehouseId(warehouseCode);
  const item = db.stockItem
    .getAll()
    .find((stock) => stock.warehouseId === id && stock.quantity >= minimum)!;
  return { productId: item.productId, quantity: item.quantity };
}

describe('Giai đoạn 2 — handler nghiệp vụ', () => {
  let admin: string;
  let manager: string;
  let staff: string;
  let accountant: string;

  beforeEach(async () => {
    drop(db);
    seedDatabase(NOW);
    [admin, manager, staff, accountant] = await Promise.all([
      tokenOf('admin'),
      tokenOf('quanly'),
      tokenOf('nhanvien'),
      tokenOf('ketoan'),
    ]);
  });

  describe('chuyển kho', () => {
    it('vòng đời DRAFT → IN_TRANSIT (trừ kho đi) → RECEIVED (cộng kho đến, ghi nhận nhận thiếu)', async () => {
      const from = warehouseId('HN01');
      const to = warehouseId('HCM01');
      const { productId } = stockedProduct('HN01');
      const fromBefore = availableQuantity(productId, from);
      const toBefore = availableQuantity(productId, to);

      const created = await call<Transfer>('POST', '/transfers', {
        token: manager,
        body: {
          fromWarehouseId: from,
          toWarehouseId: to,
          transferDate: '2026-10-18',
          lines: [{ productId, quantity: 10 }],
        },
      });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('DRAFT');
      expect(created.body.code).toMatch(/^CK-\d{6}-\d{4}$/);

      const shipped = await call<Transfer>('POST', `/transfers/${created.body.id}/ship`, {
        token: manager,
      });
      expect(shipped.body.status).toBe('IN_TRANSIT');
      expect(shipped.body.lines[0].picks.reduce((sum, pick) => sum + pick.quantity, 0)).toBe(10);
      expect(availableQuantity(productId, from)).toBe(fromBefore - 10);
      expect(availableQuantity(productId, to)).toBe(toBefore);

      const bin = db.location
        .getAll()
        .find((location) => location.warehouseId === to && location.type === 'BIN')!;
      const received = await call<Transfer>('POST', `/transfers/${created.body.id}/receive`, {
        token: manager,
        body: {
          lines: [{ lineId: shipped.body.lines[0].id, receivedQuantity: 8, toLocationId: bin.id }],
          note: 'Vỡ 2',
        },
      });
      expect(received.body.status).toBe('RECEIVED');
      expect(received.body.receivedQuantity).toBe(8);
      expect(received.body.lines[0].toLocationCode).toBe(bin.code);
      expect(availableQuantity(productId, to)).toBe(toBefore + 8);
      expect(binQuantity(productId, bin.id)).toBeGreaterThanOrEqual(8);
    });

    it('xuất đi vượt tồn → 422 INSUFFICIENT_STOCK theo dòng, không trừ tồn', async () => {
      const from = warehouseId('HN01');
      const { productId, quantity } = stockedProduct('HN01');
      const created = await call<Transfer>('POST', '/transfers', {
        token: manager,
        body: {
          fromWarehouseId: from,
          toWarehouseId: warehouseId('DN01'),
          transferDate: '2026-10-18',
          lines: [{ productId, quantity: quantity + 1 }],
        },
      });
      const shipped = await call('POST', `/transfers/${created.body.id}/ship`, { token: manager });
      expect(shipped.status).toBe(422);
      expect(shipped.body['code']).toBe('INSUFFICIENT_STOCK');
      expect(shipped.body['details']).toHaveProperty(['lines.0.quantity']);
      expect(availableQuantity(productId, from)).toBe(quantity);
    });

    it('hủy phiếu đang vận chuyển hoàn hàng về đúng ô đã lấy', async () => {
      const from = warehouseId('HN01');
      const { productId } = stockedProduct('HN01');
      const before = db.binStock
        .getAll()
        .filter((bin) => bin.productId === productId && bin.warehouseId === from)
        .map((bin) => [bin.locationId, bin.quantity]);
      const created = await call<Transfer>('POST', '/transfers', {
        token: manager,
        body: {
          fromWarehouseId: from,
          toWarehouseId: warehouseId('DN01'),
          transferDate: '2026-10-18',
          lines: [{ productId, quantity: 5 }],
        },
      });
      await call('POST', `/transfers/${created.body.id}/ship`, { token: manager });
      const cancelled = await call<Transfer>('POST', `/transfers/${created.body.id}/cancel`, {
        token: manager,
        body: { reason: 'Đổi kế hoạch' },
      });
      expect(cancelled.body.status).toBe('CANCELLED');
      const after = db.binStock
        .getAll()
        .filter((bin) => bin.productId === productId && bin.warehouseId === from)
        .map((bin) => [bin.locationId, bin.quantity]);
      expect(new Map(after as [string, number][])).toEqual(new Map(before as [string, number][]));
    });

    it('validate: kho đi = kho đến, dòng trùng sản phẩm', async () => {
      const from = warehouseId('HN01');
      const { productId } = stockedProduct('HN01');
      const result = await call('POST', '/transfers', {
        token: manager,
        body: {
          fromWarehouseId: from,
          toWarehouseId: from,
          transferDate: '2026-10-18',
          lines: [
            { productId, quantity: 1 },
            { productId, quantity: 2 },
          ],
        },
      });
      expect(result.status).toBe(422);
      expect(Object.keys(result.body['details'] as object)).toEqual(
        expect.arrayContaining(['toWarehouseId', 'lines.1.productId']),
      );
    });

    it('phạm vi kho: nhân viên kho Hà Nội không tạo được phiếu xuất từ kho khác', async () => {
      const { productId } = stockedProduct('HCM01');
      const result = await call('POST', '/transfers', {
        token: staff,
        body: {
          fromWarehouseId: warehouseId('HCM01'),
          toWarehouseId: warehouseId('HN01'),
          transferDate: '2026-10-18',
          lines: [{ productId, quantity: 1 }],
        },
      });
      expect(result.status).toBe(403);
    });
  });

  describe('kiểm kê', () => {
    it('đếm offline: gửi lại cùng clientId không nhân đôi; số đếm cũ hơn bị bỏ qua (STALE); duyệt sinh điều chỉnh', async () => {
      const zone = db.location
        .getAll()
        .find((location) => location.warehouseId === warehouseId('DN01') && location.code === 'B')!;
      const created = await call<{ id: string; lineCount: number; status: string }>(
        'POST',
        '/stocktakes',
        {
          token: manager,
          body: {
            warehouseId: warehouseId('DN01'),
            name: 'Test khu B',
            zoneIds: [zone.id],
            blind: false,
          },
        },
      );
      expect(created.status).toBe(201);
      expect(created.body.lineCount).toBeGreaterThan(0);
      const lines = (
        await call<StocktakeLine[]>('GET', `/stocktakes/${created.body.id}/lines`, {
          token: manager,
        })
      ).body;
      const line = lines[0];
      const counted = line.expectedQuantity! + 2;

      const entry = {
        clientId: 'device-a-1',
        lineId: line.id,
        countedQuantity: counted,
        countedAt: '2026-10-18T03:10:00Z',
      };
      const first = await call<StocktakeCountResult>(
        'POST',
        `/stocktakes/${created.body.id}/counts`,
        { token: manager, body: { entries: [entry] } },
      );
      const replay = await call<StocktakeCountResult>(
        'POST',
        `/stocktakes/${created.body.id}/counts`,
        { token: manager, body: { entries: [entry] } },
      );
      expect(first.body.applied).toHaveLength(1);
      expect(replay.body.applied[0].line.countedQuantity).toBe(counted);

      const stale = await call<StocktakeCountResult>(
        'POST',
        `/stocktakes/${created.body.id}/counts`,
        {
          token: manager,
          body: {
            entries: [
              {
                clientId: 'device-b-1',
                lineId: line.id,
                countedQuantity: 0,
                countedAt: '2026-10-18T03:00:00Z',
              },
            ],
          },
        },
      );
      expect(stale.body.skipped[0].reason).toBe('STALE');
      expect(stale.body.skipped[0].line?.countedQuantity).toBe(counted);

      expect(
        (await call('POST', `/stocktakes/${created.body.id}/approve`, { token: manager })).status,
      ).toBe(409);
      expect(
        (await call('POST', `/stocktakes/${created.body.id}/submit`, { token: manager })).status,
      ).toBe(200);
      const before = binQuantity(line.productId, line.locationId);
      const approved = await call<{ status: string }>(
        'POST',
        `/stocktakes/${created.body.id}/approve`,
        { token: manager },
      );
      expect(approved.body.status).toBe('COMPLETED');
      expect(binQuantity(line.productId, line.locationId)).toBe(before + 2);
    });

    it('phiên đếm mù: người đếm không thấy số tồn hệ thống, người duyệt thấy', async () => {
      const created = await call<{ id: string }>('POST', '/stocktakes', {
        token: manager,
        body: {
          warehouseId: warehouseId('HN01'),
          name: 'Đếm mù khu C',
          zoneIds: [
            db.location
              .getAll()
              .find((l) => l.warehouseId === warehouseId('HN01') && l.code === 'C')!.id,
          ],
          blind: true,
        },
      });
      const forStaff = await call<StocktakeLine[]>('GET', `/stocktakes/${created.body.id}/lines`, {
        token: staff,
      });
      const forManager = await call<StocktakeLine[]>(
        'GET',
        `/stocktakes/${created.body.id}/lines`,
        { token: manager },
      );
      expect(forStaff.body.every((line) => line.expectedQuantity === null)).toBe(true);
      expect(forManager.body.every((line) => line.expectedQuantity !== null)).toBe(true);
    });

    it('không mở hai phiên trùng phạm vi', async () => {
      const result = await call('POST', '/stocktakes', {
        token: manager,
        body: { warehouseId: warehouseId('HN01'), name: 'Toàn kho', zoneIds: [], blind: false },
      });
      expect(result.status).toBe(409);
    });
  });

  describe('phân quyền', () => {
    it('Admin bỏ quyền của vai trò → có hiệu lực ngay với API và /auth/me; không sửa được ADMIN', async () => {
      expect((await call('GET', '/suppliers', { token: staff })).status).toBe(200);
      const roles = (await call<RoleDefinition[]>('GET', '/roles', { token: admin })).body;
      const staffRole = roles.find((role) => role.role === 'WAREHOUSE_STAFF')!;
      const next = staffRole.permissions.filter((permission) => permission !== 'supplier:read');
      const updated = await call<RoleDefinition>('PUT', '/roles/WAREHOUSE_STAFF/permissions', {
        token: admin,
        body: { permissions: next },
      });
      expect(updated.body.permissions).not.toContain('supplier:read');
      expect((await call('GET', '/suppliers', { token: staff })).status).toBe(403);
      const me = await call<{ permissions: string[] }>('GET', '/auth/me', { token: staff });
      expect(me.body.permissions).not.toContain('supplier:read');

      expect(
        (await call('PUT', '/roles/ADMIN/permissions', { token: admin, body: { permissions: [] } }))
          .status,
      ).toBe(409);
      expect(
        (
          await call('PUT', '/roles/WAREHOUSE_STAFF/permissions', {
            token: manager,
            body: { permissions: [] },
          })
        ).status,
      ).toBe(403);
    });

    it('phạm vi kho áp dụng cho danh sách kho và sơ đồ', async () => {
      const list = await call<WarehousePage>('GET', '/warehouses', { token: staff });
      expect(list.body.items.map((warehouse) => warehouse.code)).toEqual(['HN01']);
      expect(
        (await call('GET', `/warehouses/${warehouseId('HCM01')}/map`, { token: staff })).status,
      ).toBe(403);
    });
  });

  describe('kho, vị trí, sơ đồ', () => {
    it('sơ đồ kho có khu › kệ › tầng › ô, tổng tồn khớp tồn theo ô', async () => {
      const id = warehouseId('HN01');
      const map = (await call<WarehouseMap>('GET', `/warehouses/${id}/map`, { token: manager }))
        .body;
      expect(map.zones.map((zone) => zone.code)).toEqual(['A', 'B', 'C']);
      const bins = map.zones.flatMap((zone) =>
        zone.racks.flatMap((rack) => rack.levels.flatMap((level) => level.bins)),
      );
      expect(bins).toHaveLength(map.binCount);
      expect(map.quantity).toBe(
        db.binStock
          .getAll()
          .filter((bin) => bin.warehouseId === id)
          .reduce((sum, bin) => sum + bin.quantity, 0),
      );
      const binStock = await call<BinStockPage>(
        'GET',
        `/stock/bins?locationId=${map.zones[0].id}&size=200`,
        { token: manager },
      );
      expect(binStock.body.items.reduce((sum, item) => sum + item.quantity, 0)).toBe(
        map.zones[0].quantity,
      );
    });

    it('tạo nhanh kệ, không xóa được vị trí còn hàng hoặc còn vị trí con', async () => {
      const id = warehouseId('DN01');
      const zone = db.location
        .getAll()
        .find((location) => location.warehouseId === id && location.type === 'ZONE')!;
      const created = await call<Location[]>('POST', `/warehouses/${id}/locations/generate`, {
        token: manager,
        body: { zoneId: zone.id, rackCode: 'A-09', levels: 2, binsPerLevel: 3, binCapacity: 300 },
      });
      expect(created.status).toBe(201);
      expect(created.body.filter((location) => location.type === 'BIN')).toHaveLength(6);
      expect((await call('DELETE', `/locations/${zone.id}`, { token: manager })).status).toBe(409);
      const stocked = db.binStock.getAll().find((bin) => bin.warehouseId === id)!;
      expect(
        (await call('DELETE', `/locations/${stocked.locationId}`, { token: manager })).status,
      ).toBe(409);
      const emptyBin = created.body.find((location) => location.type === 'BIN')!;
      expect((await call('DELETE', `/locations/${emptyBin.id}`, { token: manager })).status).toBe(
        204,
      );
    });
  });

  describe('đối tác & nhật ký', () => {
    it('mã nhà cung cấp trùng → 422; NCC đã có phiếu nhập không xóa được (409)', async () => {
      const existing = db.supplier.getAll()[0];
      const duplicate = await call('POST', '/suppliers', {
        token: accountant,
        body: { code: existing.code, name: 'Trùng mã', paymentTermDays: 30, status: 'ACTIVE' },
      });
      expect(duplicate.status).toBe(422);
      expect(duplicate.body['details']).toHaveProperty('code');
      expect(
        (await call('DELETE', `/suppliers/${existing.id}`, { token: accountant })).status,
      ).toBe(409);
      expect((await call('POST', '/suppliers', { token: staff, body: {} })).status).toBe(403);
    });

    it('mỗi thao tác ghi đều có nhật ký kèm diff trước/sau', async () => {
      const customer = db.customer.getAll()[3];
      await call('PUT', `/customers/${customer.id}`, {
        token: accountant,
        body: {
          code: customer.code,
          name: `${customer.name} (mới)`,
          type: customer.type,
          status: 'ACTIVE',
        },
      });
      const logs = await call<AuditLogPage>('GET', `/audit-logs?entityId=${customer.id}`, {
        token: admin,
      });
      const entry = logs.body.items[0];
      expect(entry.action).toBe('UPDATE');
      expect(entry.userName).toBe('Phạm Thu Dung');
      expect(entry.changes).toContainEqual({
        field: 'name',
        from: customer.name,
        to: `${customer.name} (mới)`,
      });
      expect((await call('GET', '/audit-logs', { token: staff })).status).toBe(403);
      expect(findById('customer', customer.id)?.name).toBe(`${customer.name} (mới)`);
    });
  });
});
