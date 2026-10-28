import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  MatAutocompleteModule,
  type MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  of,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

import type { Product } from '../../../core/api';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { ProductsApi } from '../../data-access/products.api';
import { FieldErrorPipe } from '../../forms/field-error.pipe';

/** Thông tin sản phẩm tối thiểu để hiển thị/ghi vào dòng chứng từ. */
export interface ProductOption {
  id: string;
  sku: string;
  name: string;
  unit: string;
  barcode?: string;
  trackLot?: boolean;
  trackExpiry?: boolean;
  trackSerial?: boolean;
  /** Giá nhập / giá bán tham chiếu — gợi ý đơn giá khi lập phiếu. */
  costPrice?: number;
  salePrice?: number;
}

/** Product (contract) → ProductOption. */
export function toProductOption(product: Product): ProductOption {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    unit: product.unit,
    barcode: product.barcode,
    trackLot: product.trackLot,
    trackExpiry: product.trackExpiry,
    trackSerial: product.trackSerial,
    costPrice: product.costPrice,
    salePrice: product.salePrice,
  };
}

/**
 * Ô chọn sản phẩm có tìm kiếm phía server (SKU, tên, mã vạch). Gắn với một
 * `FormControl<ProductOption | null>` của form cha.
 */
@Component({
  selector: 'app-product-autocomplete',
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    TranslatePipe,
    FieldErrorPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field class="field">
      <mat-label>{{ label() }}</mat-label>
      <input
        matInput
        [formControl]="search"
        [matAutocomplete]="auto"
        (blur)="restore()"
        autocomplete="off"
        [attr.aria-invalid]="control().invalid && control().touched"
      />
      @if (searching()) {
        <mat-progress-spinner matSuffix mode="indeterminate" diameter="18" />
      }
      <mat-autocomplete
        #auto="matAutocomplete"
        [displayWith]="display"
        (optionSelected)="select($event)"
      >
        @for (option of options(); track option.id) {
          <mat-option [value]="option">
            <span class="sku">{{ option.sku }}</span> {{ option.name }}
          </mat-option>
        } @empty {
          @if (search.value && !searching()) {
            <mat-option disabled>{{ 'common.noResults' | t }}</mat-option>
          }
        }
      </mat-autocomplete>
      @if (control().invalid && control().touched) {
        <mat-error>{{ control() | fieldError }}</mat-error>
      }
    </mat-form-field>
  `,
  styles: `
    .field {
      width: 100%;
    }
    .sku {
      font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class ProductAutocomplete {
  private readonly api = inject(ProductsApi);

  readonly control = input.required<FormControl<ProductOption | null>>();
  readonly label = input.required<string>();

  protected readonly search = new FormControl<string | ProductOption>('', { nonNullable: true });
  protected readonly options = signal<ProductOption[]>([]);
  protected readonly searching = signal(false);
  protected readonly display = (value: string | ProductOption | null): string =>
    value && typeof value === 'object' ? `${value.sku} — ${value.name}` : (value ?? '');

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.search.valueChanges
      .pipe(
        filter((value): value is string => typeof value === 'string'),
        map((value) => value.trim()),
        // Báo "đang tìm" ngay khi gõ để không hiện "không có kết quả" trong lúc chờ debounce.
        tap(() => this.searching.set(true)),
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) =>
          this.api.list({ q, size: 20, status: 'ACTIVE', sort: 'sku,asc' }).pipe(
            map((page) => page.items.map(toProductOption)),
            catchError(() => of([])),
          ),
        ),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((options) => {
        this.searching.set(false);
        this.options.set(options);
      });

    // Đồng bộ hiển thị khi form cha đặt/reset giá trị.
    toObservable(this.control)
      .pipe(
        switchMap((control) => control.valueChanges.pipe(startWith(control.value))),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((value) => this.search.setValue(value ?? '', { emitEvent: false }));
    effect(() => {
      if (this.control().disabled) this.search.disable({ emitEvent: false });
      else this.search.enable({ emitEvent: false });
    });
  }

  protected select(event: MatAutocompleteSelectedEvent): void {
    const control = this.control();
    control.setValue(event.option.value as ProductOption);
    control.markAsDirty();
  }

  /** Rời ô khi chưa chọn gợi ý → trả lại sản phẩm đang chọn. */
  protected restore(): void {
    const control = this.control();
    control.markAsTouched();
    if (typeof this.search.value === 'string') {
      this.search.setValue(control.value ?? '', { emitEvent: false });
    }
  }
}
