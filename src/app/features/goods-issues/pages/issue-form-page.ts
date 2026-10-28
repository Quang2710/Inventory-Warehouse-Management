import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
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
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, firstValueFrom, map, merge, of, switchMap, tap } from 'rxjs';

import type {
  AllocationPreviewLine,
  GoodsIssue,
  GoodsIssueRequest,
  IssueReason,
  StockLot,
} from '../../../core/api';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ISSUE_REASON_LABEL_KEYS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { CodeLookup } from '../../../shared/data-access/code-lookup';
import { PartnerLookup } from '../../../shared/data-access/partner-lookup';
import { ProductsApi } from '../../../shared/data-access/products.api';
import { StockApi } from '../../../shared/data-access/stock.api';
import { WarehouseLookup } from '../../../shared/data-access/warehouse-lookup';
import { fromLocalDate, pickerDateToApi, today } from '../../../shared/forms/date-utils';
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
import { StockPicks } from '../../../shared/ui/stock-picks/stock-picks';
import { GoodsIssuesApi } from '../data-access/goods-issues.api';

interface LineForm {
  product: FormControl<ProductOption | null>;
  quantity: FormControl<number>;
  unitPrice: FormControl<number>;
  /** `null` = để FEFO tự chọn lô. */
  lotNumber: FormControl<string | null>;
  serialNumbers: FormControl<string[]>;
}

/** Lô gộp theo số lô (một lô có thể nằm ở nhiều ô). */
export interface LotOption {
  lotNumber: string;
  expiryDate: string | null;
  quantity: number;
  expired: boolean;
}

const EDITABLE = new Set(['DRAFT', 'REJECTED']);
const REASONS = Object.keys(ISSUE_REASON_LABEL_KEYS) as IssueReason[];

function serialCountValidator(group: AbstractControl): ValidationErrors | null {
  const line = group as FormGroup<LineForm>;
  const serials = line.controls.serialNumbers.value.length;
  const quantity = Number(line.controls.quantity.value);
  const control = line.controls.serialNumbers;
  const { tracking: _old, ...rest } = control.errors ?? {};
  const error =
    serials > 0 && serials !== quantity
      ? { messageKey: 'issues.errors.serialCount', params: { count: serials, quantity } }
      : null;
  const next = error ? { ...rest, tracking: error } : rest;
  control.setErrors(Object.keys(next).length ? next : null);
  return null;
}

function groupLots(lots: readonly StockLot[]): LotOption[] {
  const byLot = new Map<string, LotOption>();
  const now = today();
  for (const lot of lots) {
    if (!lot.lotNumber) continue;
    const entry = byLot.get(lot.lotNumber) ?? {
      lotNumber: lot.lotNumber,
      expiryDate: lot.expiryDate ?? null,
      quantity: 0,
      expired: !!lot.expiryDate && lot.expiryDate < now,
    };
    entry.quantity += lot.quantity;
    byLot.set(lot.lotNumber, entry);
  }
  return [...byLot.values()];
}

/** Tạo / sửa phiếu xuất (nháp hoặc bị từ chối) kèm gợi ý lấy hàng FEFO. */
@Component({
  selector: 'app-issue-form-page',
  imports: [
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    TranslatePipe,
    FieldErrorPipe,
    PageHeader,
    ProductAutocomplete,
    StockPicks,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './issue-form-page.html',
  styles: `
    .doc-line {
      grid-template-columns: 32px minmax(240px, 2fr) 110px 150px 120px 48px;
    }
    .doc-line__extra {
      display: grid;
      grid-template-columns: minmax(200px, 1fr) minmax(200px, 1.6fr);
      gap: 4px 12px;
    }
    .suggest {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
      padding-top: 8px;
      font: var(--mat-sys-body-small);
    }
    .shortage {
      color: var(--mat-sys-error);
    }
    .serials {
      display: flex;
      align-items: center;
      gap: 8px;
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
export class IssueFormPage implements OnInit, HasUnsavedChanges {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(GoodsIssuesApi);
  private readonly stockApi = inject(StockApi);
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

  readonly issue = input<GoodsIssue>();

  protected readonly reasons = REASONS;
  protected readonly reasonLabels = ISSUE_REASON_LABEL_KEYS;

  protected readonly form = this.fb.group({
    warehouseId: ['', Validators.required],
    reason: this.fb.control<IssueReason>('SALE', Validators.required),
    partnerId: new FormControl<string | null>(null),
    customerName: ['', [Validators.required, Validators.maxLength(200)]],
    referenceNo: ['', Validators.maxLength(50)],
    issueDate: new FormControl<Date | null>(new Date(), Validators.required),
    note: ['', Validators.maxLength(1000)],
    lines: this.fb.array<FormGroup<LineForm>>([], Validators.minLength(1)),
  });
  protected readonly scanInput = new FormControl('', { nonNullable: true });

  protected readonly saving = signal(false);
  protected readonly scanning = signal(false);
  private saved = false;

  protected readonly reason = toSignal(this.form.controls.reason.valueChanges, {
    initialValue: this.form.controls.reason.value,
  });
  private readonly warehouseId = toSignal(this.form.controls.warehouseId.valueChanges, {
    initialValue: this.form.controls.warehouseId.value,
  });
  /** Lô còn tồn theo `${warehouseId}__${productId}`. */
  private readonly lotCache = signal<Record<string, LotOption[]>>({});
  private readonly requestedLots = new Set<string>();

  /** Kết quả gợi ý FEFO theo chỉ số dòng của form. */
  protected readonly preview = signal<Record<number, AllocationPreviewLine>>({});
  protected readonly previewing = signal(false);

  /** Tăng mỗi khi dòng hàng đổi giá trị — tính lại tổng số lượng / tiền. */
  private readonly linesTick = signal(0);
  protected readonly totals = computed(() => {
    this.linesTick();
    return this.lines.controls.reduce(
      (sum, line) => {
        const quantity = Number(line.controls.quantity.value) || 0;
        return {
          quantity: sum.quantity + quantity,
          amount: sum.amount + quantity * (Number(line.controls.unitPrice.value) || 0),
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
      .subscribe(() => this.linesTick.update((tick) => tick + 1));
    void this.warehouses.ensureLoaded();
    void this.partners.loadCustomers();
    void this.partners.loadSuppliers();
    const issue = this.issue();
    if (issue && !EDITABLE.has(issue.status)) {
      this.notifications.warning('documents.notEditable', { code: issue.code });
      void this.router.navigate(['/goods-issues', issue.id]);
      return;
    }
    if (issue) {
      this.form.patchValue({
        warehouseId: issue.warehouseId,
        reason: issue.reason,
        partnerId: issue.customerId ?? null,
        customerName: issue.customerName,
        referenceNo: issue.referenceNo ?? '',
        issueDate: fromLocalDate(issue.issueDate),
        note: issue.note ?? '',
      });
      for (const line of issue.lines) {
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
            unitPrice: line.unitPrice,
            lotNumber: line.lotNumber ?? null,
            serialNumbers: line.serialNumbers ?? [],
          },
        );
      }
    } else {
      const warehouses = this.warehouses.active();
      if (warehouses.length === 1) this.form.controls.warehouseId.setValue(warehouses[0].id);
      const query = this.route.snapshot.queryParamMap;
      // Từ màn Cảnh báo: "Xuất hủy" lô hết hạn → lý do DAMAGED.
      const reason = query.get('reason') as IssueReason | null;
      if (reason && REASONS.includes(reason)) {
        this.form.controls.reason.setValue(reason);
        if (reason === 'DAMAGED') {
          this.form.controls.customerName.setValue(this.i18n.t('issues.damagedReceiver'));
        }
      }
      const productId = query.get('productId');
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

    this.form.controls.partnerId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((id) => {
        const partner = [...this.partners.customers(), ...this.partners.suppliers()].find(
          (item) => item.id === id,
        );
        if (partner) this.form.controls.customerName.setValue(partner.name);
      });
    this.form.controls.reason.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.form.controls.partnerId.setValue(null));
    this.form.controls.warehouseId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        // Đổi kho → lô/serial đã chọn không còn hợp lệ.
        this.lines.controls.forEach((line) => {
          line.controls.lotNumber.setValue(null);
          line.controls.serialNumbers.setValue([]);
        });
      });

    // Gợi ý FEFO: gọi lại khi kho, lý do hoặc dòng hàng thay đổi (debounce, hủy request cũ).
    merge(
      this.form.controls.warehouseId.valueChanges,
      this.form.controls.reason.valueChanges,
      this.lines.valueChanges,
    )
      .pipe(
        debounceTime(400),
        tap(() => this.loadLots()),
        switchMap(() => this.requestPreview()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((preview) => {
        this.previewing.set(false);
        this.preview.set(preview);
      });
    this.loadLots();
    void firstValueFrom(this.requestPreview()).then((preview) => {
      this.previewing.set(false);
      this.preview.set(preview);
    });
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty && !this.saved;
  }

  protected heading(): string {
    const issue = this.issue();
    return issue
      ? this.i18n.t('issues.editTitle', { code: issue.code })
      : this.i18n.t('issues.newTitle');
  }

  protected partnerOptions() {
    return this.reason() === 'RETURN_TO_SUPPLIER'
      ? this.partners.suppliers()
      : this.reason() === 'SALE'
        ? this.partners.customers()
        : [];
  }

  protected addLine(
    product: ProductOption | null = null,
    value: Partial<{
      quantity: number;
      unitPrice: number;
      lotNumber: string | null;
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
        unitPrice: this.fb.control(value.unitPrice ?? this.defaultPrice(product), [
          Validators.required,
          Validators.min(0),
          integerValidator,
        ]),
        lotNumber: new FormControl<string | null>(value.lotNumber ?? null),
        serialNumbers: this.fb.control<string[]>(value.serialNumbers ?? []),
      },
      { validators: serialCountValidator },
    );
    group.controls.product.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((selected) => {
        if (!group.controls.unitPrice.dirty) {
          group.controls.unitPrice.setValue(this.defaultPrice(selected));
        }
        group.controls.lotNumber.setValue(null);
        group.controls.serialNumbers.setValue([]);
      });
    this.lines.push(group);
    this.lines.markAsDirty();
  }

  private defaultPrice(product: ProductOption | null): number {
    switch (this.form.controls.reason.value) {
      case 'SALE':
        return product?.salePrice ?? 0;
      case 'RETURN_TO_SUPPLIER':
        return product?.costPrice ?? 0;
      default:
        return 0;
    }
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    this.lines.markAsDirty();
  }

  protected amount(line: FormGroup<LineForm>): number {
    return (
      (Number(line.controls.quantity.value) || 0) * (Number(line.controls.unitPrice.value) || 0)
    );
  }

  protected lotsFor(line: FormGroup<LineForm>): LotOption[] {
    const productId = line.controls.product.value?.id;
    return productId ? (this.lotCache()[`${this.warehouseId()}__${productId}`] ?? []) : [];
  }

  /** Nạp lô còn tồn cho sản phẩm quản lý lô/HSD ở kho đang chọn (mỗi cặp một lần). */
  private loadLots(): void {
    const warehouseId = this.form.controls.warehouseId.value;
    if (!warehouseId) return;
    for (const line of this.lines.controls) {
      const product = line.controls.product.value;
      if (!product || !(product.trackLot || product.trackExpiry)) continue;
      const key = `${warehouseId}__${product.id}`;
      if (this.requestedLots.has(key)) continue;
      this.requestedLots.add(key);
      this.stockApi
        .lots({ warehouseId, productId: product.id, size: 200, sort: 'expiryDate,asc' })
        .subscribe({
          next: (page) =>
            this.lotCache.update((cache) => ({ ...cache, [key]: groupLots(page.items) })),
          error: () => this.requestedLots.delete(key),
        });
    }
  }

  private requestPreview() {
    const { warehouseId, reason } = this.form.getRawValue();
    const indexed = this.lines.controls
      .map((line, index) => ({ line, index }))
      .filter(
        ({ line }) =>
          !!line.controls.product.value &&
          Number.isInteger(Number(line.controls.quantity.value)) &&
          Number(line.controls.quantity.value) >= 1,
      );
    if (!warehouseId || indexed.length === 0) return of({});
    this.previewing.set(true);
    return this.api
      .previewAllocation({
        warehouseId,
        reason,
        lines: indexed.map(({ line }) => ({
          productId: line.controls.product.value!.id,
          quantity: Number(line.controls.quantity.value),
          lotNumber: line.controls.lotNumber.value,
          ...(line.controls.serialNumbers.value.length
            ? { serialNumbers: line.controls.serialNumbers.value }
            : {}),
        })),
      })
      .pipe(
        map((preview) => {
          const result: Record<number, AllocationPreviewLine> = {};
          preview.lines.forEach((entry) => (result[indexed[entry.index].index] = entry));
          return result;
        }),
        catchError(() => of({} as Record<number, AllocationPreviewLine>)),
      );
  }

  protected async editSerials(line: FormGroup<LineForm>): Promise<void> {
    const product = line.controls.product.value;
    const warehouseId = this.form.controls.warehouseId.value;
    if (!product || !warehouseId) return;
    let available: string[] = [];
    try {
      const page = await firstValueFrom(
        this.stockApi.serials({
          warehouseId,
          productId: product.id,
          status: 'IN_STOCK',
          size: 200,
          sort: 'receivedAt,asc',
        }),
      );
      available = page.items.map((unit) => unit.serialNumber);
    } catch (error) {
      this.notifications.error(error);
    }
    const ref = this.dialog.open<SerialEntryDialog, SerialEntryData, string[]>(SerialEntryDialog, {
      data: {
        product: `${product.sku} — ${product.name}`,
        quantity: Number(line.controls.quantity.value) || 0,
        serials: line.controls.serialNumbers.value,
        available,
      },
      width: '640px',
      maxWidth: 'calc(100vw - 16px)',
    });
    const serials = await firstValueFrom(ref.afterClosed());
    if (serials) {
      line.controls.serialNumbers.setValue(serials);
      line.controls.serialNumbers.markAsDirty();
      if (serials.length > 0) line.controls.quantity.setValue(serials.length);
    }
  }

  protected async scanWithCamera(): Promise<void> {
    const code = await this.scanner.scan({ title: this.i18n.t('issues.scanTitle') });
    if (code) await this.addByCode(code);
  }

  protected async onScanInput(): Promise<void> {
    const code = this.scanInput.value.trim();
    this.scanInput.setValue('');
    if (code) await this.addByCode(code);
  }

  /** Quét mã vạch sản phẩm (cộng dồn) hoặc số serial (thêm serial vào dòng của sản phẩm). */
  private async addByCode(code: string): Promise<void> {
    this.scanning.set(true);
    try {
      const match = await this.codeLookup.resolve(code);
      if (!match) {
        this.notifications.warning('issues.scanNotFound', { code });
        return;
      }
      const product = toProductOption(match.product);
      const existing = this.lines.controls.find(
        (line) => line.controls.product.value?.id === product.id,
      );
      if (match.serial) {
        const line = existing ?? this.ensureLine(product, 0);
        const serials = line.controls.serialNumbers.value;
        if (!serials.includes(match.serial.serialNumber)) {
          line.controls.serialNumbers.setValue([...serials, match.serial.serialNumber]);
          line.controls.quantity.setValue(serials.length + 1);
          line.markAsDirty();
        }
      } else if (existing && !product.trackSerial) {
        existing.controls.quantity.setValue(Number(existing.controls.quantity.value) + 1);
        existing.markAsDirty();
      } else if (!existing) {
        this.ensureLine(product, 1);
      }
      this.notifications.info('issues.scanAdded', { sku: product.sku });
    } catch (error) {
      this.notifications.error(error);
    } finally {
      this.scanning.set(false);
    }
  }

  private ensureLine(product: ProductOption, quantity: number): FormGroup<LineForm> {
    const empty = this.lines.controls.find((line) => !line.controls.product.value);
    if (empty) {
      empty.controls.product.setValue(product);
      if (quantity) empty.controls.quantity.setValue(quantity);
      empty.markAsDirty();
      return empty;
    }
    this.addLine(product, quantity ? { quantity } : {});
    return this.lines.at(this.lines.length - 1);
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
    const body: GoodsIssueRequest = {
      warehouseId: value.warehouseId,
      reason: value.reason,
      customerId: value.reason === 'SALE' ? value.partnerId : null,
      customerName: value.customerName.trim(),
      referenceNo: optionalText(value.referenceNo),
      issueDate: pickerDateToApi(value.issueDate!),
      note: optionalText(value.note),
      lines: value.lines.map((line) => ({
        productId: line.product!.id,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        lotNumber: line.lotNumber,
        ...(line.serialNumbers.length ? { serialNumbers: line.serialNumbers } : {}),
      })),
    };
    this.saving.set(true);
    try {
      const issue = this.issue();
      let saved = await firstValueFrom(
        issue ? this.api.update(issue.id, body) : this.api.create(body),
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
      await this.router.navigate(['/goods-issues', saved.id]);
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
