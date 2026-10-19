import type { Permission, Role } from '../api';

/**
 * Điều kiện truy cập một route / mục menu / thành phần UI.
 * - `roles`: người dùng phải có MỘT trong các vai trò.
 * - `permissions`: người dùng phải có TẤT CẢ các quyền.
 */
export interface RouteAccess {
  roles?: readonly Role[];
  permissions?: readonly Permission[];
}

export const ROUTE_ACCESS_KEY = 'access';

/** `data: { ...routeAccess({ permissions: ['product:read'] }) }` */
export function routeAccess(access: RouteAccess): { [ROUTE_ACCESS_KEY]: RouteAccess } {
  return { [ROUTE_ACCESS_KEY]: access };
}
