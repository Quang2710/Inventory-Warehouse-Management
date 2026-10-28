import { inject } from '@angular/core';
import { RedirectCommand, type ResolveFn, Router, type Routes } from '@angular/router';
import { catchError, of } from 'rxjs';

import type { GoodsIssue } from '../../core/api';
import { routeAccess } from '../../core/auth/route-access';
import { accessGuard } from '../../core/guards/auth.guards';
import { NotificationService } from '../../core/notification/notification.service';
import { unsavedChangesGuard } from '../../shared/forms/unsaved-changes.guard';
import { GoodsIssuesApi } from './data-access/goods-issues.api';
import { IssueDetailPage } from './pages/issue-detail-page';
import { IssueFormPage } from './pages/issue-form-page';
import { IssueListPage } from './pages/issue-list-page';

export const issueResolver: ResolveFn<GoodsIssue | RedirectCommand> = (route) => {
  const router = inject(Router);
  const notifications = inject(NotificationService);
  return inject(GoodsIssuesApi)
    .get(route.paramMap.get('id') ?? '')
    .pipe(
      catchError((error: unknown) => {
        notifications.error(error);
        return of(new RedirectCommand(router.parseUrl('/goods-issues')));
      }),
    );
};

const codeOf = (route: { data: { issue?: GoodsIssue } }) => route.data.issue?.code;

export default [
  { path: '', component: IssueListPage },
  {
    path: 'new',
    component: IssueFormPage,
    title: 'issues.newTitle',
    canActivate: [accessGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { breadcrumb: 'issues.newTitle', ...routeAccess({ permissions: ['goods-issue:write'] }) },
  },
  {
    path: ':id',
    resolve: { issue: issueResolver },
    runGuardsAndResolvers: 'always',
    data: { breadcrumb: codeOf },
    children: [
      { path: '', component: IssueDetailPage },
      {
        path: 'edit',
        component: IssueFormPage,
        canActivate: [accessGuard],
        canDeactivate: [unsavedChangesGuard],
        data: { breadcrumb: 'common.edit', ...routeAccess({ permissions: ['goods-issue:write'] }) },
      },
    ],
  },
] satisfies Routes;
