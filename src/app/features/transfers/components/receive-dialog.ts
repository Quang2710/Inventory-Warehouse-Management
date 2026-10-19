import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  FormArray,
  FormControl,
  type FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import type { Location, Transfer } from '../../../core/api';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { WarehousesApi } from '../../../shared/data-access/warehouses.api';
import { FieldErrorPipe } from '../../../shared/forms/field-error.pipe';
import {
  applyServerErrors,
  integerValidator,
  optionalText,
} from '../../../shared/forms/form-utils';
import { TransfersApi } from '../data-access/transfers.api';

interface ReceiveLineForm {
  lineId: FormControl<string>;
  receivedQuantity: FormControl<number>;
  toLocationId: FormControl<string | null>;
}

/** Xác nhận nhận hàng: số thực nhận từng dòng + ô cất hàng ở kho đến. */
@Component({
  selector: 'app-receive-dialog',
  imports: [
    DecimalPipe,
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
  templateUrl: './receive-dialog.html',
  styles: `
    .hint {
      margin-top: 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .line {
      display: grid;
      grid-template-columns: minmax(0, 2fr) 80px 120px minmax(150px, 1fr);
      align-items: center;
      gap: 4px 12px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      padding-top: 8px;
    }
    .line__name {
      display: flex;
      flex-direction: column;
    }
    .short {
      color: var(--mat-sys-error);
      font: var(--mat-sys-label-small);
    }
    .note {
      width: 100%;
      margin-top: 12px;
    }
    @media (max-width: 599.98px) {
      .line {
        grid-template-columns: 1fr 1fr;
      }
      .line__name {
        grid-column: 1 / -1;
      }
    }
  `,
})
export class ReceiveDialog {
  private readonly api = inject(TransfersApi);
  private readonly warehousesApi = inject(WarehousesApi);
  private readonly ref = inject<MatDialogRef<ReceiveDialog, Transfer>>(MatDialogRef);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly i18n = inject(I18nService);
  protected readonly transfer = inject<Transfer>(MAT_DIALOG_DATA);
  protected readonly bins = signal<Location[]>([]);
  protected readonly saving = signal(false);

  protected readonly form = this.fb.group({
    note: ['', Validators.maxLength(1000)],
    lines: new FormArray<FormGroup<ReceiveLineForm>>(
      this.transfer.lines.map((line) =>
        this.fb.group<ReceiveLineForm>({
          lineId: this.fb.control(line.id),
          receivedQuantity: this.fb.control(line.quantity, [
            Validators.required,
            Validators.min(0),
            Validators.max(line.quantity),
            integerValidator,
          ]),
          toLocationId: new FormControl<string | null>(null),
        }),
      ),
    ),
  });

  constructor() {
    this.warehousesApi.locations(this.transfer.toWarehouseId, { type: 'BIN' }).subscribe({
      next: (bins) => this.bins.set(bins.filter((bin) => bin.status === 'ACTIVE')),
    });
  }

  protected shortage(index: number): number {
    const shipped = this.transfer.lines[index].quantity;
    return Math.max(
      0,
      shipped - Number(this.form.controls.lines.at(index).controls.receivedQuantity.value),
    );
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
      const received = await firstValueFrom(
        this.api.receive(this.transfer.id, {
          note: optionalText(value.note),
          lines: value.lines.map((line) => ({
            lineId: line.lineId,
            receivedQuantity: Number(line.receivedQuantity),
            toLocationId: line.toLocationId,
          })),
        }),
      );
      this.notifications.success('transfers.received');
      this.ref.close(received);
    } catch (error) {
      if (!applyServerErrors(this.form, error)) this.notifications.error(error);
    } finally {
      this.saving.set(false);
    }
  }
}
