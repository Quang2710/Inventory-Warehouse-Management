import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import type { Role, User, UserStatus } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ROLE_LABEL_KEYS, USER_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { WarehouseLookup } from '../../../shared/data-access/warehouse-lookup';
import { FieldErrorPipe } from '../../../shared/forms/field-error.pipe';
import { applyServerErrors, optionalText } from '../../../shared/forms/form-utils';
import { UsersApi } from '../data-access/users.api';

const USERNAME = /^[a-z0-9._-]{3,32}$/;

/** Thêm / sửa người dùng: vai trò, trạng thái và phạm vi kho. */
@Component({
  selector: 'app-user-form-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    TranslatePipe,
    FieldErrorPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-form-dialog.html',
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px 16px;
    }
    .full {
      grid-column: 1 / -1;
    }
    @media (max-width: 599.98px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class UserFormDialog {
  private readonly api = inject(UsersApi);
  private readonly ref = inject<MatDialogRef<UserFormDialog, User>>(MatDialogRef);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthStore);
  protected readonly warehouses = inject(WarehouseLookup);
  protected readonly user = inject<User | undefined>(MAT_DIALOG_DATA);
  protected readonly isSelf = this.user?.id === this.auth.user()?.id;
  protected readonly roles = Object.entries(ROLE_LABEL_KEYS) as [
    Role,
    (typeof ROLE_LABEL_KEYS)[Role],
  ][];
  protected readonly statuses = Object.entries(USER_STATUS) as [
    UserStatus,
    (typeof USER_STATUS)[UserStatus],
  ][];
  protected readonly saving = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group({
    username: [this.user?.username ?? '', [Validators.required, Validators.pattern(USERNAME)]],
    password: ['', this.user ? [] : [Validators.required, Validators.minLength(8)]],
    fullName: [this.user?.fullName ?? '', [Validators.required, Validators.maxLength(100)]],
    email: [this.user?.email ?? '', [Validators.required, Validators.email]],
    phone: [this.user?.phone ?? ''],
    role: [this.user?.role ?? ('WAREHOUSE_STAFF' as Role), Validators.required],
    status: [this.user?.status ?? ('ACTIVE' as UserStatus)],
    warehouseIds: [this.user?.warehouseIds ?? ([] as string[])],
  });

  constructor() {
    void this.warehouses.ensureLoaded();
    if (this.user) {
      this.form.controls.username.disable();
    }
    if (this.isSelf) {
      // Không tự hạ quyền / khóa chính mình (server cũng chặn).
      this.form.controls.role.disable();
      this.form.controls.status.disable();
    }
  }

  protected heading(): string {
    return this.user
      ? this.i18n.t('users.editTitle', { name: this.user.fullName })
      : this.i18n.t('users.createTitle');
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const profile = {
      fullName: value.fullName.trim(),
      email: value.email.trim(),
      phone: optionalText(value.phone),
      role: value.role,
      warehouseIds: value.warehouseIds,
    };
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(
        this.user
          ? this.api.update(this.user.id, { ...profile, status: value.status })
          : this.api.create({
              ...profile,
              username: value.username.trim(),
              password: value.password,
            }),
      );
      this.notifications.success(this.user ? 'users.updated' : 'users.created');
      this.ref.close(saved);
    } catch (error) {
      if (!applyServerErrors(this.form, error)) {
        this.notifications.error(error);
      }
    } finally {
      this.saving.set(false);
    }
  }
}
