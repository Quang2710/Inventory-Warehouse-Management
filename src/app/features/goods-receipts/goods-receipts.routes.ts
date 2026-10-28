import { inject } from '@angular/core';
import { RedirectCommand, type ResolveFn, Router, type Routes } from '@angular/router';
import { catchError, of } from 'rxjs';

import type { GoodsReceipt } from '../../core/api';
import { routeAccess } from '../../core/auth/route-access';
import { accessGuard } from '../../core/guards/auth.guards';
import { NotificationService } from '../../core/notification/notification.service';
import { unsavedChangesGuard } from '../../shared/forms/unsaved-changes.guard';
import { GoodsReceiptsApi } from './data-access/goods-receipts.api';
import { ReceiptDetailPage } from './pages/receipt-detail-page';
import { ReceiptFormPage } from './pages/receipt-form-page';
import { ReceiptListPage } from './pages/receipt-list-page';

export const receiptResolver: ResolveFn<GoodsReceipt | RedirectCommand> = (route) => {
  const router = inject(Router);
  const notifications = inject(NotificationService);
  return inject(GoodsReceiptsApi)
    .get(route.paramMap.get('id') ?? '')
    .pipe(
      catchError((error: unknown) => {
        notifications.error(error);
        return of(new RedirectCommand(router.parseUrl('/goods-receipts')));
      }),
    );
};

const codeOf = (route: { data: { receipt?: GoodsReceipt } }) => route.data.receipt?.code;

export default [
  { path: '', component: ReceiptListPage },
  {
    path: 'new',
    component: ReceiptFormPage,
    title: 'receipts.newTitle',
    canActivate: [accessGuard],
    canDeactivate: [unsavedChangesGuard],
    data: {
      breadcrumb: 'receipts.newTitle',
      ...routeAccess({ permissions: ['goods-receipt:write'] }),
    },
  },
  {
    path: ':id',
    resolve: { receipt: receiptResolver },
    runGuardsAndResolvers: 'always',
    data: { breadcrumb: codeOf },
    children: [
      { path: '', component: ReceiptDetailPage },
      {
        path: 'edit',
        component: ReceiptFormPage,
        canActivate: [accessGuard],
        canDeactivate: [unsavedChangesGuard],
        data: {
          breadcrumb: 'common.edit',
          ...routeAccess({ permissions: ['goods-receipt:write'] }),
        },
      },
    ],
  },
] satisfies Routes;
