import type { Route, Routes } from '@angular/router';

import { MODULE_ACCESS } from './core/auth/module-access';
import { type RouteAccess, routeAccess } from './core/auth/route-access';
import { accessGuard, authGuard, guestGuard } from './core/guards/auth.guards';
import type { TranslationKey } from './core/i18n/i18n.types';
import { unsavedChangesGuard } from './shared/forms/unsaved-changes.guard';

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

/** Module có route con riêng (`<feature>.routes.ts`, default export), nạp lười. */
function featureModule(
  path: string,
  labelKey: TranslationKey,
  access: RouteAccess,
  load: NonNullable<Route['loadChildren']>,
): Route {
  return {
    path,
    title: labelKey,
    canActivate: [accessGuard],
    data: { breadcrumb: labelKey, ...routeAccess(access) },
    loadChildren: load,
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
      featureModule(
        'alerts',
        'nav.alerts',
        MODULE_ACCESS.alerts,
        () => import('./features/alerts/alerts.routes'),
      ),
      {
        path: 'scan',
        title: 'nav.scan',
        canActivate: [accessGuard],
        data: { breadcrumb: 'nav.scan', ...routeAccess(MODULE_ACCESS.scan) },
        loadComponent: () => import('./features/scan/scan-page').then((module) => module.ScanPage),
      },
      featureModule(
        'warehouses',
        'nav.warehouses',
        MODULE_ACCESS.warehouses,
        () => import('./features/warehouses/warehouses.routes'),
      ),
      featureModule(
        'stock',
        'nav.stock',
        MODULE_ACCESS.stock,
        () => import('./features/stock/stock.routes'),
      ),
      featureModule(
        'goods-receipts',
        'nav.goodsReceipts',
        MODULE_ACCESS.goodsReceipts,
        () => import('./features/goods-receipts/goods-receipts.routes'),
      ),
      featureModule(
        'goods-issues',
        'nav.goodsIssues',
        MODULE_ACCESS.goodsIssues,
        () => import('./features/goods-issues/goods-issues.routes'),
      ),
      featureModule(
        'transfers',
        'nav.transfers',
        MODULE_ACCESS.transfers,
        () => import('./features/transfers/transfers.routes'),
      ),
      featureModule(
        'stocktakes',
        'nav.stocktakes',
        MODULE_ACCESS.stocktakes,
        () => import('./features/stocktakes/stocktakes.routes'),
      ),
      {
        path: 'stock-movements',
        title: 'nav.stockMovements',
        canActivate: [accessGuard],
        data: { breadcrumb: 'nav.stockMovements', ...routeAccess(MODULE_ACCESS.stockMovements) },
        loadComponent: () =>
          import('./features/reports/pages/stock-card-page').then((module) => module.StockCardPage),
      },
      {
        path: 'reports',
        canActivate: [accessGuard],
        data: { breadcrumb: 'nav.sections.reports', ...routeAccess(MODULE_ACCESS.reports) },
        loadChildren: () => import('./features/reports/reports.routes'),
      },
      {
        path: 'suppliers',
        title: 'nav.suppliers',
        canActivate: [accessGuard],
        data: {
          breadcrumb: 'nav.suppliers',
          kind: 'supplier',
          ...routeAccess(MODULE_ACCESS.suppliers),
        },
        loadComponent: () =>
          import('./features/partners/pages/partner-list-page').then(
            (module) => module.PartnerListPage,
          ),
      },
      {
        path: 'customers',
        title: 'nav.customers',
        canActivate: [accessGuard],
        data: {
          breadcrumb: 'nav.customers',
          kind: 'customer',
          ...routeAccess(MODULE_ACCESS.customers),
        },
        loadComponent: () =>
          import('./features/partners/pages/partner-list-page').then(
            (module) => module.PartnerListPage,
          ),
      },
      {
        path: 'users',
        title: 'nav.users',
        canActivate: [accessGuard],
        data: { breadcrumb: 'nav.users', ...routeAccess(MODULE_ACCESS.users) },
        loadComponent: () =>
          import('./features/users/pages/user-list-page').then((module) => module.UserListPage),
      },
      {
        path: 'roles',
        title: 'nav.roles',
        canActivate: [accessGuard],
        canDeactivate: [unsavedChangesGuard],
        data: { breadcrumb: 'nav.roles', ...routeAccess(MODULE_ACCESS.roles) },
        loadComponent: () =>
          import('./features/roles/pages/roles-page').then((module) => module.RolesPage),
      },
      {
        path: 'audit-logs',
        title: 'nav.auditLogs',
        canActivate: [accessGuard],
        data: { breadcrumb: 'nav.auditLogs', ...routeAccess(MODULE_ACCESS.auditLogs) },
        loadComponent: () =>
          import('./features/audit-logs/pages/audit-log-page').then(
            (module) => module.AuditLogPage,
          ),
      },
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
