import type { Alert, AlertSummary } from '../../app/core/api/schema';
import { db, findById } from '../db';
import { daysToExpiry, expiryStatusOf } from './expiry';
import { currentAverageCost, lotKey, stockStatusOf } from './inventory';

/**
 * Cảnh báo tồn kho tính tức thời từ tồn hiện tại (không lưu):
 * - OUT_OF_STOCK / LOW_STOCK: sản phẩm đang kinh doanh, đã từng có tồn tại kho, tồn < minStock.
 * - EXPIRED / EXPIRING: lô còn tồn (gộp các ô của cùng lô trong kho).
 * Thứ tự mặc định: nghiêm trọng trước → sắp hết hạn gần nhất → tồn ít nhất.
 */

export interface AlertScope {
  warehouseIds: ReadonlySet<string>;
  asOf: string;
  expiringDays: number;
}

const TYPE_ORDER: Record<Alert['type'], number> = {
  EXPIRED: 0,
  OUT_OF_STOCK: 1,
  EXPIRING: 2,
  LOW_STOCK: 3,
};

function warehouseName(id: string): string {
  return findById('warehouse', id)?.name ?? '—';
}

export function computeAlerts(scope: AlertScope): Alert[] {
  const alerts: Alert[] = [];

  for (const item of db.stockItem.getAll()) {
    if (!scope.warehouseIds.has(item.warehouseId)) continue;
    const product = findById('product', item.productId);
    if (!product || product.status !== 'ACTIVE' || product.minStock <= 0) continue;
    const status = stockStatusOf(item.quantity, product.minStock);
    if (status === 'IN_STOCK') continue;
    const target = product.maxStock ?? product.minStock * 2;
    alerts.push({
      id: `${status}__${item.id}`,
      type: status,
      severity: status === 'OUT_OF_STOCK' ? 'CRITICAL' : 'WARNING',
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      unit: product.unit,
      warehouseId: item.warehouseId,
      warehouseName: warehouseName(item.warehouseId),
      quantity: item.quantity,
      minStock: product.minStock,
      suggestedQuantity: Math.max(product.minStock - item.quantity, target - item.quantity),
      lotNumber: null,
      expiryDate: null,
      daysToExpiry: null,
      locationCode: null,
      value: item.quantity * item.averageCost,
    });
  }

  // Gộp lô theo kho (một lô có thể nằm ở nhiều ô).
  const lots = new Map<
    string,
    {
      productId: string;
      warehouseId: string;
      lotNumber: string | null;
      expiryDate: string;
      quantity: number;
      locations: Set<string>;
    }
  >();
  for (const lot of db.stockLot.getAll()) {
    if (!lot.expiryDate || lot.quantity <= 0 || !scope.warehouseIds.has(lot.warehouseId)) continue;
    const status = expiryStatusOf(lot.expiryDate, scope.asOf, scope.expiringDays);
    if (status !== 'EXPIRED' && status !== 'EXPIRING') continue;
    const key = `${lot.productId}__${lot.warehouseId}__${lotKey(lot.lotNumber, lot.expiryDate)}`;
    const entry = lots.get(key) ?? {
      productId: lot.productId,
      warehouseId: lot.warehouseId,
      lotNumber: lot.lotNumber,
      expiryDate: lot.expiryDate,
      quantity: 0,
      locations: new Set<string>(),
    };
    entry.quantity += lot.quantity;
    const code = findById('location', lot.locationId)?.code;
    if (code) entry.locations.add(code);
    lots.set(key, entry);
  }
  for (const [key, lot] of lots) {
    const product = findById('product', lot.productId);
    if (!product) continue;
    const days = daysToExpiry(lot.expiryDate, scope.asOf)!;
    const type = days < 0 ? 'EXPIRED' : 'EXPIRING';
    alerts.push({
      id: `${type}__${key}`,
      type,
      severity: type === 'EXPIRED' ? 'CRITICAL' : 'WARNING',
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      unit: product.unit,
      warehouseId: lot.warehouseId,
      warehouseName: warehouseName(lot.warehouseId),
      quantity: lot.quantity,
      lotNumber: lot.lotNumber,
      expiryDate: lot.expiryDate,
      daysToExpiry: days,
      locationCode: [...lot.locations].sort().join(', ') || null,
      value: lot.quantity * currentAverageCost(product.id, lot.warehouseId),
    });
  }

  return alerts.sort(
    (a, b) =>
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0) ||
      a.quantity - b.quantity ||
      a.sku.localeCompare(b.sku),
  );
}

export function summarizeAlerts(alerts: readonly Alert[], expiringDays: number): AlertSummary {
  const count = (type: Alert['type']) => alerts.filter((alert) => alert.type === type).length;
  return {
    total: alerts.length,
    critical: alerts.filter((alert) => alert.severity === 'CRITICAL').length,
    outOfStock: count('OUT_OF_STOCK'),
    lowStock: count('LOW_STOCK'),
    expired: count('EXPIRED'),
    expiring: count('EXPIRING'),
    expiringDays,
  };
}
