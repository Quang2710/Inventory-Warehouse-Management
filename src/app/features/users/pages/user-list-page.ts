import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import type { Role, User, UserStatus } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ROLE_LABEL_KEYS, USER_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { injectPagedList, toApiQuery } from '../../../shared/data-access/paged-list';
import { WarehouseLookup } from '../../../shared/data-access/warehouse-lookup';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ConfirmService } from '../../../shared/ui/confirm-dialog/confirm.service';
import {
  CellTemplate,
  DataTable,
  type TableColumn,
} from '../../../shared/ui/data-table/data-table';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { SearchField } from '../../../shared/ui/search-field/search-field';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';
import { UserFormDialog } from '../components/user-form-dialog';
import { UsersApi } from '../data-access/users.api';

const COLUMNS: readonly TableColumn[] = [
  { key: 'username', labelKey: 'users.fields.username', sortable: true, required: true },
  { key: 'fullName', labelKey: 'users.fields.fullName', sortable: true, required: true },
  { key: 'email', labelKey: 'users.fields.email', hidden: true },
  { key: 'role', labelKey: 'users.fields.role', sortable: true },
  { key: 'warehouseIds', labelKey: 'users.fields.warehouses' },
  { key: 'status', labelKey: 'users.fields.status', sortable: true },
  { key: 'lastLoginAt', labelKey: 'users.fields.lastLoginAt', sortable: true },
  { key: 'actions', labelKey: 'common.actions', required: true, align: 'end' },
];

@Component({
  selector: 'app-user-list-page',
  imports: [
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatFormFieldModule,
    MatSelectModule,
    TranslatePipe,
    PageHeader,
    DataTable,
    CellTemplate,
    SearchField,
    StatusChip,
    HasPermissionDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-list-page.html',
  styles: `
    .scope {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .scope span {
      padding: 0 6px;
      border-radius: var(--mat-sys-corner-extra-small);
      background: var(--mat-sys-surface-container-highest);
      font: var(--mat-sys-label-small);
    }
  `,
})
export class UserListPage {
  private readonly api = inject(UsersApi);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  protected readonly auth = inject(AuthStore);
  protected readonly warehouses = inject(WarehouseLookup);

  protected readonly columns = COLUMNS;
  protected readonly roleLabels = ROLE_LABEL_KEYS;
  protected readonly roleOptions = Object.keys(ROLE_LABEL_KEYS) as Role[];
  protected readonly statusLabels = USER_STATUS;
  protected readonly statusOptions = Object.keys(USER_STATUS) as UserStatus[];

  protected readonly list = injectPagedList<User, { role: string | null; status: string | null }>({
    filters: { role: null, status: null },
    sort: { active: 'username', direction: 'asc' },
    fetch: (params) => this.api.list(toApiQuery(params)),
  });

  constructor() {
    void this.warehouses.ensureLoaded();
  }

  protected warehouseCodes(ids: readonly string[]): string[] {
    return ids.map(
      (id) => this.warehouses.items().find((warehouse) => warehouse.id === id)?.code ?? id,
    );
  }

  protected async open(user?: User): Promise<void> {
    if (!this.auth.hasPermission('user:write')) return;
    const ref = this.dialog.open<UserFormDialog, User | undefined, User>(UserFormDialog, {
      data: user,
      width: '640px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: 'first-tabbable',
    });
    if (await firstValueFrom(ref.afterClosed())) {
      this.list.reload();
    }
  }

  protected async resetPassword(user: User): Promise<void> {
    const password = await this.confirm.prompt({
      title: this.i18n.t('users.resetPasswordTitle', { name: user.fullName }),
      message: this.i18n.t('users.resetPasswordHint'),
      label: this.i18n.t('users.fields.newPassword'),
      confirmText: this.i18n.t('users.resetPassword'),
      cancelText: this.i18n.t('common.cancel'),
      inputType: 'password',
      minLength: 8,
    });
    if (!password) return;
    try {
      await firstValueFrom(this.api.resetPassword(user.id, password));
      this.notifications.success('users.passwordReset');
    } catch (error) {
      this.notifications.error(error);
    }
  }

  protected async remove(user: User): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: this.i18n.t('users.deleteTitle', { name: user.fullName }),
      message: this.i18n.t('users.deleteMessage'),
      confirmText: this.i18n.t('common.delete'),
      cancelText: this.i18n.t('common.cancel'),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await firstValueFrom(this.api.delete(user.id));
      this.notifications.success('users.deleted');
      this.list.reload();
    } catch {
      // 409 hiển thị bởi error interceptor.
    }
  }
}
