import type { UserEntity } from '../db';
import { errors } from './http';

/**
 * Phạm vi kho của người dùng: `warehouseIds` rỗng = mọi kho.
 */
export function canAccessWarehouse(
  user: Pick<UserEntity, 'warehouseIds'>,
  warehouseId: string,
): boolean {
  return user.warehouseIds.length === 0 || user.warehouseIds.includes(warehouseId);
}

export function assertWarehouseAccess(
  user: Pick<UserEntity, 'warehouseIds'>,
  warehouseId: string,
): void {
  if (!canAccessWarehouse(user, warehouseId)) {
    throw errors.forbidden('Bạn không được phân quyền thao tác tại kho này.');
  }
}
