import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { ROLE_LABEL_KEYS } from '../../core/i18n/labels';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { visibleNavigation } from '../../core/navigation/navigation';
import { HasRoleDirective } from '../../shared/directives/has-role.directive';
import { PageHeader } from '../../shared/ui/page-header/page-header';

/**
 * Trang tổng quan — Giai đoạn 0: thông tin phiên + quyền + lối tắt các module được phép.
 * Các chỉ số tồn kho/biểu đồ (endpoint `/dashboard/*`) được bổ sung ở giai đoạn Dashboard.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    RouterLink,
    TranslatePipe,
    PageHeader,
    HasRoleDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  protected readonly auth = inject(AuthStore);

  protected readonly roleLabels = ROLE_LABEL_KEYS;
  protected readonly permissions = computed(() =>
    [...(this.auth.user()?.permissions ?? [])].sort(),
  );
  protected readonly modules = computed(() =>
    visibleNavigation((access) => this.auth.canAccess(access))
      .flatMap((section) => section.items)
      .filter((item) => item.path !== '/dashboard'),
  );
}
