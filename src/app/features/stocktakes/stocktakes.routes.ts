import { inject } from '@angular/core';
import { RedirectCommand, type ResolveFn, Router, type Routes } from '@angular/router';
import { catchError, of } from 'rxjs';

import type { Stocktake } from '../../core/api';
import { routeAccess } from '../../core/auth/route-access';
import { accessGuard } from '../../core/guards/auth.guards';
import { NotificationService } from '../../core/notification/notification.service';
import { StocktakesApi } from './data-access/stocktakes.api';
import { StocktakeCountPage } from './pages/stocktake-count-page';
import { StocktakeDetailPage } from './pages/stocktake-detail-page';
import { StocktakeListPage } from './pages/stocktake-list-page';

export const stocktakeResolver: ResolveFn<Stocktake | RedirectCommand> = (route) => {
  const router = inject(Router);
  const notifications = inject(NotificationService);
  return inject(StocktakesApi)
    .get(route.paramMap.get('id') ?? '')
    .pipe(
      catchError((error: unknown) => {
        notifications.error(error);
        return of(new RedirectCommand(router.parseUrl('/stocktakes')));
      }),
    );
};

const codeOf = (route: { data: { stocktake?: Stocktake } }) => route.data.stocktake?.code;

export default [
  { path: '', component: StocktakeListPage },
  {
    path: ':id',
    children: [
      {
        path: '',
        component: StocktakeDetailPage,
        resolve: { stocktake: stocktakeResolver },
        runGuardsAndResolvers: 'always',
        data: { breadcrumb: codeOf },
      },
      {
        // Màn đếm tự nạp dữ liệu (có bộ nhớ đệm offline) — không qua resolver để mở được khi mất mạng.
        path: 'count',
        component: StocktakeCountPage,
        title: 'stocktakes.actions.count',
        canActivate: [accessGuard],
        data: {
          breadcrumb: 'stocktakes.actions.count',
          ...routeAccess({ permissions: ['stocktake:count'] }),
        },
      },
    ],
  },
] satisfies Routes;
