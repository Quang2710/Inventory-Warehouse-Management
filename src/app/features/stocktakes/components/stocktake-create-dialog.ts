import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import type { Location, Stocktake } from '../../../core/api';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { WarehouseLookup } from '../../../shared/data-access/warehouse-lookup';
import { WarehousesApi } from '../../../shared/data-access/warehouses.api';
import { FieldErrorPipe } from '../../../shared/forms/field-error.pipe';
import { applyServerErrors, optionalText } from '../../../shared/forms/form-utils';
import { StocktakesApi } from '../data-access/stocktakes.api';

/** Mở phiên kiểm kê: kho, phạm vi (khu), đếm mù. Trả phiên vừa tạo. */
@Component({
  selector: 'app-stocktake-create-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    TranslatePipe,
    FieldErrorPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ 'stocktakes.createTitle' | t }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <mat-dialog-content class="fields">
        <mat-form-field>
          <mat-label>{{ 'stocktakes.fields.warehouse' | t }}</mat-label>
          <mat-select formControlName="warehouseId">
            @for (warehouse of warehouses.active(); track warehouse.id) {
              <mat-option [value]="warehouse.id"
                >{{ warehouse.code }} — {{ warehouse.name }}</mat-option
              >
            }
          </mat-select>
          <mat-error>{{ form.controls.warehouseId | fieldError }}</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'stocktakes.fields.name' | t }}</mat-label>
          <input matInput formControlName="name" autocomplete="off" />
          <mat-error>{{ form.controls.name | fieldError }}</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'stocktakes.fields.zones' | t }}</mat-label>
          <mat-select formControlName="zoneIds" multiple>
            @for (zone of zones(); track zone.id) {
              <mat-option [value]="zone.id">{{ zone.code }} — {{ zone.name }}</mat-option>
            }
          </mat-select>
          <mat-hint>{{ 'stocktakes.fields.zonesHint' | t }}</mat-hint>
        </mat-form-field>
        <mat-checkbox formControlName="blind">{{ 'stocktakes.fields.blind' | t }}</mat-checkbox>
        <p class="hint">{{ 'stocktakes.fields.blindHint' | t }}</p>
        <mat-form-field>
          <mat-label>{{ 'stocktakes.fields.note' | t }}</mat-label>
          <textarea matInput formControlName="note" rows="2"></textarea>
          <mat-error>{{ form.controls.note | fieldError }}</mat-error>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>{{ 'common.cancel' | t }}</button>
        <button mat-flat-button type="submit" [disabled]="saving()">
          {{ 'stocktakes.create' | t }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .fields {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: min(460px, 80vw);
    }
    .hint {
      margin: 0 0 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class StocktakeCreateDialog {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(StocktakesApi);
  private readonly warehousesApi = inject(WarehousesApi);
  private readonly notifications = inject(NotificationService);
  private readonly ref = inject<MatDialogRef<StocktakeCreateDialog, Stocktake>>(MatDialogRef);
  protected readonly warehouses = inject(WarehouseLookup);

  protected readonly form = this.fb.group({
    warehouseId: ['', Validators.required],
    name: ['', [Validators.required, Validators.maxLength(200)]],
    zoneIds: this.fb.control<string[]>([]),
    blind: false,
    note: ['', Validators.maxLength(1000)],
  });
  protected readonly zones = signal<Location[]>([]);
  protected readonly saving = signal(false);

  constructor() {
    void this.warehouses.ensureLoaded().then(() => {
      const active = this.warehouses.active();
      if (active.length === 1) this.form.controls.warehouseId.setValue(active[0].id);
    });
    this.form.controls.warehouseId.valueChanges
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((warehouseId) => {
        this.form.controls.zoneIds.setValue([]);
        this.zones.set([]);
        if (!warehouseId) return;
        this.warehousesApi.locations(warehouseId).subscribe({
          next: (locations) =>
            this.zones.set(locations.filter((location) => location.type === 'ZONE')),
        });
      });
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.saving.set(true);
    try {
      const stocktake = await firstValueFrom(
        this.api.create({
          warehouseId: value.warehouseId,
          name: value.name.trim(),
          zoneIds: value.zoneIds,
          blind: value.blind,
          note: optionalText(value.note),
        }),
      );
      this.notifications.success('stocktakes.created', { code: stocktake.code });
      this.ref.close(stocktake);
    } catch (error) {
      if (!applyServerErrors(this.form, error)) this.notifications.error(error);
    } finally {
      this.saving.set(false);
    }
  }
}
