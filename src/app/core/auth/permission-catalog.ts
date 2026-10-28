import type { Permission } from '../api';
import type { TranslationKey } from '../i18n/i18n.types';

export interface PermissionGroup {
  /** Tiền tố quyền, vd `transfer`. */
  key: string;
  labelKey: TranslationKey;
  permissions: readonly Permission[];
}

/**
 * Danh mục quyền theo nhóm chức năng — thứ tự hiển thị của ma trận phân quyền.
 * Giá trị lấy từ enum `Permission` của contract; thiếu quyền nào sẽ báo lỗi biên dịch.
 */
export const PERMISSION_GROUPS = [
  { key: 'dashboard', labelKey: 'permissionGroups.dashboard', permissions: ['dashboard:view'] },
  {
    key: 'warehouse',
    labelKey: 'permissionGroups.warehouse',
    permissions: ['warehouse:read', 'warehouse:write'],
  },
  { key: 'stock', labelKey: 'permissionGroups.stock', permissions: ['stock:read'] },
  {
    key: 'transfer',
    labelKey: 'permissionGroups.transfer',
    permissions: ['transfer:read', 'transfer:write', 'transfer:receive'],
  },
  {
    key: 'stocktake',
    labelKey: 'permissionGroups.stocktake',
    permissions: ['stocktake:read', 'stocktake:write', 'stocktake:count', 'stocktake:approve'],
  },
  {
    key: 'goods-receipt',
    labelKey: 'permissionGroups.goods-receipt',
    permissions: ['goods-receipt:read', 'goods-receipt:write', 'goods-receipt:approve'],
  },
  {
    key: 'goods-issue',
    labelKey: 'permissionGroups.goods-issue',
    permissions: ['goods-issue:read', 'goods-issue:write', 'goods-issue:approve'],
  },
  {
    key: 'stock-movement',
    labelKey: 'permissionGroups.stock-movement',
    permissions: ['stock-movement:read'],
  },
  {
    key: 'product',
    labelKey: 'permissionGroups.product',
    permissions: ['product:read', 'product:write'],
  },
  {
    key: 'category',
    labelKey: 'permissionGroups.category',
    permissions: ['category:read', 'category:write'],
  },
  {
    key: 'supplier',
    labelKey: 'permissionGroups.supplier',
    permissions: ['supplier:read', 'supplier:write'],
  },
  {
    key: 'customer',
    labelKey: 'permissionGroups.customer',
    permissions: ['customer:read', 'customer:write'],
  },
  { key: 'user', labelKey: 'permissionGroups.user', permissions: ['user:read', 'user:write'] },
  { key: 'role', labelKey: 'permissionGroups.role', permissions: ['role:read', 'role:write'] },
  { key: 'audit', labelKey: 'permissionGroups.audit', permissions: ['audit:read'] },
  { key: 'report', labelKey: 'permissionGroups.report', permissions: ['report:read'] },
] as const satisfies readonly PermissionGroup[];

type ListedPermission = (typeof PERMISSION_GROUPS)[number]['permissions'][number];
type MissingPermission = Exclude<Permission, ListedPermission>;
const exhaustive: MissingPermission extends never ? true : MissingPermission = true;
void exhaustive;

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap(
  (group) => group.permissions,
);

export function permissionLabelKey(permission: Permission): TranslationKey {
  return `permissions.${permission}` as TranslationKey;
}
