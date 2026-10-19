import { inject } from '@angular/core';
import { type CanActivateFn, type CanMatchFn, Router } from '@angular/router';

import { AuthStore } from '../auth/auth.store';
import { ROUTE_ACCESS_KEY, type RouteAccess } from '../auth/route-access';

/** Khu vực cần đăng nhập. Chưa đăng nhập → /login?returnUrl=<url đang mở>. */
export const authGuard: CanMatchFn = () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  if (auth.isAuthenticated()) {
    return true;
  }
  const returnUrl = router.currentNavigation()?.extractedUrl.toString();
  return router.createUrlTree(['/login'], {
    queryParams: returnUrl && returnUrl !== '/' ? { returnUrl } : {},
  });
};

/** Trang chỉ dành cho khách (đăng nhập). Đã đăng nhập → về trang chủ. */
export const guestGuard: CanMatchFn = () => {
  const auth = inject(AuthStore);
  return auth.isAuthenticated() ? inject(Router).createUrlTree(['/']) : true;
};

/**
 * Kiểm tra vai trò/quyền khai báo trong `data.access` của route (xem `routeAccess()`).
 * Không đủ quyền → /forbidden.
 */
export const accessGuard: CanActivateFn = (route) => {
  const auth = inject(AuthStore);
  const access = route.data[ROUTE_ACCESS_KEY] as RouteAccess | undefined;
  return auth.canAccess(access) || inject(Router).createUrlTree(['/forbidden']);
};
