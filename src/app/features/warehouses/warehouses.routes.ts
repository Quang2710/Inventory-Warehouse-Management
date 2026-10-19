import { inject } from '@angular/core';
import { RedirectCommand, type ResolveFn, Router, type Routes } from '@angular/router';
import { catchError, of } from 'rxjs';

import type { Warehouse } from '../../core/api';
import { NotificationService } from '../../core/notification/notification.service';
import { WarehousesApi } from '../../shared/data-access/warehouses.api';
import { WarehouseDetailPage } from './pages/warehouse-detail-page';
import { WarehouseListPage } from './pages/warehouse-list-page';

/** Nạp kho trước khi vào trang chi tiết; không có/không đủ quyền → quay về danh sách. */
export const warehouseResolver: ResolveFn<Warehouse | RedirectCommand> = (route) => {
  const router = inject(Router);
  const notifications = inject(NotificationService);
  return inject(WarehousesApi)
    .get(route.paramMap.get('id') ?? '')
    .pipe(
      catchError((error: unknown) => {
        notifications.error(error);
        return of(new RedirectCommand(router.parseUrl('/warehouses')));
      }),
    );
};

export default [
  { path: '', component: WarehouseListPage },
  {
    path: ':id',
    component: WarehouseDetailPage,
    resolve: { warehouse: warehouseResolver },
    runGuardsAndResolvers: 'paramsChange',
    data: {
      breadcrumb: (route: { data: { warehouse?: Warehouse } }) => route.data.warehouse?.name,
    },
  },
] satisfies Routes;
