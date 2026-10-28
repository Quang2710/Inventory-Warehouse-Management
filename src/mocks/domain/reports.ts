import type {
  AbcBasis,
  AbcClass,
  AbcClassSummary,
  AbcRow,
  InventorySummaryRow,
  InventorySummaryTotals,
  StockCard,
  StockCardEntry,
  StockValueRow,
  ValueGroup,
} from '../../app/core/api/schema';
import { db, findById, type ProductEntity, type StockMovementEntity } from '../db';
import { toLocalDate } from '../utils/date';

/**
 * Báo cáo tính trực tiếp từ StockMovement (sổ cái tồn kho):
 * - Giá trị = Σ(số lượng có dấu × đơn giá vốn của movement). Xuất ghi theo giá vốn bình quân tại
 *   thời điểm xuất nên Σ giá trị ≈ tồn × giá vốn bình quân (chênh lệch làm tròn ≤ vài đồng).
 * - Ngày của movement tính theo giờ Việt Nam.
 * - "Tất cả kho": chuyển kho nội bộ vẫn hiện ở cả cột xuất (kho đi) và nhập (kho đến).
 */

export interface ReportScope {
  warehouseIds: ReadonlySet<string>;
  from: string;
  to: string;
}

const movementDay = (movement: StockMovementEntity) => toLocalDate(new Date(movement.occurredAt));

function inScope(movement: StockMovementEntity, warehouseIds: ReadonlySet<string>): boolean {
  return warehouseIds.has(movement.warehouseId);
}

function matchesCategory(product: ProductEntity, categoryId: string | null): boolean {
  return (
    !categoryId ||
    product.category?.id === categoryId ||
    product.category?.parent?.id === categoryId
  );
}

// ── Thẻ kho ──

export function stockCard(
  product: ProductEntity,
  scope: ReportScope & { warehouseId: string | null; lotNumber: string | null },
): StockCard {
  const movements = db.stockMovement
    .getAll()
    .filter(
      (movement) =>
        movement.productId === product.id &&
        inScope(movement, scope.warehouseIds) &&
        (!scope.lotNumber || movement.lotNumber === scope.lotNumber),
    )
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  let balance = 0;
  let inbound = 0;
  let outbound = 0;
  let opening = 0;
  const entries: StockCardEntry[] = [];
  for (const movement of movements) {
    const day = movementDay(movement);
    if (day > scope.to) break;
    balance += movement.quantity;
    if (day < scope.from) {
      opening = balance;
      continue;
    }
    if (movement.quantity > 0) inbound += movement.quantity;
    else outbound += -movement.quantity;
    entries.push({
      id: movement.id,
      occurredAt: movement.occurredAt,
      type: movement.type,
      documentType: movement.documentType,
      documentId: movement.documentId,
      documentCode: movement.documentCode,
      warehouseId: movement.warehouseId,
      warehouseName: findById('warehouse', movement.warehouseId)?.name ?? '—',
      locationCode: findById('location', movement.locationId)?.code ?? null,
      lotNumber: movement.lotNumber,
      expiryDate: movement.expiryDate,
      inbound: Math.max(0, movement.quantity),
      outbound: Math.max(0, -movement.quantity),
      balance,
      unitCost: movement.unitCost,
      ...(movement.note ? { note: movement.note } : {}),
    });
  }
  return {
    productId: product.id,
    sku: product.sku,
    productName: product.name,
    unit: product.unit,
    warehouseId: scope.warehouseId,
    warehouseName: scope.warehouseId
      ? (findById('warehouse', scope.warehouseId)?.name ?? null)
      : null,
    lotNumber: scope.lotNumber,
    from: scope.from,
    to: scope.to,
    openingQuantity: opening,
    inboundQuantity: inbound,
    outboundQuantity: outbound,
    closingQuantity: opening + inbound - outbound,
    entries,
  };
}

// ── Nhập – xuất – tồn ──

const emptyTotals = (): InventorySummaryTotals => ({
  openingQuantity: 0,
  openingValue: 0,
  inboundQuantity: 0,
  inboundValue: 0,
  outboundQuantity: 0,
  outboundValue: 0,
  closingQuantity: 0,
  closingValue: 0,
});

export function inventorySummary(
  scope: ReportScope & { categoryId: string | null; onlyActive: boolean },
): { rows: InventorySummaryRow[]; totals: InventorySummaryTotals } {
  const byProduct = new Map<string, InventorySummaryTotals>();
  for (const movement of db.stockMovement.getAll()) {
    if (!inScope(movement, scope.warehouseIds)) continue;
    const day = movementDay(movement);
    if (day > scope.to) continue;
    const entry = byProduct.get(movement.productId) ?? emptyTotals();
    const value = movement.quantity * movement.unitCost;
    if (day < scope.from) {
      entry.openingQuantity += movement.quantity;
      entry.openingValue += value;
    } else if (movement.quantity > 0) {
      entry.inboundQuantity += movement.quantity;
      entry.inboundValue += value;
    } else {
      entry.outboundQuantity += -movement.quantity;
      entry.outboundValue += -value;
    }
    byProduct.set(movement.productId, entry);
  }

  const rows: InventorySummaryRow[] = [];
  const totals = emptyTotals();
  for (const product of db.product.getAll()) {
    if (!matchesCategory(product, scope.categoryId)) continue;
    const entry = byProduct.get(product.id) ?? emptyTotals();
    entry.closingQuantity = entry.openingQuantity + entry.inboundQuantity - entry.outboundQuantity;
    entry.closingValue = entry.openingValue + entry.inboundValue - entry.outboundValue;
    const active =
      entry.openingQuantity !== 0 ||
      entry.inboundQuantity !== 0 ||
      entry.outboundQuantity !== 0 ||
      entry.closingQuantity !== 0;
    if (scope.onlyActive && !active) continue;
    rows.push({
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      unit: product.unit,
      categoryName: product.category?.name ?? '—',
      ...entry,
    });
    for (const key of Object.keys(totals) as (keyof InventorySummaryTotals)[]) {
      totals[key] += entry[key];
    }
  }
  return { rows, totals };
}

// ── Giá trị tồn ──

export function stockValue(scope: {
  warehouseIds: ReadonlySet<string>;
  categoryId: string | null;
}) {
  const byProduct = new Map<string, { quantity: number; value: number }>();
  const byCategory = new Map<string, ValueGroup>();
  const byWarehouse = new Map<string, ValueGroup>();
  let totalQuantity = 0;
  let totalValue = 0;
  for (const item of db.stockItem.getAll()) {
    if (!scope.warehouseIds.has(item.warehouseId) || item.quantity <= 0) continue;
    const product = findById('product', item.productId);
    if (!product || !matchesCategory(product, scope.categoryId)) continue;
    const value = item.quantity * item.averageCost;
    const entry = byProduct.get(product.id) ?? { quantity: 0, value: 0 };
    entry.quantity += item.quantity;
    entry.value += value;
    byProduct.set(product.id, entry);
    const add = (map: Map<string, ValueGroup>, id: string, name: string) => {
      const group = map.get(id) ?? { id, name, quantity: 0, value: 0, share: 0 };
      group.quantity += item.quantity;
      group.value += value;
      map.set(id, group);
    };
    add(byCategory, product.category?.id ?? '', product.category?.name ?? '—');
    add(byWarehouse, item.warehouseId, findById('warehouse', item.warehouseId)?.name ?? '—');
    totalQuantity += item.quantity;
    totalValue += value;
  }
  const share = (value: number) => (totalValue > 0 ? round2((value / totalValue) * 100) : 0);
  const rows: StockValueRow[] = [...byProduct].map(([productId, entry]) => {
    const product = findById('product', productId)!;
    return {
      productId,
      sku: product.sku,
      productName: product.name,
      unit: product.unit,
      categoryName: product.category?.name ?? '—',
      quantity: entry.quantity,
      averageCost: Math.round(entry.value / entry.quantity),
      value: entry.value,
      share: share(entry.value),
    };
  });
  const groups = (map: Map<string, ValueGroup>) =>
    [...map.values()]
      .map((group) => ({ ...group, share: share(group.value) }))
      .sort((a, b) => b.value - a.value);
  return {
    rows,
    totalQuantity,
    totalValue,
    byCategory: groups(byCategory),
    byWarehouse: groups(byWarehouse),
  };
}

// ── Phân tích ABC ──

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function abcAnalysis(
  scope: ReportScope & { basis: AbcBasis; thresholdA: number; thresholdB: number },
): { rows: AbcRow[]; classes: AbcClassSummary[]; totalValue: number; pareto: number[] } {
  const values = new Map<string, { quantity: number; value: number }>();
  if (scope.basis === 'STOCK_VALUE') {
    for (const item of db.stockItem.getAll()) {
      if (!scope.warehouseIds.has(item.warehouseId) || item.quantity <= 0) continue;
      const entry = values.get(item.productId) ?? { quantity: 0, value: 0 };
      entry.quantity += item.quantity;
      entry.value += item.quantity * item.averageCost;
      values.set(item.productId, entry);
    }
  } else {
    for (const movement of db.stockMovement.getAll()) {
      if (movement.type !== 'ISSUE' && movement.type !== 'ISSUE_CANCEL') continue;
      if (!inScope(movement, scope.warehouseIds)) continue;
      const day = movementDay(movement);
      if (day < scope.from || day > scope.to) continue;
      const entry = values.get(movement.productId) ?? { quantity: 0, value: 0 };
      entry.quantity += -movement.quantity;
      entry.value += -movement.quantity * movement.unitCost;
      values.set(movement.productId, entry);
    }
  }
  const ranked = [...values]
    .filter(([, entry]) => entry.value > 0)
    .sort((a, b) => b[1].value - a[1].value);
  const totalValue = ranked.reduce((sum, [, entry]) => sum + entry.value, 0);
  let cumulative = 0;
  const rows: AbcRow[] = ranked.map(([productId, entry], index) => {
    const before = totalValue > 0 ? (cumulative / totalValue) * 100 : 0;
    cumulative += entry.value;
    const abcClass: AbcClass =
      before < scope.thresholdA ? 'A' : before < scope.thresholdB ? 'B' : 'C';
    const product = findById('product', productId)!;
    return {
      rank: index + 1,
      productId,
      sku: product.sku,
      productName: product.name,
      categoryName: product.category?.name ?? '—',
      quantity: entry.quantity,
      value: entry.value,
      share: round2((entry.value / totalValue) * 100),
      cumulativeShare: round2((cumulative / totalValue) * 100),
      abcClass,
    };
  });
  const classes: AbcClassSummary[] = (['A', 'B', 'C'] as const).map((abcClass) => {
    const members = rows.filter((row) => row.abcClass === abcClass);
    const value = members.reduce((sum, row) => sum + row.value, 0);
    return {
      abcClass,
      productCount: members.length,
      productShare: rows.length ? round2((members.length / rows.length) * 100) : 0,
      value,
      valueShare: totalValue ? round2((value / totalValue) * 100) : 0,
    };
  });
  return { rows, classes, totalValue, pareto: rows.map((row) => row.cumulativeShare) };
}
