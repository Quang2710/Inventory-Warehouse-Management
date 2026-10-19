import { DecimalPipe } from '@angular/common';
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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { BinStockItem, Transfer, TransferRequest } from '../../../core/api';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { ProductsApi } from '../../../shared/data-access/products.api';
import { WarehouseLookup } from '../../../shared/data-access/warehouse-lookup';
import { WarehousesApi } from '../../../shared/data-access/warehouses.api';
import { fromLocalDate, toLocalDate } from '../../../shared/forms/date-utils';
import { FieldErrorPipe } from '../../../shared/forms/field-error.pipe';
import {
  applyServerErrors,
  integerValidator,
  optionalText,
} from '../../../shared/forms/form-utils';
import type { HasUnsavedChanges } from '../../../shared/forms/unsaved-changes.guard';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import {
  ProductAutocomplete,
  type ProductOption,
} from '../../../shared/ui/product-autocomplete/product-autocomplete';
import { TransfersApi } from '../data-access/transfers.api';

interface LineForm {
  product: FormControl<ProductOption | null>;
  quantity: FormControl<number>;
  fromLocationId: FormControl<string | null>;
}

function differentWarehouses(group: AbstractControl): ValidationErrors | null {
  const from = group.get('fromWarehouseId')?.value;
  const to = group.get('toWarehouseId');
  if (from && to?.value && from === to.value) {
    to.setErrors({ ...to.errors, sameWarehouse: true });
    return { sameWarehouse: true };
  }
  if (to?.hasError('sameWarehouse')) {
    const { sameWarehouse: _removed, ...rest } = to.errors ?? {};
    to.setErrors(Object.keys(rest).length ? rest : null);
  }
  return null;
}

/** Tạo / sửa phiếu chuyển kho nháp. */
@Component({
  selector: 'app-transfer-form-page',
  imports: [
    DecimalPipe,
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
  templateUrl: './transfer-form-page.html',
  styleUrl: './transfer-form-page.scss',
  host: {
    '(document:keydown)': 'onShortcut($event)',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class TransferFormPage implements OnInit, HasUnsavedChanges {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(TransfersApi);
  private readonly products = inject(ProductsApi);
  private readonly warehousesApi = inject(WarehousesApi);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly i18n = inject(I18nService);
  protected readonly warehouses = inject(WarehouseLookup);

  /** Có giá trị khi sửa (resolver). */
  readonly transfer = input<Transfer>();

  protected readonly form = this.fb.group(
    {
      fromWarehouseId: ['', Validators.required],
      toWarehouseId: ['', Validators.required],
      transferDate: new FormControl<Date | null>(new Date(), Validators.required),
      expectedDate: new FormControl<Date | null>(null),
      note: ['', Validators.maxLength(1000)],
      lines: this.fb.array<FormGroup<LineForm>>([], Validators.minLength(1)),
    },
    { validators: differentWarehouses },
  );

  protected readonly saving = signal(false);
  private saved = false;

  /** Tồn kho đi theo sản phẩm, và các ô đang chứa sản phẩm ở kho đi. */
  private readonly available = signal<Record<string, number>>({});
  private readonly binsByProduct = signal<Record<string, BinStockItem[]>>({});
  /** Sản phẩm đã gửi request tra tồn (theo kho đi hiện tại). */
  private readonly requested = new Set<string>();
  private readonly fromWarehouseId = toSignal(this.form.controls.fromWarehouseId.valueChanges, {
    initialValue: this.form.controls.fromWarehouseId.value,
  });
  protected readonly destinations = computed(() =>
    this.warehouses.allActive().filter((warehouse) => warehouse.id !== this.fromWarehouseId()),
  );

  protected get lines(): FormArray<FormGroup<LineForm>> {
    return this.form.controls.lines;
  }

  ngOnInit(): void {
    void this.warehouses.ensureLoaded();
    const transfer = this.transfer();
    if (transfer) {
      this.form.patchValue({
        fromWarehouseId: transfer.fromWarehouseId,
        toWarehouseId: transfer.toWarehouseId,
        transferDate: fromLocalDate(transfer.transferDate),
        expectedDate: fromLocalDate(transfer.expectedDate),
        note: transfer.note ?? '',
      });
      for (const line of transfer.lines) {
        this.addLine(
          { id: line.productId, sku: line.sku, name: line.productName, unit: line.unit },
          line.quantity,
          line.fromLocationId ?? null,
        );
      }
    } else {
      this.addLine();
    }
    this.form.markAsPristine();
    this.refreshStock();

    this.form.controls.fromWarehouseId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.available.set({});
        this.binsByProduct.set({});
        this.requested.clear();
        this.lines.controls.forEach((line) => line.controls.fromLocationId.setValue(null));
        this.refreshStock();
      });
    this.lines.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshStock());
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty && !this.saved;
  }

  protected heading(): string {
    const transfer = this.transfer();
    return transfer
      ? this.i18n.t('transfers.editTitle', { code: transfer.code })
      : this.i18n.t('transfers.newTitle');
  }

  protected addLine(
    product: ProductOption | null = null,
    quantity = 1,
    fromLocationId: string | null = null,
  ): void {
    this.lines.push(
      this.fb.group<LineForm>({
        product: new FormControl<ProductOption | null>(product, Validators.required),
        quantity: this.fb.control(quantity, [
          Validators.required,
          Validators.min(1),
          integerValidator,
        ]),
        fromLocationId: new FormControl<string | null>(fromLocationId),
      }),
    );
    this.lines.markAsDirty();
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    this.lines.markAsDirty();
  }

  protected availableFor(line: FormGroup<LineForm>): number | null {
    const productId = line.controls.product.value?.id;
    return productId ? (this.available()[productId] ?? null) : null;
  }

  protected binsFor(line: FormGroup<LineForm>): BinStockItem[] {
    const productId = line.controls.product.value?.id;
    return productId ? (this.binsByProduct()[productId] ?? []) : [];
  }

  protected overStock(line: FormGroup<LineForm>): boolean {
    const available = this.availableFor(line);
    return available !== null && Number(line.controls.quantity.value) > available;
  }

  /** Nạp tồn kho đi + ô chứa cho các sản phẩm chưa có trong bộ nhớ đệm. */
  private refreshStock(): void {
    const warehouseId = this.form.controls.fromWarehouseId.value;
    if (!warehouseId) return;
    const missing = this.lines.controls
      .map((line) => line.controls.product.value?.id)
      .filter((id): id is string => !!id && !this.requested.has(id));
    for (const productId of new Set(missing)) {
      this.requested.add(productId);
      this.products.stockByProduct(productId).subscribe({
        next: (items) => {
          const quantity = items.find((item) => item.warehouseId === warehouseId)?.quantity ?? 0;
          this.available.update((current) => ({ ...current, [productId]: quantity }));
        },
      });
      this.warehousesApi
        .binStock({ warehouseId, productId, size: 50, sort: 'quantity,desc' })
        .subscribe({
          next: (page) =>
            this.binsByProduct.update((current) => ({ ...current, [productId]: page.items })),
        });
    }
  }

  protected onShortcut(event: KeyboardEvent): void {
    if (event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.addLine();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.save();
    }
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
    }
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const body: TransferRequest = {
      fromWarehouseId: value.fromWarehouseId,
      toWarehouseId: value.toWarehouseId,
      transferDate: toLocalDate(value.transferDate!),
      expectedDate: value.expectedDate ? toLocalDate(value.expectedDate) : null,
      note: optionalText(value.note),
      lines: value.lines.map((line) => ({
        productId: line.product!.id,
        quantity: Number(line.quantity),
        fromLocationId: line.fromLocationId,
      })),
    };
    this.saving.set(true);
    try {
      const transfer = this.transfer();
      const saved = await firstValueFrom(
        transfer ? this.api.update(transfer.id, body) : this.api.create(body),
      );
      this.saved = true;
      this.notifications.success('transfers.saved');
      await this.router.navigate(['/transfers', saved.id]);
    } catch (error) {
      if (
        !applyServerErrors(this.form, error, (path) => path.replace(/\.productId$/, '.product'))
      ) {
        this.notifications.error(error);
      }
    } finally {
      this.saving.set(false);
    }
  }
}
