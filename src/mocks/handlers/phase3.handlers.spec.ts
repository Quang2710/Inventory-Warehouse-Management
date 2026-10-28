import { drop } from '@mswjs/data';

import type {
  AbcReport,
  AlertPage,
  AlertSummary,
  AllocationPreview,
  ErrorResponse,
  GoodsIssue,
  GoodsReceipt,
  InventorySummaryPage,
  SerialUnit,
  StockCard,
  StockLotPage,
  Warehouse,
} from '../../app/core/api/schema';
import { db } from '../db';
import { availableQuantity } from '../domain/inventory';
import { seedDatabase } from '../seed';
import { call, tokenOf } from '../testing/mock-api';
import { addLocalDays, toLocalDate } from '../utils/date';

const NOW = new Date('2026-10-18T10:00:00+07:00');
/** Nghiệp vụ hạn dùng so với ngày thật lúc chạy test → mọi ngày tính tương đối hôm nay. */
const today = toLocalDate(new Date());
const day = (offset: number) => addLocalDays(today, offset);

const lotProduct = () =>
  db.product.getAll().find((p) => p.trackLot && p.trackExpiry && p.status === 'ACTIVE')!;
const serialProduct = () =>
  db.product.getAll().find((p) => p.trackSerial && p.status === 'ACTIVE')!;

describe('Giai đoạn 3 — lô/HSD/serial, FEFO, cảnh báo, báo cáo', () => {
  let manager: string;
  let staff: string;
  let warehouseId: string;

  /** Tạo → gửi duyệt → duyệt một phiếu nhập; trả phiếu đã duyệt. */
  async function receive(
    lines: Record<string, unknown>[],
    receiptDate = day(-60),
  ): Promise<GoodsReceipt> {
    const created = await call<GoodsReceipt>('POST', '/goods-receipts', {
      token: manager,
      body: { warehouseId, supplierName: 'NCC kiểm thử', receiptDate, lines },
    });
    expect(created.status).toBe(201);
    await call('POST', `/goods-receipts/${created.body.id}/submit`, { token: manager });
    const approved = await call<GoodsReceipt>(
      'POST',
      `/goods-receipts/${created.body.id}/approve`,
      { token: manager },
    );
    expect(approved.status).toBe(200);
    return approved.body;
  }

  async function createIssue(lines: Record<string, unknown>[], reason = 'SALE') {
    return call<GoodsIssue | ErrorResponse>('POST', '/goods-issues', {
      token: manager,
      body: { warehouseId, customerName: 'Khách lẻ', reason, issueDate: today, lines },
    });
  }

  beforeEach(async () => {
    drop(db);
    seedDatabase(NOW);
    [manager, staff] = await Promise.all([tokenOf('quanly'), tokenOf('nhanvien')]);
    // Kho mới chưa khai báo vị trí → tồn không gắn ô, kiểm tra được FEFO thuần theo lô.
    const created = await call<Warehouse>('POST', '/warehouses', {
      token: manager,
      body: { code: 'TEST01', name: 'Kho kiểm thử', address: 'Hà Nội', status: 'ACTIVE' },
    });
    warehouseId = created.body.id;
  });

  describe('phiếu nhập', () => {
    it('bắt buộc lô / HSD hợp lệ theo cấu hình sản phẩm', async () => {
      const product = lotProduct();
      const result = await call<ErrorResponse>('POST', '/goods-receipts', {
        token: manager,
        body: {
          warehouseId,
          supplierName: 'NCC',
          receiptDate: day(-1),
          lines: [{ productId: product.id, quantity: 5, unitCost: 1000, expiryDate: day(-2) }],
        },
      });
      expect(result.status).toBe(422);
      expect(result.body.details?.['lines.0.lotNumber']).toBeDefined();
      expect(result.body.details?.['lines.0.expiryDate']?.[0]).toContain('sau ngày nhập');
    });

    it('duyệt cộng tồn theo lô; nhân viên không được duyệt', async () => {
      const product = lotProduct();
      const created = await call<GoodsReceipt>('POST', '/goods-receipts', {
        token: staff,
        body: {
          warehouseId: db.warehouse.findFirst({ where: { code: { equals: 'HN01' } } })!.id,
          supplierName: 'NCC',
          receiptDate: today,
          lines: [
            {
              productId: product.id,
              quantity: 7,
              unitCost: 1000,
              lotNumber: 'T-1',
              expiryDate: day(90),
            },
          ],
        },
      });
      expect(created.status).toBe(201);
      await call('POST', `/goods-receipts/${created.body.id}/submit`, { token: staff });
      const denied = await call('POST', `/goods-receipts/${created.body.id}/approve`, {
        token: staff,
      });
      expect(denied.status).toBe(403);

      const approved = await call<GoodsReceipt>(
        'POST',
        `/goods-receipts/${created.body.id}/approve`,
        { token: manager },
      );
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.lines[0].locationCode).toBeTruthy();
      const lots = await call<StockLotPage>('GET', `/stock/lots?productId=${product.id}&q=T-1`, {
        token: manager,
      });
      expect(lots.body.items.map((lot) => [lot.lotNumber, lot.quantity])).toEqual([['T-1', 7]]);
    });
  });

  describe('phiếu xuất theo FEFO', () => {
    async function seedLots() {
      const product = lotProduct();
      await receive([
        {
          productId: product.id,
          quantity: 10,
          unitCost: 1000,
          lotNumber: 'VALID',
          expiryDate: day(200),
        },
        {
          productId: product.id,
          quantity: 5,
          unitCost: 1000,
          lotNumber: 'SOON',
          expiryDate: day(10),
        },
        {
          productId: product.id,
          quantity: 5,
          unitCost: 1000,
          lotNumber: 'OLD',
          expiryDate: day(-10),
        },
      ]);
      return product;
    }

    it('gợi ý lấy lô sắp hết hạn trước và loại lô đã hết hạn', async () => {
      const product = await seedLots();
      const preview = await call<AllocationPreview>('POST', '/goods-issues/allocation-preview', {
        token: manager,
        body: { warehouseId, reason: 'SALE', lines: [{ productId: product.id, quantity: 8 }] },
      });
      expect(preview.status).toBe(200);
      const [line] = preview.body.lines;
      expect(line.picks.map((pick) => [pick.lotNumber, pick.quantity])).toEqual([
        ['SOON', 5],
        ['VALID', 3],
      ]);
      expect(line.available).toBe(15);
      expect(line.expiredExcluded).toBe(5);
      expect(line.shortage).toBe(0);
    });

    it('duyệt trừ đúng lô, hủy hoàn về đúng lô', async () => {
      const product = await seedLots();
      const created = (await createIssue([{ productId: product.id, quantity: 8, unitPrice: 2000 }]))
        .body as GoodsIssue;
      await call('POST', `/goods-issues/${created.id}/submit`, { token: manager });
      const approved = await call<GoodsIssue>('POST', `/goods-issues/${created.id}/approve`, {
        token: manager,
      });
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.lines[0].unitCost).toBe(1000);
      expect(approved.body.lines[0].picks.map((pick) => pick.lotNumber)).toEqual(['SOON', 'VALID']);
      expect(availableQuantity(product.id, warehouseId)).toBe(12);

      const cancelled = await call<GoodsIssue>('POST', `/goods-issues/${created.id}/cancel`, {
        token: manager,
        body: { reason: 'Khách trả đơn' },
      });
      expect(cancelled.body.status).toBe('CANCELLED');
      const lots = await call<StockLotPage>(
        'GET',
        `/stock/lots?warehouseId=${warehouseId}&productId=${product.id}&sort=lotNumber,asc`,
        { token: manager },
      );
      expect(lots.body.items.map((lot) => [lot.lotNumber, lot.quantity])).toEqual([
        ['OLD', 5],
        ['SOON', 5],
        ['VALID', 10],
      ]);
    });

    it('không đủ tồn còn hạn → 422 khi gửi duyệt; xuất hủy lấy lô hết hạn trước', async () => {
      const product = await seedLots();
      const tooMany = (await createIssue([{ productId: product.id, quantity: 18, unitPrice: 0 }]))
        .body as GoodsIssue;
      const submit = await call<ErrorResponse>('POST', `/goods-issues/${tooMany.id}/submit`, {
        token: manager,
      });
      expect(submit.status).toBe(422);
      expect(submit.body.code).toBe('INSUFFICIENT_STOCK');
      expect(submit.body.details?.['lines.0.quantity']?.[0]).toContain('lô hết hạn');

      const damaged = (
        await createIssue([{ productId: product.id, quantity: 5, unitPrice: 0 }], 'DAMAGED')
      ).body as GoodsIssue;
      await call('POST', `/goods-issues/${damaged.id}/submit`, { token: manager });
      const approved = await call<GoodsIssue>('POST', `/goods-issues/${damaged.id}/approve`, {
        token: manager,
      });
      expect(approved.body.lines[0].picks).toEqual([
        expect.objectContaining({ lotNumber: 'OLD', quantity: 5 }),
      ]);
    });

    it('không hủy được phiếu nhập khi hàng của lô đã được xuất', async () => {
      const product = lotProduct();
      const receipt = await receive([
        {
          productId: product.id,
          quantity: 4,
          unitCost: 1000,
          lotNumber: 'ONE',
          expiryDate: day(100),
        },
      ]);
      const issue = (await createIssue([{ productId: product.id, quantity: 3, unitPrice: 0 }]))
        .body as GoodsIssue;
      await call('POST', `/goods-issues/${issue.id}/submit`, { token: manager });
      await call('POST', `/goods-issues/${issue.id}/approve`, { token: manager });

      const cancel = await call<ErrorResponse>('POST', `/goods-receipts/${receipt.id}/cancel`, {
        token: manager,
        body: { reason: 'Nhập nhầm' },
      });
      expect(cancel.status).toBe(422);
      expect(cancel.body.code).toBe('INSUFFICIENT_STOCK');
      expect(availableQuantity(product.id, warehouseId)).toBe(1);
    });
  });

  describe('serial', () => {
    it('nhập đủ serial, chặn serial trùng, xuất serial chỉ định', async () => {
      const product = serialProduct();
      const missing = await call<ErrorResponse>('POST', '/goods-receipts', {
        token: manager,
        body: {
          warehouseId,
          supplierName: 'NCC',
          receiptDate: today,
          lines: [{ productId: product.id, quantity: 2, unitCost: 5000, serialNumbers: ['X-1'] }],
        },
      });
      expect(missing.status).toBe(422);
      expect(missing.body.details?.['lines.0.serialNumbers']).toBeDefined();

      await receive(
        [
          {
            productId: product.id,
            quantity: 3,
            unitCost: 5000,
            serialNumbers: ['T-A', 'T-B', 'T-C'],
          },
        ],
        today,
      );
      const duplicate = await call<ErrorResponse>('POST', '/goods-receipts', {
        token: manager,
        body: {
          warehouseId,
          supplierName: 'NCC',
          receiptDate: today,
          lines: [{ productId: product.id, quantity: 1, unitCost: 5000, serialNumbers: ['T-B'] }],
        },
      });
      expect(duplicate.status).toBe(422);

      const issue = (
        await createIssue([
          { productId: product.id, quantity: 1, unitPrice: 9000, serialNumbers: ['T-C'] },
        ])
      ).body as GoodsIssue;
      await call('POST', `/goods-issues/${issue.id}/submit`, { token: manager });
      const approved = await call<GoodsIssue>('POST', `/goods-issues/${issue.id}/approve`, {
        token: manager,
      });
      expect(approved.body.lines[0].picks[0].serialNumbers).toEqual(['T-C']);
      const serial = await call<SerialUnit>('GET', '/serials/T-C', { token: manager });
      expect(serial.body.status).toBe('ISSUED');
      expect(serial.body.lastDocumentCode).toBe(approved.body.code);
      const stillIn = await call<SerialUnit>('GET', '/serials/T-A', { token: manager });
      expect(stillIn.body.status).toBe('IN_STOCK');
    });
  });

  describe('cảnh báo & báo cáo', () => {
    it('cảnh báo lô đã hết hạn / sắp hết hạn theo kho', async () => {
      const product = lotProduct();
      await receive([
        {
          productId: product.id,
          quantity: 5,
          unitCost: 1000,
          lotNumber: 'OLD',
          expiryDate: day(-3),
        },
        {
          productId: product.id,
          quantity: 5,
          unitCost: 1000,
          lotNumber: 'SOON',
          expiryDate: day(5),
        },
      ]);
      const alerts = await call<AlertPage>('GET', `/alerts?warehouseId=${warehouseId}&size=50`, {
        token: manager,
      });
      const types = alerts.body.items.map((alert) => [alert.type, alert.lotNumber]);
      expect(types).toContainEqual(['EXPIRED', 'OLD']);
      expect(types).toContainEqual(['EXPIRING', 'SOON']);
      expect(alerts.body.items[0].severity).toBe('CRITICAL');

      const summary = await call<AlertSummary>(
        'GET',
        `/alerts/summary?warehouseId=${warehouseId}`,
        {
          token: manager,
        },
      );
      expect(summary.body.expired).toBe(1);
      expect(summary.body.expiring).toBe(1);
    });

    it('thẻ kho và NXT khớp tồn hiện tại; ABC phủ 100% giá trị', async () => {
      const product = lotProduct();
      await receive([
        {
          productId: product.id,
          quantity: 9,
          unitCost: 1000,
          lotNumber: 'R1',
          expiryDate: day(100),
        },
      ]);
      const issue = (await createIssue([{ productId: product.id, quantity: 4, unitPrice: 0 }]))
        .body as GoodsIssue;
      await call('POST', `/goods-issues/${issue.id}/submit`, { token: manager });
      await call('POST', `/goods-issues/${issue.id}/approve`, { token: manager });

      const card = await call<StockCard>(
        'GET',
        `/reports/stock-card?productId=${product.id}&warehouseId=${warehouseId}&from=${day(-90)}&to=${today}`,
        { token: manager },
      );
      expect(card.body.openingQuantity).toBe(0);
      expect(card.body.inboundQuantity).toBe(9);
      expect(card.body.outboundQuantity).toBe(4);
      expect(card.body.closingQuantity).toBe(5);
      expect(card.body.entries.at(-1)?.balance).toBe(5);

      const nxt = await call<InventorySummaryPage>(
        'GET',
        `/reports/inventory-summary?from=${day(-30)}&to=${today}&size=200`,
        { token: manager },
      );
      const stockTotal = db.stockItem.getAll().reduce((sum, item) => sum + item.quantity, 0);
      expect(nxt.body.totals.closingQuantity).toBe(stockTotal);

      const abc = await call<AbcReport>(
        'GET',
        `/reports/abc?from=${day(-90)}&to=${today}&basis=STOCK_VALUE&size=200`,
        { token: manager },
      );
      const valueShare = abc.body.classes.reduce((sum, item) => sum + item.valueShare, 0);
      expect(valueShare).toBeCloseTo(100, 0);
      expect(abc.body.pareto.at(-1)).toBeCloseTo(100, 0);
      expect(abc.body.items[0].abcClass).toBe('A');

      const invalid = await call<ErrorResponse>(
        'GET',
        `/reports/inventory-summary?from=${today}&to=${day(-1)}`,
        { token: manager },
      );
      expect(invalid.status).toBe(422);
      const forbidden = await call('GET', `/reports/abc?from=${day(-1)}&to=${today}`, {
        token: staff,
      });
      expect(forbidden.status).toBe(403);
    });
  });
});
