import { inject } from '@angular/core';
import { RedirectCommand, type ResolveFn, Router, type Routes } from '@angular/router';
import { catchError, of } from 'rxjs';

import type { Transfer } from '../../core/api';
import { accessGuard } from '../../core/guards/auth.guards';
import { routeAccess } from '../../core/auth/route-access';
import { NotificationService } from '../../core/notification/notification.service';
import { unsavedChangesGuard } from '../../shared/forms/unsaved-changes.guard';
import { TransfersApi } from './data-access/transfers.api';
import { TransferDetailPage } from './pages/transfer-detail-page';
import { TransferFormPage } from './pages/transfer-form-page';
import { TransferListPage } from './pages/transfer-list-page';

export const transferResolver: ResolveFn<Transfer | RedirectCommand> = (route) => {
  const router = inject(Router);
  const notifications = inject(NotificationService);
  return inject(TransfersApi)
    .get(route.paramMap.get('id') ?? '')
    .pipe(
      catchError((error: unknown) => {
        notifications.error(error);
        return of(new RedirectCommand(router.parseUrl('/transfers')));
      }),
    );
};

const codeOf = (route: { data: { transfer?: Transfer } }) => route.data.transfer?.code;

export default [
  { path: '', component: TransferListPage },
  {
    path: 'new',
    component: TransferFormPage,
    title: 'transfers.newTitle',
    canActivate: [accessGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { breadcrumb: 'transfers.newTitle', ...routeAccess({ permissions: ['transfer:write'] }) },
  },
  {
    path: ':id',
    resolve: { transfer: transferResolver },
    runGuardsAndResolvers: 'always',
    data: { breadcrumb: codeOf },
    children: [
      { path: '', component: TransferDetailPage },
      {
        path: 'edit',
        component: TransferFormPage,
        canActivate: [accessGuard],
        canDeactivate: [unsavedChangesGuard],
        data: { breadcrumb: 'common.edit', ...routeAccess({ permissions: ['transfer:write'] }) },
      },
    ],
  },
] satisfies Routes;
