import type {
  BinStockItem,
  Location,
  MapBin,
  MapRack,
  MapZone,
  Product,
  StockItem,
  Warehouse,
  WarehouseMap,
} from '../../app/core/api/schema';
import {
  db,
  findById,
  type BinStockEntity,
  type LocationEntity,
  type ProductEntity,
  type StockItemEntity,
  type WarehouseEntity,
} from '../db';
import { stockStatusOf } from '../domain/inventory';
import {
  locationPath,
  locationsOf,
  locationTotals,
  type LocationTotals,
} from '../domain/locations';
import { opt } from './common';

export function toWarehouse(warehouse: WarehouseEntity): Warehouse {
  let skuCount = 0;
  let totalQuantity = 0;
  let totalValue = 0;
  for (const item of db.stockItem.getAll()) {
    if (item.warehouseId !== warehouse.id || item.quantity <= 0) continue;
    skuCount++;
    totalQuantity += item.quantity;
    totalValue += item.quantity * item.averageCost;
  }
  const bins = locationsOf(warehouse.id).filter(
    (location) => location.type === 'BIN' && location.status === 'ACTIVE',
  );
  const used = new Set(
    db.binStock
      .getAll()
      .filter((bin) => bin.warehouseId === warehouse.id && bin.quantity > 0)
      .map((bin) => bin.locationId),
  );
  return {
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    address: warehouse.address,
    phone: opt(warehouse.phone),
    managerName: opt(warehouse.managerName),
    status: warehouse.status,
    skuCount,
    totalQuantity,
    totalValue,
    binCount: bins.length,
    usedBinCount: used.size,
    createdAt: warehouse.createdAt,
    updatedAt: warehouse.updatedAt,
  };
}

export function toLocation(
  location: LocationEntity,
  totals: ReadonlyMap<string, LocationTotals>,
  childCount: ReadonlyMap<string, number>,
): Location {
  const total = totals.get(location.id);
  return {
    id: location.id,
    warehouseId: location.warehouseId,
    parentId: location.parentId,
    type: location.type,
    code: location.code,
    name: location.name,
    path: locationPath(location),
    capacity: location.type === 'BIN' ? location.capacity : null,
    status: location.status,
    sortOrder: location.sortOrder,
    quantity: total?.quantity ?? 0,
    skuCount: total?.skus.size ?? 0,
    childCount: childCount.get(location.id) ?? 0,
  };
}

/** Danh sách vị trí của kho kèm tồn gộp — sắp theo mã. */
export function toLocations(warehouseId: string, locations = locationsOf(warehouseId)): Location[] {
  const totals = locationTotals(warehouseId);
  const childCount = new Map<string, number>();
  for (const location of locations) {
    if (location.parentId)
      childCount.set(location.parentId, (childCount.get(location.parentId) ?? 0) + 1);
  }
  return [...locations]
    .sort((a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true }))
    .map((location) => toLocation(location, totals, childCount));
}

export function toWarehouseMap(warehouse: WarehouseEntity): WarehouseMap {
  const locations = locationsOf(warehouse.id);
  const totals = locationTotals(warehouse.id);
  const children = new Map<string | null, LocationEntity[]>();
  for (const location of locations) {
    const list = children.get(location.parentId) ?? [];
    list.push(location);
    children.set(location.parentId, list);
  }
  const ordered = (parentId: string | null) =>
    [...(children.get(parentId) ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
    );

  // SKU dưới mức tối thiểu của kho → đánh dấu ô chứa SKU đó trên sơ đồ.
  const lowStockProducts = new Set(
    db.stockItem
      .getAll()
      .filter((item) => item.warehouseId === warehouse.id)
      .filter((item) => {
        const product = findById('product', item.productId);
        return product !== null && stockStatusOf(item.quantity, product.minStock) === 'LOW_STOCK';
      })
      .map((item) => item.productId),
  );
  const lowByBin = new Map<string, number>();
  for (const bin of db.binStock.getAll()) {
    if (
      bin.warehouseId === warehouse.id &&
      bin.quantity > 0 &&
      lowStockProducts.has(bin.productId)
    ) {
      lowByBin.set(bin.locationId, (lowByBin.get(bin.locationId) ?? 0) + 1);
    }
  }

  let binCount = 0;
  let usedBinCount = 0;
  let capacity = 0;
  let quantity = 0;
  const toBin = (bin: LocationEntity): MapBin => {
    const total = totals.get(bin.id);
    const binCapacity = bin.capacity ?? 0;
    const binQuantity = total?.quantity ?? 0;
    if (bin.status === 'ACTIVE') {
      binCount++;
      capacity += binCapacity;
    }
    if (binQuantity > 0) usedBinCount++;
    quantity += binQuantity;
    return {
      id: bin.id,
      code: bin.code,
      status: bin.status,
      capacity: binCapacity,
      quantity: binQuantity,
      skuCount: total?.skus.size ?? 0,
      fillRate: binCapacity > 0 ? Math.round((binQuantity / binCapacity) * 1000) / 1000 : 0,
      lowStockSkuCount: lowByBin.get(bin.id) ?? 0,
    };
  };
  const sumOf = (racks: readonly { quantity: number; capacity: number }[]) =>
    racks.reduce(
      (acc, item) => ({
        quantity: acc.quantity + item.quantity,
        capacity: acc.capacity + item.capacity,
      }),
      {
        quantity: 0,
        capacity: 0,
      },
    );

  const zones: MapZone[] = ordered(null)
    .filter((zone) => zone.type === 'ZONE')
    .map((zone) => {
      const racks: MapRack[] = ordered(zone.id).map((rack) => {
        // Tầng cao nhất đứng đầu — đúng chiều nhìn mặt kệ.
        const levels = ordered(rack.id)
          .reverse()
          .map((level) => ({
            id: level.id,
            code: level.code,
            name: level.name,
            bins: ordered(level.id).map(toBin),
          }));
        const rackTotals = sumOf(
          levels.flatMap((level) => level.bins.filter((bin) => bin.status === 'ACTIVE')),
        );
        return { id: rack.id, code: rack.code, name: rack.name, levels, ...rackTotals };
      });
      return { id: zone.id, code: zone.code, name: zone.name, racks, ...sumOf(racks) };
    });

  return {
    warehouseId: warehouse.id,
    warehouseName: warehouse.name,
    binCount,
    usedBinCount,
    capacity,
    quantity,
    zones,
  };
}

export function toBinStockItem(bin: BinStockEntity): BinStockItem {
  const product = findById('product', bin.productId);
  const location = findById('location', bin.locationId);
  return {
    id: bin.id,
    warehouseId: bin.warehouseId,
    locationId: bin.locationId,
    locationCode: location?.code ?? '—',
    locationPath: location ? locationPath(location) : '—',
    productId: bin.productId,
    sku: product?.sku ?? '—',
    productName: product?.name ?? '—',
    barcode: opt(product?.barcode),
    unit: product?.unit ?? '',
    quantity: bin.quantity,
    updatedAt: bin.updatedAt,
  };
}

export function toStockItem(item: StockItemEntity): StockItem {
  const product = findById('product', item.productId);
  const warehouse = findById('warehouse', item.warehouseId);
  const minStock = product?.minStock ?? 0;
  return {
    id: item.id,
    productId: item.productId,
    sku: product?.sku ?? '—',
    productName: product?.name ?? '—',
    unit: product?.unit ?? '',
    categoryName: product?.category?.name ?? '—',
    warehouseId: item.warehouseId,
    warehouseCode: warehouse?.code ?? '—',
    warehouseName: warehouse?.name ?? '—',
    quantity: item.quantity,
    minStock,
    averageCost: item.averageCost,
    stockValue: item.quantity * item.averageCost,
    status: stockStatusOf(item.quantity, minStock),
    lastMovementAt: opt(item.lastMovementAt),
  };
}

export function toProduct(product: ProductEntity, totalStock: number): Product {
  return {
    id: product.id,
    sku: product.sku,
    barcode: opt(product.barcode),
    name: product.name,
    categoryId: product.category?.id ?? '',
    categoryName: product.category?.name ?? '—',
    unit: product.unit,
    costPrice: product.costPrice,
    salePrice: product.salePrice,
    minStock: product.minStock,
    maxStock: opt(product.maxStock),
    trackLot: product.trackLot,
    trackExpiry: product.trackExpiry,
    status: product.status,
    description: opt(product.description),
    imageUrl: opt(product.imageUrl),
    totalStock,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}
