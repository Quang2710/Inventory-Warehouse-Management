import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import type { Warehouse, WarehouseStatus } from '../../../core/api';
import { WAREHOUSE_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { WarehouseLookup } from '../../../shared/data-access/warehouse-lookup';
import { WarehousesApi } from '../../../shared/data-access/warehouses.api';
import { FieldErrorPipe } from '../../../shared/forms/field-error.pipe';
import { applyServerErrors, optionalText } from '../../../shared/forms/form-utils';

/** Thêm / sửa thông tin kho. */
@Component({
  selector: 'app-warehouse-form-dialog',
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
  template: `
    <h2 mat-dialog-title>
      {{ (warehouse ? 'warehouses.editTitle' : 'warehouses.createTitle') | t }}
    </h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content class="grid">
        <mat-form-field>
          <mat-label>{{ 'warehouses.fields.code' | t }}</mat-label>
          <input matInput formControlName="code" (blur)="normalizeCode()" autocomplete="off" />
          <mat-error>{{ form.controls.code | fieldError }}</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'warehouses.fields.status' | t }}</mat-label>
          <mat-select formControlName="status">
            @for (status of statuses; track status) {
              <mat-option [value]="status">{{ statusLabels[status].labelKey | t }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>{{ 'warehouses.fields.name' | t }}</mat-label>
          <input matInput formControlName="name" />
          <mat-error>{{ form.controls.name | fieldError }}</mat-error>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>{{ 'warehouses.fields.address' | t }}</mat-label>
          <input matInput formControlName="address" />
          <mat-error>{{ form.controls.address | fieldError }}</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'warehouses.fields.phone' | t }}</mat-label>
          <input matInput type="tel" formControlName="phone" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'warehouses.fields.managerName' | t }}</mat-label>
          <input matInput formControlName="managerName" />
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>{{ 'common.cancel' | t }}</button>
        <button mat-flat-button type="submit" [disabled]="saving()">
          {{ (saving() ? 'common.saving' : 'common.save') | t }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px 16px;
    }
    .full {
      grid-column: 1 / -1;
    }
  `,
})
export class WarehouseFormDialog {
  private readonly api = inject(WarehousesApi);
  private readonly lookup = inject(WarehouseLookup);
  private readonly ref = inject<MatDialogRef<WarehouseFormDialog, Warehouse>>(MatDialogRef);
  private readonly notifications = inject(NotificationService);
  protected readonly warehouse = inject<Warehouse | undefined>(MAT_DIALOG_DATA);
  protected readonly statusLabels = WAREHOUSE_STATUS;
  protected readonly statuses: WarehouseStatus[] = ['ACTIVE', 'INACTIVE'];
  protected readonly saving = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group({
    code: [
      this.warehouse?.code ?? '',
      [Validators.required, Validators.pattern(/^[A-Z0-9_-]{2,20}$/)],
    ],
    name: [this.warehouse?.name ?? '', [Validators.required, Validators.maxLength(100)]],
    address: [this.warehouse?.address ?? '', [Validators.required, Validators.maxLength(300)]],
    phone: [this.warehouse?.phone ?? ''],
    managerName: [this.warehouse?.managerName ?? ''],
    status: [this.warehouse?.status ?? ('ACTIVE' as WarehouseStatus)],
  });

  protected normalizeCode(): void {
    const control = this.form.controls.code;
    control.setValue(control.value.toUpperCase().replace(/\s+/g, ''));
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const body = {
      code: value.code,
      name: value.name.trim(),
      address: value.address.trim(),
      phone: optionalText(value.phone),
      managerName: optionalText(value.managerName),
      status: value.status,
    };
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(
        this.warehouse ? this.api.update(this.warehouse.id, body) : this.api.create(body),
      );
      this.notifications.success(this.warehouse ? 'warehouses.updated' : 'warehouses.created');
      void this.lookup.refresh();
      this.ref.close(saved);
    } catch (error) {
      if (!applyServerErrors(this.form, error)) this.notifications.error(error);
    } finally {
      this.saving.set(false);
    }
  }
}
