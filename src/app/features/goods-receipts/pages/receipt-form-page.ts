import { CurrencyPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  type FormArray,
  FormControl,
  type FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { GoodsReceipt, GoodsReceiptRequest } from '../../../core/api';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { CodeLookup } from '../../../shared/data-access/code-lookup';
import { PartnerLookup } from '../../../shared/data-access/partner-lookup';
import { ProductsApi } from '../../../shared/data-access/products.api';
import { WarehouseLookup } from '../../../shared/data-access/warehouse-lookup';
import { fromLocalDate, pickerDateToApi } from '../../../shared/forms/date-utils';
import { FieldErrorPipe } from '../../../shared/forms/field-error.pipe';
import {
  applyServerErrors,
  integerValidator,
  optionalText,
} from '../../../shared/forms/form-utils';
import type { HasUnsavedChanges } from '../../../shared/forms/unsaved-changes.guard';
import { BarcodeScannerService } from '../../../shared/ui/barcode-scanner/barcode-scanner.service';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import {
  ProductAutocomplete,
  toProductOption,
  type ProductOption,
} from '../../../shared/ui/product-autocomplete/product-autocomplete';
import {
  SerialEntryDialog,
  type SerialEntryData,
} from '../../../shared/ui/serial-entry-dialog/serial-entry-dialog';
import { GoodsReceiptsApi } from '../data-access/goods-receipts.api';

interface LineForm {
  product: FormControl<ProductOption | null>;
  quantity: FormControl<number>;
  unitCost: FormControl<number>;
  lotNumber: FormControl<string>;
  expiryDate: FormControl<Date | null>;
  serialNumbers: FormControl<string[]>;
}

const LOT_PATTERN = /^[A-Za-z0-9._/-]{1,50}$/;
const EDITABLE = new Set(['DRAFT', 'REJECTED']);

/** Lô / HSD / serial bắt buộc theo cấu hình sản phẩm của dòng. */
function trackingValidator(receiptDate: () => Date | null) {
  return (group: AbstractControl): ValidationErrors | null => {
    const line = group as FormGroup<LineForm>;
    const product = line.controls.product.value;
    const set = (control: AbstractControl, error: ValidationErrors | null) => {
      const { tracking: _old, ...rest } = control.errors ?? {};
      const next = error ? { ...rest, tracking: error } : rest;
      control.setErrors(Object.keys(next).length ? next : null);
    };
    const lot = line.controls.lotNumber.value.trim();
    set(
      line.controls.lotNumber,
      product?.trackLot && !lot
        ? { messageKey: 'receipts.errors.lotRequired' }
        : lot && !LOT_PATTERN.test(lot)
          ? { messageKey: 'receipts.errors.lotPattern' }
          : null,
    );
    const expiry = line.controls.expiryDate.value;
    const date = receiptDate();
    set(
      line.controls.expiryDate,
      product?.trackExpiry && !expiry
        ? { messageKey: 'receipts.errors.expiryRequired' }
        : product?.trackExpiry && expiry && date && expiry <= date
          ? { messageKey: 'receipts.errors.expiryAfterReceipt' }
          : null,
    );
    const serials = line.controls.serialNumbers.value.length;
    const quantity = Number(line.controls.quantity.value);
    set(
      line.controls.serialNumbers,
      product?.trackSerial && serials !== quantity
        ? { messageKey: 'receipts.errors.serialCount', params: { count: serials, quantity } }
        : null,
    );
    return null;
  };
}

/** Tạo / sửa phiếu nhập (nháp hoặc bị từ chối). */
@Component({
  selector: 'app-receipt-form-page',
  imports: [
    CurrencyPipe,
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    TranslatePipe,
    FieldErrorPipe,
    PageHeader,
    ProductAutocomplete,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './receipt-form-page.html',
  styles: `
    .doc-line {
      grid-template-columns: 32px minmax(240px, 2fr) 110px 150px 140px 48px;
    }
    .doc-line__extra {
      display: grid;
      grid-template-columns: minmax(160px, 1fr) minmax(160px, 1fr) minmax(200px, 1.4fr);
      gap: 4px 12px;
    }
    .serials {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-top: 6px;
    }
    .scan-field {
      width: 260px;
    }
    .totals {
      display: flex;
      justify-content: flex-end;
      gap: 24px;
      padding-top: 12px;
      font: var(--mat-sys-title-small);
    }
    @media (max-width: 959.98px) {
      .doc-line {
        grid-template-columns: 24px 1fr 1fr;
      }
      .line__product {
        grid-column: 2 / -1;
      }
      .doc-line__extra {
        grid-template-columns: 1fr;
      }
      .scan-field {
        width: 100%;
      }
    }
  `,
  host: {
    '(document:keydown)': 'onShortcut($event)',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class ReceiptFormPage implements OnInit, HasUnsavedChanges {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(GoodsReceiptsApi);
  private readonly productsApi = inject(ProductsApi);
  private readonly codeLookup = inject(CodeLookup);
  private readonly scanner = inject(BarcodeScannerService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly i18n = inject(I18nService);
  protected readonly warehouses = inject(WarehouseLookup);
  protected readonly partners = inject(PartnerLookup);

  /** Có giá trị khi sửa (resolver). */
  readonly receipt = input<GoodsReceipt>();

  protected readonly form = this.fb.group({
    warehouseId: ['', Validators.required],
    supplierId: new FormControl<string | null>(null),
    supplierName: ['', [Validators.required, Validators.maxLength(200)]],
    referenceNo: ['', Validators.maxLength(50)],
    receiptDate: new FormControl<Date | null>(new Date(), Validators.required),
    note: ['', Validators.maxLength(1000)],
    lines: this.fb.array<FormGroup<LineForm>>([], Validators.minLength(1)),
  });
  protected readonly scanInput = new FormControl('', { nonNullable: true });

  protected readonly saving = signal(false);
  protected readonly scanning = signal(false);
  private saved = false;

  /** Tăng mỗi khi dòng hàng đổi giá trị — tính lại tổng số lượng / tiền. */
  private readonly linesValue = signal(0);
  protected readonly totals = computed(() => {
    this.linesValue();
    return this.lines.controls.reduce(
      (sum, line) => {
        const quantity = Number(line.controls.quantity.value) || 0;
        return {
          quantity: sum.quantity + quantity,
          amount: sum.amount + quantity * (Number(line.controls.unitCost.value) || 0),
        };
      },
      { quantity: 0, amount: 0 },
    );
  });

  protected get lines(): FormArray<FormGroup<LineForm>> {
    return this.form.controls.lines;
  }

  ngOnInit(): void {
    this.lines.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.linesValue.update((tick) => tick + 1));
    void this.warehouses.ensureLoaded();
    void this.partners.loadSuppliers();
    const receipt = this.receipt();
    if (receipt && !EDITABLE.has(receipt.status)) {
      this.notifications.warning('documents.notEditable', { code: receipt.code });
      void this.router.navigate(['/goods-receipts', receipt.id]);
      return;
    }
    if (receipt) {
      this.form.patchValue({
        warehouseId: receipt.warehouseId,
        supplierId: receipt.supplierId ?? null,
        supplierName: receipt.supplierName,
        referenceNo: receipt.referenceNo ?? '',
        receiptDate: fromLocalDate(receipt.receiptDate),
        note: receipt.note ?? '',
      });
      for (const line of receipt.lines) {
        this.addLine(
          {
            id: line.productId,
            sku: line.sku,
            name: line.productName,
            unit: line.unit,
            trackLot: line.trackLot,
            trackExpiry: line.trackExpiry,
            trackSerial: line.trackSerial,
          },
          {
            quantity: line.quantity,
            unitCost: line.unitCost,
            lotNumber: line.lotNumber ?? '',
            expiryDate: fromLocalDate(line.expiryDate),
            serialNumbers: line.serialNumbers ?? [],
          },
        );
      }
    } else {
      const warehouses = this.warehouses.active();
      if (warehouses.length === 1) this.form.controls.warehouseId.setValue(warehouses[0].id);
      const productId = this.route.snapshot.queryParamMap.get('productId');
      if (productId) {
        this.productsApi.get(productId).subscribe({
          next: (product) => this.addLine(toProductOption(product)),
          error: () => this.addLine(),
        });
      } else {
        this.addLine();
      }
    }
    this.form.markAsPristine();

    this.form.controls.supplierId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((id) => {
        const supplier = this.partners.suppliers().find((item) => item.id === id);
        if (supplier) this.form.controls.supplierName.setValue(supplier.name);
      });
    // HSD phải sau ngày nhập → kiểm tra lại các dòng khi đổi ngày nhập.
    this.form.controls.receiptDate.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.lines.controls.forEach((line) => line.updateValueAndValidity()));
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty && !this.saved;
  }

  protected heading(): string {
    const receipt = this.receipt();
    return receipt
      ? this.i18n.t('receipts.editTitle', { code: receipt.code })
      : this.i18n.t('receipts.newTitle');
  }

  protected addLine(
    product: ProductOption | null = null,
    value: Partial<{
      quantity: number;
      unitCost: number;
      lotNumber: string;
      expiryDate: Date | null;
      serialNumbers: string[];
    }> = {},
  ): void {
    const group = this.fb.group<LineForm>(
      {
        product: new FormControl<ProductOption | null>(product, Validators.required),
        quantity: this.fb.control(value.quantity ?? 1, [
          Validators.required,
          Validators.min(1),
          Validators.max(1_000_000),
          integerValidator,
        ]),
        unitCost: this.fb.control(value.unitCost ?? product?.costPrice ?? 0, [
          Validators.required,
          Validators.min(0),
          integerValidator,
        ]),
        lotNumber: this.fb.control(value.lotNumber ?? ''),
        expiryDate: new FormControl<Date | null>(value.expiryDate ?? null),
        serialNumbers: this.fb.control<string[]>(value.serialNumbers ?? []),
      },
      { validators: trackingValidator(() => this.form.controls.receiptDate.value) },
    );
    // Đổi sản phẩm → gợi ý giá nhập tham chiếu, xóa dữ liệu lô/serial không còn phù hợp.
    group.controls.product.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((selected) => {
        if (selected?.costPrice !== undefined && !group.controls.unitCost.dirty) {
          group.controls.unitCost.setValue(selected.costPrice);
        }
        if (!selected?.trackSerial) group.controls.serialNumbers.setValue([]);
      });
    this.lines.push(group);
    this.lines.markAsDirty();
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    this.lines.markAsDirty();
  }

  protected amount(line: FormGroup<LineForm>): number {
    return (
      (Number(line.controls.quantity.value) || 0) * (Number(line.controls.unitCost.value) || 0)
    );
  }

  protected async editSerials(line: FormGroup<LineForm>): Promise<void> {
    const product = line.controls.product.value;
    if (!product) return;
    const ref = this.dialog.open<SerialEntryDialog, SerialEntryData, string[]>(SerialEntryDialog, {
      data: {
        product: `${product.sku} — ${product.name}`,
        quantity: Number(line.controls.quantity.value) || 0,
        serials: line.controls.serialNumbers.value,
      },
      width: '640px',
      maxWidth: 'calc(100vw - 16px)',
    });
    const serials = await firstValueFrom(ref.afterClosed());
    if (serials) {
      line.controls.serialNumbers.setValue(serials);
      line.controls.serialNumbers.markAsDirty();
      // Thường quét serial thay cho đếm → đồng bộ số lượng theo số serial.
      if (serials.length > 0) line.controls.quantity.setValue(serials.length);
    }
  }

  protected async scanWithCamera(): Promise<void> {
    const code = await this.scanner.scan({ title: this.i18n.t('receipts.scanTitle') });
    if (code) await this.addByCode(code);
  }

  protected async onScanInput(): Promise<void> {
    const code = this.scanInput.value.trim();
    this.scanInput.setValue('');
    if (code) await this.addByCode(code);
  }

  /** Quét mã → cộng dồn vào dòng cùng sản phẩm (hàng thường) hoặc thêm dòng mới. */
  private async addByCode(code: string): Promise<void> {
    this.scanning.set(true);
    try {
      const match = await this.codeLookup.resolve(code);
      if (!match || match.matchedBy === 'serial') {
        this.notifications.warning('receipts.scanNotFound', { code });
        return;
      }
      const product = toProductOption(match.product);
      const tracked = product.trackLot || product.trackExpiry || product.trackSerial;
      const existing = this.lines.controls.find(
        (line) => line.controls.product.value?.id === product.id,
      );
      if (existing && !tracked) {
        existing.controls.quantity.setValue(Number(existing.controls.quantity.value) + 1);
        existing.markAsDirty();
      } else {
        const empty = this.lines.controls.find((line) => !line.controls.product.value);
        if (empty) {
          empty.controls.product.setValue(product);
          empty.markAsDirty();
        } else {
          this.addLine(product);
        }
      }
      this.notifications.info('receipts.scanAdded', { sku: product.sku });
    } catch (error) {
      this.notifications.error(error);
    } finally {
      this.scanning.set(false);
    }
  }

  protected onShortcut(event: KeyboardEvent): void {
    if (event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.addLine();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.save(false);
    }
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  protected async save(submit: boolean): Promise<void> {
    if (this.saving()) return;
    this.lines.controls.forEach((line) => line.updateValueAndValidity());
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.warning('documents.fixErrors');
      return;
    }
    const value = this.form.getRawValue();
    const body: GoodsReceiptRequest = {
      warehouseId: value.warehouseId,
      supplierId: value.supplierId,
      supplierName: value.supplierName.trim(),
      referenceNo: optionalText(value.referenceNo),
      receiptDate: pickerDateToApi(value.receiptDate!),
      note: optionalText(value.note),
      lines: value.lines.map((line) => ({
        productId: line.product!.id,
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
        ...(line.product!.trackLot ? { lotNumber: line.lotNumber.trim() } : {}),
        ...(line.product!.trackExpiry && line.expiryDate
          ? { expiryDate: pickerDateToApi(line.expiryDate) }
          : {}),
        ...(line.product!.trackSerial ? { serialNumbers: line.serialNumbers } : {}),
      })),
    };
    this.saving.set(true);
    try {
      const receipt = this.receipt();
      let saved = await firstValueFrom(
        receipt ? this.api.update(receipt.id, body) : this.api.create(body),
      );
      this.saved = true;
      if (submit) {
        try {
          saved = await firstValueFrom(this.api.submit(saved.id));
          this.notifications.success('documents.submitted', { code: saved.code });
        } catch (error) {
          this.notifications.error(error);
        }
      } else {
        this.notifications.success('documents.saved', { code: saved.code });
      }
      await this.router.navigate(['/goods-receipts', saved.id]);
    } catch (error) {
      if (
        !applyServerErrors(this.form, error, (path) => path.replace(/\.productId$/, '.product'))
      ) {
        this.notifications.error(error);
      } else {
        this.notifications.warning('documents.fixErrors');
      }
    } finally {
      this.saving.set(false);
    }
  }
}
