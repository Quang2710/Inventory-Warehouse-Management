import { db, findById, type LocationEntity } from '../db';

/** Tên hiển thị một cấp vị trí. */
export function locationPath(location: LocationEntity): string {
  const names: string[] = [];
  let current: LocationEntity | null = location;
  while (current) {
    names.unshift(current.name);
    current = findById('location', current.parentId);
  }
  return names.join(' › ');
}

export function locationsOf(warehouseId: string): LocationEntity[] {
  return db.location.getAll().filter((location) => location.warehouseId === warehouseId);
}

/** Tất cả id con cháu (gồm chính nó) của một vị trí. */
export function descendantIds(rootId: string, locations: readonly LocationEntity[]): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const location of locations) {
    if (location.parentId) {
      const list = childrenOf.get(location.parentId) ?? [];
      list.push(location.id);
      childrenOf.set(location.parentId, list);
    }
  }
  const result = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const child of childrenOf.get(id) ?? []) {
      result.add(child);
      queue.push(child);
    }
  }
  return result;
}

export interface LocationTotals {
  quantity: number;
  skus: Set<string>;
}

/**
 * Tồn gộp theo từng vị trí của kho (ô cộng dồn lên tầng, kệ, khu).
 */
export function locationTotals(warehouseId: string): Map<string, LocationTotals> {
  const totals = new Map<string, LocationTotals>();
  const ensure = (id: string): LocationTotals => {
    let entry = totals.get(id);
    if (!entry) {
      entry = { quantity: 0, skus: new Set() };
      totals.set(id, entry);
    }
    return entry;
  };
  for (const bin of db.binStock.getAll()) {
    if (bin.warehouseId !== warehouseId || bin.quantity <= 0) continue;
    let location = findById('location', bin.locationId);
    while (location) {
      const entry = ensure(location.id);
      entry.quantity += bin.quantity;
      entry.skus.add(bin.productId);
      location = findById('location', location.parentId);
    }
  }
  return totals;
}

/** Khu (ZONE) chứa một vị trí bất kỳ. */
export function zoneOf(location: LocationEntity): LocationEntity | null {
  let current: LocationEntity | null = location;
  while (current && current.type !== 'ZONE') {
    current = findById('location', current.parentId);
  }
  return current;
}
