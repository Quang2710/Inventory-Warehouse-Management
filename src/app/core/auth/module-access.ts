import type { RouteAccess } from './route-access';

/**
 * Điều kiện truy cập từng module — nguồn duy nhất cho cả route guard và menu,
 * để menu không bao giờ hiện mục mà route sẽ chặn. Phân quyền theo PERMISSION (ma trận
 * Admin chỉnh được), không cứng theo vai trò.
 */
export const MODULE_ACCESS = {
  dashboard: { permissions: ['dashboard:view'] },
  products: { permissions: ['product:read'] },
  categories: { permissions: ['category:read'] },
  warehouses: { permissions: ['warehouse:read'] },
  stock: { permissions: ['stock:read'] },
  goodsReceipts: { permissions: ['goods-receipt:read'] },
  goodsIssues: { permissions: ['goods-issue:read'] },
  transfers: { permissions: ['transfer:read'] },
  stocktakes: { permissions: ['stocktake:read'] },
  stockMovements: { permissions: ['stock-movement:read'] },
  suppliers: { permissions: ['supplier:read'] },
  customers: { permissions: ['customer:read'] },
  users: { permissions: ['user:read'] },
  roles: { permissions: ['role:read'] },
  auditLogs: { permissions: ['audit:read'] },
} as const satisfies Record<string, RouteAccess>;
