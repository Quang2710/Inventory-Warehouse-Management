import type { Routes } from '@angular/router';

import { routeAccess } from '../../core/auth/route-access';
import { accessGuard } from '../../core/guards/auth.guards';
import { provideCharts } from '../../shared/charts/charts';
import { AbcPage } from './pages/abc-page';
import { InventorySummaryReportPage } from './pages/inventory-summary-page';
import { StockValueReportPage } from './pages/stock-value-page';

/** Báo cáo tổng hợp (cần quyền `report:read`). Thẻ kho nằm ở route `/stock-movements`. */
export default [
  {
    path: '',
    providers: [provideCharts()],
    canActivateChild: [accessGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inventory-summary' },
      {
        path: 'inventory-summary',
        component: InventorySummaryReportPage,
        title: 'nav.inventorySummary',
        data: {
          breadcrumb: 'nav.inventorySummary',
          ...routeAccess({ permissions: ['report:read'] }),
        },
      },
      {
        path: 'stock-value',
        component: StockValueReportPage,
        title: 'nav.stockValue',
        data: { breadcrumb: 'nav.stockValue', ...routeAccess({ permissions: ['report:read'] }) },
      },
      {
        path: 'abc',
        component: AbcPage,
        title: 'nav.abc',
        data: { breadcrumb: 'nav.abc', ...routeAccess({ permissions: ['report:read'] }) },
      },
    ],
  },
] satisfies Routes;
