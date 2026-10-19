import type { Route, Routes } from '@angular/router';

import { MODULE_ACCESS } from './core/auth/module-access';
import { type RouteAccess, routeAccess } from './core/auth/route-access';
import { accessGuard, authGuard, guestGuard } from './core/guards/auth.guards';
import type { TranslationKey } from './core/i18n/i18n.types';

/**
 * Module đã có trong menu/contract nhưng màn hình thuộc giai đoạn sau. Route vẫn được bảo vệ
 * theo quyền; khi làm module, thay bằng `loadChildren: () => import('./features/<module>/…')`.
 */
function upcomingModule(path: string, labelKey: TranslationKey, access: RouteAccess): Route {
  return {
    path,
    title: labelKey,
    canActivate: [accessGuard],
    data: { breadcrumb: labelKey, moduleKey: labelKey, ...routeAccess(access) },
    loadComponent: () =>
      import('./features/system/coming-soon-page').then((module) => module.ComingSoonPage),
  };
}

/** `title` và `data.breadcrumb` là KHÓA DỊCH (xem AppTitleStrategy, Breadcrumb). */
export const routes: Routes = [
  {
    path: 'login',
    title: 'auth.login.title',
    canMatch: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login/login-page').then((module) => module.LoginPage),
  },
  {
    path: '',
    canMatch: [authGuard],
    loadComponent: () =>
      import('./layout/main-layout/main-layout').then((module) => module.MainLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: 'nav.dashboard',
        canActivate: [accessGuard],
        data: { breadcrumb: 'nav.dashboard', ...routeAccess(MODULE_ACCESS.dashboard) },
        loadChildren: () => import('./features/dashboard/dashboard.routes'),
      },
      upcomingModule('products', 'nav.products', MODULE_ACCESS.products),
      upcomingModule('categories', 'nav.categories', MODULE_ACCESS.categories),
      upcomingModule('warehouses', 'nav.warehouses', MODULE_ACCESS.warehouses),
      upcomingModule('stock', 'nav.stock', MODULE_ACCESS.stock),
      upcomingModule('goods-receipts', 'nav.goodsReceipts', MODULE_ACCESS.goodsReceipts),
      upcomingModule('goods-issues', 'nav.goodsIssues', MODULE_ACCESS.goodsIssues),
      upcomingModule('stock-movements', 'nav.stockMovements', MODULE_ACCESS.stockMovements),
      upcomingModule('users', 'nav.users', MODULE_ACCESS.users),
      {
        path: 'forbidden',
        title: 'system.forbiddenTitle',
        loadComponent: () =>
          import('./features/system/forbidden-page').then((module) => module.ForbiddenPage),
      },
      {
        path: '**',
        title: 'system.notFoundTitle',
        loadComponent: () =>
          import('./features/system/not-found-page').then((module) => module.NotFoundPage),
      },
    ],
  },
];
