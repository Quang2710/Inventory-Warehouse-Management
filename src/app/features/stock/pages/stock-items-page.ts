import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';

import type { StockItem, StockStatus } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { TranslationKey } from '../../../core/i18n/i18n.types';
import { STOCK_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { CategoryLookup } from '../../../shared/data-access/category-lookup';
import {
  injectPagedList,
  toApiQuery,
  type ListFilters,
} from '../../../shared/data-access/paged-list';
import { StockApi } from '../../../shared/data-access/stock.api';
import { WarehouseLookup } from '../../../shared/data-access/warehouse-lookup';
import {
  ExportService,
  fetchAllPages,
  type ExportFormat,
} from '../../../shared/export/export.service';
import {
  CellTemplate,
  DataTable,
  type TableColumn,
} from '../../../shared/ui/data-table/data-table';
import { ExportMenu } from '../../../shared/ui/export-menu/export-menu';
import { SearchField } from '../../../shared/ui/search-field/search-field';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';

const COLUMNS: readonly TableColumn[] = [
  { key: 'sku', labelKey: 'documents.fields.sku', sortable: true, required: true },
  { key: 'productName', labelKey: 'documents.fields.product', sortable: true },
  { key: 'categoryName', labelKey: 'stock.fields.category', hidden: true },
  { key: 'warehouseName', labelKey: 'stock.fields.warehouse', sortable: true },
  { key: 'quantity', labelKey: 'stock.fields.quantity', sortable: true, align: 'end' },
  { key: 'minStock', labelKey: 'stock.fields.minStock', align: 'end' },
  { key: 'averageCost', labelKey: 'stock.fields.averageCost', sortable: true, align: 'end' },
  { key: 'stockValue', labelKey: 'stock.fields.stockValue', sortable: true, align: 'end' },
  { key: 'lastMovementAt', labelKey: 'stock.fields.lastMovementAt', sortable: true, hidden: true },
  { key: 'status', labelKey: 'common.status' },
];

interface Filters extends ListFilters {
  warehouseId: string | null;
  categoryId: string | null;
  status: string | null;
}

/** Tồn theo sản phẩm × kho; bấm dòng → thẻ kho của sản phẩm tại kho đó. */
@Component({
  selector: 'app-stock-items-page',
  imports: [
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    MatFormFieldModule,
    MatSelectModule,
    TranslatePipe,
    DataTable,
    CellTemplate,
    SearchField,
    StatusChip,
    ExportMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-data-table
      tableId="stock-items"
      [columns]="columns"
      [rows]="list.items()"
      [total]="list.total()"
      [pageIndex]="list.pageIndex()"
      [pageSize]="list.params().size"
      [sort]="list.params().sort"
      [loading]="list.loading()"
      [loaded]="list.loaded()"
      [error]="list.error()"
      [filtered]="list.hasFilters()"
      [clickable]="canOpenCard"
      [ariaLabel]="'stock.tabs.items' | t"
      emptyIcon="stacks"
      (page)="list.setPage($event.pageIndex, $event.pageSize)"
      (sortChange)="list.setSort($event)"
      (rowClick)="openCard($event)"
      (retry)="list.reload()"
    >
      <ng-container filters>
        <app-search-field
          [value]="list.params().q"
          [placeholder]="'stock.searchPlaceholder' | t"
          (queryChange)="list.setQuery($event)"
        />
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>{{ 'stock.fields.warehouse' | t }}</mat-label>
          <mat-select
            [value]="list.params().filters.warehouseId"
            (valueChange)="list.setFilter('warehouseId', $event)"
          >
            <mat-option [value]="null">{{ 'common.all' | t }}</mat-option>
            @for (warehouse of warehouses.items(); track warehouse.id) {
              <mat-option [value]="warehouse.id">{{ warehouse.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>{{ 'stock.fields.category' | t }}</mat-label>
          <mat-select
            [value]="list.params().filters.categoryId"
            (valueChange)="list.setFilter('categoryId', $event)"
          >
            <mat-option [value]="null">{{ 'common.all' | t }}</mat-option>
            @for (category of categories.items(); track category.id) {
              <mat-option [value]="category.id"
                >{{ category.depth ? '— ' : '' }}{{ category.name }}</mat-option
              >
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>{{ 'common.status' | t }}</mat-label>
          <mat-select
            [value]="list.params().filters.status"
            (valueChange)="list.setFilter('status', $event)"
          >
            <mat-option [value]="null">{{ 'common.all' | t }}</mat-option>
            @for (status of statusOptions; track status) {
              <mat-option [value]="status">{{ statusLabels[status].labelKey | t }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <app-export-menu
          [busy]="exporting()"
          [disabled]="list.total() === 0"
          (export)="export($event)"
        />
      </ng-container>

      <ng-template appCell="sku" [appCellOf]="list.items()" let-row
        ><span class="mono">{{ row.sku }}</span></ng-template
      >
      <ng-template appCell="quantity" [appCellOf]="list.items()" let-row
        >{{ row.quantity | number }} {{ row.unit }}</ng-template
      >
      <ng-template appCell="minStock" [appCellOf]="list.items()" let-row>{{
        row.minStock | number
      }}</ng-template>
      <ng-template appCell="averageCost" [appCellOf]="list.items()" let-row>{{
        row.averageCost | currency: 'VND' : 'symbol' : '1.0-0'
      }}</ng-template>
      <ng-template appCell="stockValue" [appCellOf]="list.items()" let-row>{{
        row.stockValue | currency: 'VND' : 'symbol' : '1.0-0'
      }}</ng-template>
      <ng-template appCell="lastMovementAt" [appCellOf]="list.items()" let-row>{{
        row.lastMovementAt ? (row.lastMovementAt | date: 'dd/MM/yyyy HH:mm') : '—'
      }}</ng-template>
      <ng-template appCell="status" [appCellOf]="list.items()" let-row
        ><app-status-chip [status]="statusLabels[row.status]"
      /></ng-template>
    </app-data-table>
  `,
})
export class StockItemsPage {
  private readonly api = inject(StockApi);
  private readonly router = inject(Router);
  private readonly exporter = inject(ExportService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  protected readonly warehouses = inject(WarehouseLookup);
  protected readonly categories = inject(CategoryLookup);

  protected readonly columns = COLUMNS;
  protected readonly statusLabels = STOCK_STATUS;
  protected readonly statusOptions = Object.keys(STOCK_STATUS) as StockStatus[];
  protected readonly canOpenCard = inject(AuthStore).hasPermission('stock-movement:read');
  protected readonly exporting = signal(false);

  protected readonly list = injectPagedList<StockItem, Filters>({
    filters: { warehouseId: null, categoryId: null, status: null },
    sort: { active: 'sku', direction: 'asc' },
    fetch: (params) => this.api.list(toApiQuery(params)),
  });

  constructor() {
    void this.warehouses.ensureLoaded();
    void this.categories.ensureLoaded();
  }

  protected openCard(item: StockItem): void {
    void this.router.navigate(['/stock-movements'], {
      queryParams: { productId: item.productId, warehouseId: item.warehouseId },
    });
  }

  protected async export(format: ExportFormat): Promise<void> {
    this.exporting.set(true);
    try {
      const params = this.list.params();
      const rows = await fetchAllPages((page, size) =>
        this.api.list(toApiQuery({ ...params, page, size })),
      );
      const t = (key: TranslationKey) => this.i18n.t(key);
      await this.exporter.export(
        {
          fileName: 'ton-kho',
          title: t('stock.exportTitle'),
          subtitle: params.filters.warehouseId
            ? [
                `${t('stock.fields.warehouse')}: ${this.warehouses.name(params.filters.warehouseId)}`,
              ]
            : [],
          columns: [
            { header: t('documents.fields.sku'), value: (row) => row.sku, width: 14 },
            { header: t('documents.fields.product'), value: (row) => row.productName, width: 30 },
            { header: t('stock.fields.warehouse'), value: (row) => row.warehouseName, width: 16 },
            { header: t('common.unit'), value: (row) => row.unit, width: 7 },
            {
              header: t('stock.fields.quantity'),
              value: (row) => row.quantity,
              type: 'number',
              width: 10,
            },
            {
              header: t('stock.fields.minStock'),
              value: (row) => row.minStock,
              type: 'number',
              width: 9,
            },
            {
              header: t('stock.fields.averageCost'),
              value: (row) => row.averageCost,
              type: 'money',
              width: 12,
            },
            {
              header: t('stock.fields.stockValue'),
              value: (row) => row.stockValue,
              type: 'money',
              width: 14,
            },
            {
              header: t('common.status'),
              value: (row) => t(STOCK_STATUS[row.status].labelKey),
              width: 12,
            },
          ],
          rows,
          totals: [
            t('common.total'),
            null,
            null,
            null,
            rows.reduce((sum, row) => sum + row.quantity, 0),
            null,
            null,
            rows.reduce((sum, row) => sum + row.stockValue, 0),
            null,
          ],
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
