import type { Permission, Role } from '../../app/core/api/schema';
import { findById } from '../db';

export const ALL_PERMISSIONS = [
  'dashboard:view',
  'user:read',
  'user:write',
  'role:read',
  'role:write',
  'audit:read',
  'category:read',
  'category:write',
  'product:read',
  'product:write',
  'warehouse:read',
  'warehouse:write',
  'stock:read',
  'goods-receipt:read',
  'goods-receipt:write',
  'goods-receipt:approve',
  'goods-issue:read',
  'goods-issue:write',
  'goods-issue:approve',
  'stock-movement:read',
  'transfer:read',
  'transfer:write',
  'transfer:receive',
  'stocktake:read',
  'stocktake:write',
  'stocktake:count',
  'stocktake:approve',
  'supplier:read',
  'supplier:write',
  'customer:read',
  'customer:write',
  'report:read',
] as const satisfies readonly Permission[];

// Báo lỗi biên dịch nếu contract thêm Permission mới mà danh sách trên chưa cập nhật.
type MissingPermission = Exclude<Permission, (typeof ALL_PERMISSIONS)[number]>;
const exhaustive: MissingPermission extends never ? true : MissingPermission = true;
void exhaustive;

export const ROLES: readonly Role[] = [
  'ADMIN',
  'WAREHOUSE_MANAGER',
  'WAREHOUSE_STAFF',
  'ACCOUNTANT',
];

/**
 * Ma trận quyền MẶC ĐỊNH khi seed. Ma trận đang hiệu lực nằm trong db (`roleDefinition`) và
 * Admin sửa được qua `/roles` — server luôn kiểm tra theo ma trận trong db.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ALL_PERMISSIONS,
  WAREHOUSE_MANAGER: [
    'dashboard:view',
    'audit:read',
    'category:read',
    'category:write',
    'product:read',
    'product:write',
    'warehouse:read',
    'warehouse:write',
    'stock:read',
    'goods-receipt:read',
    'goods-receipt:write',
    'goods-receipt:approve',
    'goods-issue:read',
    'goods-issue:write',
    'goods-issue:approve',
    'stock-movement:read',
    'transfer:read',
    'transfer:write',
    'transfer:receive',
    'stocktake:read',
    'stocktake:write',
    'stocktake:count',
    'stocktake:approve',
    'supplier:read',
    'customer:read',
    'report:read',
  ],
  WAREHOUSE_STAFF: [
    'dashboard:view',
    'category:read',
    'product:read',
    'warehouse:read',
    'stock:read',
    'goods-receipt:read',
    'goods-receipt:write',
    'goods-issue:read',
    'goods-issue:write',
    'stock-movement:read',
    'transfer:read',
    'transfer:write',
    'transfer:receive',
    'stocktake:read',
    'stocktake:count',
    'supplier:read',
    'customer:read',
  ],
  ACCOUNTANT: [
    'dashboard:view',
    'category:read',
    'product:read',
    'product:write',
    'warehouse:read',
    'stock:read',
    'goods-receipt:read',
    'goods-receipt:write',
    'goods-issue:read',
    'stock-movement:read',
    'transfer:read',
    'stocktake:read',
    'supplier:read',
    'supplier:write',
    'customer:read',
    'customer:write',
    'report:read',
  ],
};

/** Quyền đang hiệu lực của vai trò (đọc từ db; ADMIN luôn đủ quyền). */
export function permissionsOf(role: Role): Permission[] {
  if (role === 'ADMIN') {
    return [...ALL_PERMISSIONS];
  }
  const definition = findById('roleDefinition', role);
  return [...(definition?.permissions ?? DEFAULT_ROLE_PERMISSIONS[role])];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return permissionsOf(role).includes(permission);
}
