import { ScrollingModule } from '@angular/cdk/scrolling';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, firstValueFrom } from 'rxjs';

import type { StockCard, StockCardEntry } from '../../../core/api';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { TranslationKey } from '../../../core/i18n/i18n.types';
import { DOCUMENT_ROUTES, MOVEMENT_TYPE_LABEL_KEYS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { ProductsApi } from '../../../shared/data-access/products.api';
import { WarehouseLookup } from '../../../shared/data-access/warehouse-lookup';
import {
  ExportService,
  formatDateVn,
  type ExportFormat,
} from '../../../shared/export/export.service';
import {
  DateRangeField,
  type DateRange,
} from '../../../shared/ui/date-range-field/date-range-field';
import { ExportMenu } from '../../../shared/ui/export-menu/export-menu';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import {
  ProductAutocomplete,
  toProductOption,
  type ProductOption,
} from '../../../shared/ui/product-autocomplete/product-autocomplete';
import { StatePanel } from '../../../shared/ui/state-panel/state-panel';
import { ReportsApi } from '../data-access/reports.api';
import { defaultRange } from './report-range';

/** Thẻ kho của một sản phẩm: đầu kỳ → từng biến động (số dư lũy kế) → cuối kỳ. */
@Component({
  selector: 'app-stock-card-page',
  imports: [
    DatePipe,
    DecimalPipe,
    ReactiveFormsModule,
    RouterLink,
    ScrollingModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    TranslatePipe,
    PageHeader,
    ProductAutocomplete,
    DateRangeField,
    ExportMenu,
    StatePanel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stock-card-page.html',
  styles: `
    .grid {
      display: grid;
      grid-template-columns: 130px 140px 150px 120px 110px 110px 90px 90px 100px minmax(120px, 1fr);
      align-items: center;
      gap: 0 8px;
      min-width: 1180px;
      padding: 0 8px;
    }
    .head {
      font: var(--mat-sys-label-large);
      color: var(--mat-sys-on-surface-variant);
      height: 40px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .row {
      height: 44px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .row > * {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .num {
      text-align: end;
      font-variant-numeric: tabular-nums;
    }
    .in {
      color: var(--app-on-success-container);
    }
    .viewport {
      height: min(60vh, 640px);
      min-width: 1180px;
    }
    .scroll-x {
      overflow-x: auto;
    }
    .product {
      flex: 1 1 320px;
    }
  `,
})
export class StockCardPage {
  private readonly api = inject(ReportsApi);
  private readonly products = inject(ProductsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly exporter = inject(ExportService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  protected readonly warehouses = inject(WarehouseLookup);

  protected readonly movementLabels = MOVEMENT_TYPE_LABEL_KEYS;
  protected readonly product = new FormControl<ProductOption | null>(null);
  protected readonly lot = new FormControl('', { nonNullable: true });
  protected readonly warehouseId = signal<string | null>(null);
  protected readonly range = signal<DateRange>(defaultRange(30));
  protected readonly card = signal<StockCard | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<unknown>(null);
  protected readonly exporting = signal(false);

  constructor() {
    void this.warehouses.ensureLoaded();
    const query = this.route.snapshot.queryParamMap;
    this.warehouseId.set(query.get('warehouseId'));
    this.lot.setValue(query.get('lotNumber') ?? '');
    if (query.get('from') && query.get('to')) {
      this.range.set({ from: query.get('from'), to: query.get('to') });
    }
    const productId = query.get('productId');
    if (productId) {
      this.products.get(productId).subscribe({
        next: (product) => this.product.setValue(toProductOption(product)),
        error: (error: unknown) => this.notifications.error(error),
      });
    }
    const destroyRef = inject(DestroyRef);
    this.product.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => this.load());
    this.lot.valueChanges
      .pipe(debounceTime(400), distinctUntilChanged(), takeUntilDestroyed(destroyRef))
      .subscribe(() => this.load());
  }

  protected setWarehouse(id: string | null): void {
    this.warehouseId.set(id);
    this.load();
  }

  protected setRange(range: DateRange): void {
    if (range.from && range.to) {
      this.range.set(range);
      this.load();
    }
  }

  protected readonly trackEntry = (_: number, entry: StockCardEntry) => entry.id;

  protected documentLink(entry: StockCardEntry): string[] | null {
    const path = DOCUMENT_ROUTES[entry.documentType];
    return path ? [path, entry.documentId] : null;
  }

  protected load(): void {
    const product = this.product.value;
    const { from, to } = this.range();
    const lotNumber = this.lot.value.trim();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        productId: product?.id ?? null,
        warehouseId: this.warehouseId(),
        lotNumber: lotNumber || null,
        from,
        to,
      },
      replaceUrl: true,
    });
    if (!product || !from || !to) {
      this.card.set(null);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.api
      .stockCard({
        productId: product.id,
        from,
        to,
        ...(this.warehouseId() ? { warehouseId: this.warehouseId()! } : {}),
        ...(lotNumber ? { lotNumber } : {}),
      })
      .subscribe({
        next: (card) => {
          this.card.set(card);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(error);
          this.loading.set(false);
        },
      });
  }

  protected async export(format: ExportFormat): Promise<void> {
    const card = this.card();
    if (!card) return;
    this.exporting.set(true);
    const t = (key: TranslationKey) => this.i18n.t(key);
    try {
      const fresh = await firstValueFrom(
        this.api.stockCard({
          productId: card.productId,
          from: card.from,
          to: card.to,
          ...(card.warehouseId ? { warehouseId: card.warehouseId } : {}),
          ...(card.lotNumber ? { lotNumber: card.lotNumber } : {}),
        }),
      );
      await this.exporter.export(
        {
          fileName: `the-kho-${fresh.sku}`,
          title: `${t('reports.stockCard.title')} — ${fresh.sku} ${fresh.productName}`,
          subtitle: [
            `${t('stock.fields.warehouse')}: ${fresh.warehouseName ?? t('reports.allWarehouses')}`,
            `${t('common.dateRange')}: ${formatDateVn(fresh.from)} – ${formatDateVn(fresh.to)}`,
            ...(fresh.lotNumber ? [`${t('lots.lotNumber')}: ${fresh.lotNumber}`] : []),
            this.i18n.t('reports.stockCard.summaryLine', {
              opening: fresh.openingQuantity,
              inbound: fresh.inboundQuantity,
              outbound: fresh.outboundQuantity,
              closing: fresh.closingQuantity,
              unit: fresh.unit,
            }),
          ],
          columns: [
            {
              header: t('reports.stockCard.date'),
              value: (row) => row.occurredAt,
              type: 'datetime',
              width: 14,
            },
            {
              header: t('reports.stockCard.document'),
              value: (row) => row.documentCode,
              width: 15,
            },
            {
              header: t('reports.stockCard.type'),
              value: (row) => t(MOVEMENT_TYPE_LABEL_KEYS[row.type]),
              width: 16,
            },
            { header: t('stock.fields.warehouse'), value: (row) => row.warehouseName, width: 14 },
            { header: t('documents.fields.location'), value: (row) => row.locationCode, width: 10 },
            { header: t('lots.lotNumber'), value: (row) => row.lotNumber, width: 12 },
            {
              header: t('reports.stockCard.inbound'),
              value: (row) => row.inbound || null,
              type: 'number',
              width: 8,
            },
            {
              header: t('reports.stockCard.outbound'),
              value: (row) => row.outbound || null,
              type: 'number',
              width: 8,
            },
            {
              header: t('reports.stockCard.balance'),
              value: (row) => row.balance,
              type: 'number',
              width: 9,
            },
            { header: t('common.note'), value: (row) => row.note, width: 18 },
          ],
          rows: fresh.entries,
          totals: [
            t('common.total'),
            null,
            null,
            null,
            null,
            null,
            fresh.inboundQuantity,
            fresh.outboundQuantity,
            fresh.closingQuantity,
            null,
          ],
          orientation: 'landscape',
        },
        format,
      );
    } catch (error) {
      this.notifications.error(error);
    } finally {
      this.exporting.set(false);
    }
  }
}
