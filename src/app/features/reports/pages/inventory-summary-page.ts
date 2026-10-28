import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { tap } from 'rxjs';

import type { InventorySummaryRow, InventorySummaryTotals } from '../../../core/api';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { TranslationKey } from '../../../core/i18n/i18n.types';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { CategoryLookup } from '../../../shared/data-access/category-lookup';
import {
  injectPagedList,
  toApiQuery,
  type ListFilters,
} from '../../../shared/data-access/paged-list';
import { WarehouseLookup } from '../../../shared/data-access/warehouse-lookup';
import {
  ExportService,
  fetchAllPages,
  formatDateVn,
  type ExportFormat,
} from '../../../shared/export/export.service';
import {
  CellTemplate,
  DataTable,
  type TableColumn,
} from '../../../shared/ui/data-table/data-table';
import {
  DateRangeField,
  type DateRange,
} from '../../../shared/ui/date-range-field/date-range-field';
import { ExportMenu } from '../../../shared/ui/export-menu/export-menu';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { SearchField } from '../../../shared/ui/search-field/search-field';
import { ReportsApi } from '../data-access/reports.api';
import { monthToDate } from './report-range';

const QUANTITY_COLUMNS = [
  'openingQuantity',
  'inboundQuantity',
  'outboundQuantity',
  'closingQuantity',
] as const;
const VALUE_COLUMNS = ['openingValue', 'inboundValue', 'outboundValue', 'closingValue'] as const;

const COLUMNS: readonly TableColumn[] = [
  { key: 'sku', labelKey: 'documents.fields.sku', sortable: true, required: true },
  { key: 'productName', labelKey: 'documents.fields.product', sortable: true },
  { key: 'categoryName', labelKey: 'stock.fields.category', sortable: true, hidden: true },
  { key: 'unit', labelKey: 'common.unit' },
  { key: 'openingQuantity', labelKey: 'reports.nxt.opening', sortable: true, align: 'end' },
  { key: 'openingValue', labelKey: 'reports.nxt.openingValue', align: 'end', hidden: true },
  { key: 'inboundQuantity', labelKey: 'reports.nxt.inbound', sortable: true, align: 'end' },
  { key: 'inboundValue', labelKey: 'reports.nxt.inboundValue', sortable: true, align: 'end' },
  { key: 'outboundQuantity', labelKey: 'reports.nxt.outbound', sortable: true, align: 'end' },
  { key: 'outboundValue', labelKey: 'reports.nxt.outboundValue', sortable: true, align: 'end' },
  { key: 'closingQuantity', labelKey: 'reports.nxt.closing', sortable: true, align: 'end' },
  { key: 'closingValue', labelKey: 'reports.nxt.closingValue', sortable: true, align: 'end' },
];

interface Filters extends ListFilters {
  warehouseId: string | null;
  categoryId: string | null;
  from: string | null;
  to: string | null;
  onlyActive: string | null;
}

/** Nhập – xuất – tồn theo sản phẩm trong kỳ: số lượng và giá trị (giá vốn). */
@Component({
  selector: 'app-inventory-summary-page',
  imports: [
    CurrencyPipe,
    DecimalPipe,
    MatFormFieldModule,
    MatSelectModule,
    MatSlideToggleModule,
    TranslatePipe,
    PageHeader,
    DataTable,
    CellTemplate,
    SearchField,
    DateRangeField,
    ExportMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory-summary-page.html',
})
export class InventorySummaryReportPage {
  private readonly api = inject(ReportsApi);
  private readonly exporter = inject(ExportService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  protected readonly warehouses = inject(WarehouseLookup);
  protected readonly categories = inject(CategoryLookup);

  protected readonly columns = COLUMNS;
  protected readonly quantityColumns = QUANTITY_COLUMNS;
  protected readonly valueColumns = VALUE_COLUMNS;
  protected readonly totals = signal<InventorySummaryTotals | null>(null);
  protected readonly exporting = signal(false);
  private readonly defaults = monthToDate();

  protected readonly list = injectPagedList<InventorySummaryRow, Filters>({
    filters: {
      warehouseId: null,
      categoryId: null,
      from: this.defaults.from,
      to: this.defaults.to,
      onlyActive: null,
    },
    sort: { active: 'sku', direction: 'asc' },
    size: 50,
    fetch: (params) =>
      this.api
        .inventorySummary(this.query(params))
        .pipe(tap((page) => this.totals.set(page.totals))),
  });

  constructor() {
    void this.warehouses.ensureLoaded();
    void this.categories.ensureLoaded();
  }

  private query(params: Parameters<typeof toApiQuery<Filters>>[0]) {
    return toApiQuery({
      ...params,
      filters: {
        ...params.filters,
        from: params.filters.from ?? this.defaults.from,
        to: params.filters.to ?? this.defaults.to,
      },
    });
  }

  protected setRange(range: DateRange): void {
    if (!range.from || !range.to) return;
    this.list.setFilter('from', range.from);
    this.list.setFilter('to', range.to);
  }

  protected async export(format: ExportFormat): Promise<void> {
    this.exporting.set(true);
    try {
      const params = this.list.params();
      const rows = await fetchAllPages((page, size) =>
        this.api.inventorySummary(this.query({ ...params, page, size })),
      );
      const t = (key: TranslationKey) => this.i18n.t(key);
      const totals = this.totals();
      const { filters } = params;
      await this.exporter.export(
        {
          fileName: 'nhap-xuat-ton',
          title: t('reports.nxt.title'),
          subtitle: [
            `${t('common.dateRange')}: ${formatDateVn(filters.from ?? this.defaults.from)} – ${formatDateVn(filters.to ?? this.defaults.to)}`,
            `${t('stock.fields.warehouse')}: ${filters.warehouseId ? this.warehouses.name(filters.warehouseId) : t('reports.allWarehouses')}`,
          ],
          columns: [
            { header: t('documents.fields.sku'), value: (row) => row.sku, width: 13 },
            { header: t('documents.fields.product'), value: (row) => row.productName, width: 26 },
            { header: t('common.unit'), value: (row) => row.unit, width: 6 },
            {
              header: t('reports.nxt.opening'),
              value: (row) => row.openingQuantity,
              type: 'number',
              width: 8,
            },
            {
              header: t('reports.nxt.openingValue'),
              value: (row) => row.openingValue,
              type: 'money',
              width: 12,
            },
            {
              header: t('reports.nxt.inbound'),
              value: (row) => row.inboundQuantity,
              type: 'number',
              width: 8,
            },
            {
              header: t('reports.nxt.inboundValue'),
              value: (row) => row.inboundValue,
              type: 'money',
              width: 12,
            },
            {
              header: t('reports.nxt.outbound'),
              value: (row) => row.outboundQuantity,
              type: 'number',
              width: 8,
            },
            {
              header: t('reports.nxt.outboundValue'),
              value: (row) => row.outboundValue,
              type: 'money',
              width: 12,
            },
            {
              header: t('reports.nxt.closing'),
              value: (row) => row.closingQuantity,
              type: 'number',
              width: 8,
            },
            {
              header: t('reports.nxt.closingValue'),
              value: (row) => row.closingValue,
              type: 'money',
              width: 12,
            },
          ],
          rows,
          totals: totals
            ? [
                t('common.total'),
                null,
                null,
                totals.openingQuantity,
                totals.openingValue,
                totals.inboundQuantity,
                totals.inboundValue,
                totals.outboundQuantity,
                totals.outboundValue,
                totals.closingQuantity,
                totals.closingValue,
              ]
            : undefined,
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
