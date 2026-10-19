import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import type { Location, LocationStatus, LocationType } from '../../../core/api';
import { I18nService } from '../../../core/i18n/i18n.service';
import { LOCATION_TYPE_LABEL_KEYS, WAREHOUSE_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { WarehousesApi } from '../../../shared/data-access/warehouses.api';
import { FieldErrorPipe } from '../../../shared/forms/field-error.pipe';
import { applyServerErrors, integerValidator } from '../../../shared/forms/form-utils';

const DIALOG_STYLES = `
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px 16px;
  }
  .full {
    grid-column: 1 / -1;
  }
  .preview {
    margin: 0;
    color: var(--mat-sys-on-surface-variant);
  }
`;

export interface LocationFormData {
  warehouseId: string;
  type: LocationType;
  parent: Location | null;
  /** Có giá trị = sửa. */
  location?: Location;
}

/** Thêm một vị trí con hoặc sửa tên / sức chứa / trạng thái vị trí. */
@Component({
  selector: 'app-location-form-dialog',
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
    <h2 mat-dialog-title>{{ heading }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content class="grid">
        @if (data.parent) {
          <p class="preview full">{{ 'locations.fields.parent' | t }}: {{ data.parent.path }}</p>
        }
        <mat-form-field>
          <mat-label>{{ 'locations.fields.code' | t }}</mat-label>
          <input matInput formControlName="code" (blur)="normalizeCode()" autocomplete="off" />
          <mat-hint>{{ 'locations.fields.codeHint' | t }}</mat-hint>
          <mat-error>{{ form.controls.code | fieldError }}</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'locations.fields.name' | t }}</mat-label>
          <input matInput formControlName="name" />
          <mat-error>{{ form.controls.name | fieldError }}</mat-error>
        </mat-form-field>
        @if (data.type === 'BIN') {
          <mat-form-field>
            <mat-label>{{ 'locations.fields.capacity' | t }}</mat-label>
            <input matInput type="number" inputmode="numeric" formControlName="capacity" min="1" />
            <mat-error>{{ form.controls.capacity | fieldError }}</mat-error>
          </mat-form-field>
        }
        @if (data.location) {
          <mat-form-field>
            <mat-label>{{ 'locations.fields.status' | t }}</mat-label>
            <mat-select formControlName="status">
              @for (status of statuses; track status) {
                <mat-option [value]="status">{{ statusLabels[status].labelKey | t }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>{{ 'common.cancel' | t }}</button>
        <button mat-flat-button type="submit" [disabled]="saving()">
          {{ (saving() ? 'common.saving' : 'common.save') | t }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: DIALOG_STYLES,
})
export class LocationFormDialog {
  private readonly api = inject(WarehousesApi);
  private readonly ref = inject<MatDialogRef<LocationFormDialog, Location>>(MatDialogRef);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  protected readonly data = inject<LocationFormData>(MAT_DIALOG_DATA);
  protected readonly statusLabels = WAREHOUSE_STATUS;
  protected readonly statuses: LocationStatus[] = ['ACTIVE', 'INACTIVE'];
  protected readonly saving = signal(false);
  protected readonly heading = this.data.location
    ? this.i18n.t('locations.editTitle', { code: this.data.location.code })
    : this.i18n.t('locations.createTitle', {
        type: this.i18n.t(LOCATION_TYPE_LABEL_KEYS[this.data.type]),
      });

  protected readonly form = inject(NonNullableFormBuilder).group({
    code: [
      this.data.location?.code ?? (this.data.parent ? `${this.data.parent.code}-` : ''),
      [Validators.required, Validators.pattern(/^[A-Z0-9-]{1,20}$/)],
    ],
    name: [this.data.location?.name ?? '', [Validators.required, Validators.maxLength(100)]],
    capacity: [
      this.data.location?.capacity ?? 500,
      this.data.type === 'BIN' ? [Validators.required, Validators.min(1), integerValidator] : [],
    ],
    status: [this.data.location?.status ?? ('ACTIVE' as LocationStatus)],
  });

  constructor() {
    if (this.data.location) this.form.controls.code.disable();
  }

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
    const capacity = this.data.type === 'BIN' ? Number(value.capacity) : undefined;
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(
        this.data.location
          ? this.api.updateLocation(this.data.location.id, {
              name: value.name.trim(),
              capacity,
              status: value.status,
            })
          : this.api.createLocation(this.data.warehouseId, {
              parentId: this.data.parent?.id ?? null,
              type: this.data.type,
              code: value.code,
              name: value.name.trim(),
              capacity,
            }),
      );
      this.notifications.success(this.data.location ? 'locations.updated' : 'locations.created');
      this.ref.close(saved);
    } catch (error) {
      if (!applyServerErrors(this.form, error)) this.notifications.error(error);
    } finally {
      this.saving.set(false);
    }
  }
}

export interface RackGeneratorData {
  warehouseId: string;
  zones: readonly Location[];
  zoneId?: string;
  /** Mọi vị trí hiện có — để gợi ý mã kệ tiếp theo. */
  locations: readonly Location[];
}

/** Tạo nhanh một kệ gồm N tầng × M ô trong một khu. */
@Component({
  selector: 'app-rack-generator-dialog',
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
    <h2 mat-dialog-title>{{ 'locations.generate.title' | t }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content class="grid">
        <mat-form-field>
          <mat-label>{{ 'locations.generate.zone' | t }}</mat-label>
          <mat-select formControlName="zoneId">
            @for (zone of data.zones; track zone.id) {
              <mat-option [value]="zone.id">{{ zone.code }} — {{ zone.name }}</mat-option>
            }
          </mat-select>
          <mat-error>{{ form.controls.zoneId | fieldError }}</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'locations.generate.rackCode' | t }}</mat-label>
          <input matInput formControlName="rackCode" (blur)="normalizeCode()" autocomplete="off" />
          <mat-error>{{ form.controls.rackCode | fieldError }}</mat-error>
        </mat-form-field>
        <p class="preview full">{{ 'locations.generate.rackCodeHint' | t }}</p>
        <mat-form-field class="full">
          <mat-label>{{ 'locations.generate.rackName' | t }}</mat-label>
          <input matInput formControlName="rackName" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'locations.generate.levels' | t }}</mat-label>
          <input
            matInput
            type="number"
            inputmode="numeric"
            formControlName="levels"
            min="1"
            max="10"
          />
          <mat-error>{{ form.controls.levels | fieldError }}</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'locations.generate.binsPerLevel' | t }}</mat-label>
          <input
            matInput
            type="number"
            inputmode="numeric"
            formControlName="binsPerLevel"
            min="1"
            max="20"
          />
          <mat-error>{{ form.controls.binsPerLevel | fieldError }}</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'locations.generate.binCapacity' | t }}</mat-label>
          <input matInput type="number" inputmode="numeric" formControlName="binCapacity" min="1" />
          <mat-error>{{ form.controls.binCapacity | fieldError }}</mat-error>
        </mat-form-field>
        <p class="preview full" role="status">
          {{ 'locations.generate.preview' | t: { levels: levels(), bins: binCount() } }}
        </p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>{{ 'common.cancel' | t }}</button>
        <button mat-flat-button type="submit" [disabled]="saving()">
          {{ (saving() ? 'common.saving' : 'common.create') | t }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: DIALOG_STYLES,
})
export class RackGeneratorDialog {
  private readonly api = inject(WarehousesApi);
  private readonly ref = inject<MatDialogRef<RackGeneratorDialog, Location[]>>(MatDialogRef);
  private readonly notifications = inject(NotificationService);
  protected readonly data = inject<RackGeneratorData>(MAT_DIALOG_DATA);
  protected readonly saving = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group({
    zoneId: [this.data.zoneId ?? this.data.zones[0]?.id ?? '', Validators.required],
    rackCode: ['', [Validators.required, Validators.pattern(/^[A-Z0-9-]{1,12}$/)]],
    rackName: [''],
    levels: [4, [Validators.required, Validators.min(1), Validators.max(10), integerValidator]],
    binsPerLevel: [
      3,
      [Validators.required, Validators.min(1), Validators.max(20), integerValidator],
    ],
    binCapacity: [500, [Validators.required, Validators.min(1), integerValidator]],
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });
  protected readonly levels = computed(() => Number(this.value().levels) || 0);
  protected readonly binCount = computed(
    () => this.levels() * (Number(this.value().binsPerLevel) || 0),
  );

  constructor() {
    this.suggestCode();
    this.form.controls.zoneId.valueChanges.subscribe(() => this.suggestCode());
  }

  /** Gợi ý mã kệ kế tiếp trong khu: A-01, A-02… → A-05. */
  private suggestCode(): void {
    const zone = this.data.zones.find((item) => item.id === this.form.controls.zoneId.value);
    if (!zone) return;
    const used = this.data.locations
      .filter((location) => location.parentId === zone.id)
      .map((location) => Number(location.code.split('-').pop()))
      .filter((number) => Number.isInteger(number));
    const next = (used.length ? Math.max(...used) : 0) + 1;
    this.form.controls.rackCode.setValue(`${zone.code}-${String(next).padStart(2, '0')}`);
  }

  protected normalizeCode(): void {
    const control = this.form.controls.rackCode;
    control.setValue(control.value.toUpperCase().replace(/\s+/g, ''));
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.saving.set(true);
    try {
      const created = await firstValueFrom(
        this.api.generateRack(this.data.warehouseId, {
          zoneId: value.zoneId,
          rackCode: value.rackCode,
          rackName: value.rackName.trim() || undefined,
          levels: Number(value.levels),
          binsPerLevel: Number(value.binsPerLevel),
          binCapacity: Number(value.binCapacity),
        }),
      );
      this.notifications.success('locations.generate.created', {
        code: value.rackCode,
        bins: this.binCount(),
      });
      this.ref.close(created);
    } catch (error) {
      if (!applyServerErrors(this.form, error)) this.notifications.error(error);
    } finally {
      this.saving.set(false);
    }
  }
}
