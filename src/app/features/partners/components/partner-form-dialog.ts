import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import type { Customer, CustomerType, PartnerStatus, Supplier } from '../../../core/api';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { TranslationKey } from '../../../core/i18n/i18n.types';
import { CUSTOMER_TYPE_LABEL_KEYS, PARTNER_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { FieldErrorPipe } from '../../../shared/forms/field-error.pipe';
import {
  applyServerErrors,
  integerValidator,
  optionalText,
} from '../../../shared/forms/form-utils';
import {
  PARTNER_KINDS,
  PartnersApi,
  type Partner,
  type PartnerKind,
} from '../data-access/partners.api';

export interface PartnerFormData {
  kind: PartnerKind;
  partner?: Partner;
}

const CODE = /^[A-Z0-9-]{2,20}$/;
const TAX_CODE = /^[0-9]{10}(-[0-9]{3})?$/;
const PHONE = /^[0-9+ ]{8,15}$/;

/** Thêm / sửa nhà cung cấp hoặc khách hàng. Trả về đối tác đã lưu. */
@Component({
  selector: 'app-partner-form-dialog',
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
  templateUrl: './partner-form-dialog.html',
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
export class PartnerFormDialog {
  private readonly api = inject(PartnersApi);
  private readonly ref = inject<MatDialogRef<PartnerFormDialog, Partner>>(MatDialogRef);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  protected readonly data = inject<PartnerFormData>(MAT_DIALOG_DATA);
  protected readonly config = PARTNER_KINDS[this.data.kind];
  protected readonly isSupplier = this.data.kind === 'supplier';
  protected readonly statuses = Object.entries(PARTNER_STATUS) as [
    PartnerStatus,
    (typeof PARTNER_STATUS)[PartnerStatus],
  ][];
  protected readonly customerTypes = Object.entries(CUSTOMER_TYPE_LABEL_KEYS) as [
    CustomerType,
    TranslationKey,
  ][];
  protected readonly saving = signal(false);

  private readonly supplier = this.isSupplier
    ? (this.data.partner as Supplier | undefined)
    : undefined;
  private readonly customer = this.isSupplier
    ? undefined
    : (this.data.partner as Customer | undefined);

  protected readonly form = inject(NonNullableFormBuilder).group({
    code: [this.data.partner?.code ?? '', [Validators.required, Validators.pattern(CODE)]],
    name: [this.data.partner?.name ?? '', [Validators.required, Validators.maxLength(200)]],
    type: [this.customer?.type ?? ('WHOLESALE' as CustomerType)],
    taxCode: [this.data.partner?.taxCode ?? '', [Validators.pattern(TAX_CODE)]],
    contactName: [this.data.partner?.contactName ?? '', [Validators.maxLength(100)]],
    phone: [this.data.partner?.phone ?? '', [Validators.pattern(PHONE)]],
    email: [this.data.partner?.email ?? '', [Validators.email]],
    address: [this.data.partner?.address ?? '', [Validators.maxLength(300)]],
    paymentTermDays: [
      this.supplier?.paymentTermDays ?? 30,
      [Validators.required, Validators.min(0), Validators.max(365), integerValidator],
    ],
    status: [this.data.partner?.status ?? ('ACTIVE' as PartnerStatus)],
    note: [this.data.partner?.note ?? '', [Validators.maxLength(1000)]],
  });

  protected heading(): string {
    return this.i18n.t(this.data.partner ? this.config.editTitle : this.config.createTitle);
  }

  protected toUpper(): void {
    const code = this.form.controls.code;
    code.setValue(code.value.toUpperCase().replace(/\s+/g, ''), { emitEvent: false });
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    if (!this.isSupplier) this.form.controls.paymentTermDays.disable();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.form.controls.paymentTermDays.enable();
      return;
    }
    const value = this.form.getRawValue();
    const common = {
      code: value.code,
      name: value.name.trim(),
      taxCode: optionalText(value.taxCode),
      contactName: optionalText(value.contactName),
      phone: optionalText(value.phone),
      email: optionalText(value.email),
      address: optionalText(value.address),
      status: value.status,
      note: optionalText(value.note),
    };
    const body = this.isSupplier
      ? { ...common, paymentTermDays: Number(value.paymentTermDays) }
      : { ...common, type: value.type };

    this.saving.set(true);
    try {
      const saved = await firstValueFrom(
        this.data.partner
          ? this.api.update(this.data.kind, this.data.partner.id, body)
          : this.api.create(this.data.kind, body),
      );
      this.notifications.success(this.data.partner ? this.config.updated : this.config.created);
      this.ref.close(saved);
    } catch (error) {
      if (!applyServerErrors(this.form, error)) {
        this.notifications.error(error);
      }
    } finally {
      this.saving.set(false);
      this.form.controls.paymentTermDays.enable();
    }
  }
}
