import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';

import type { ExpiryStatus, StockLot } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { TranslationKey } from '../../../core/i18n/i18n.types';
import { EXPIRY_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
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
import { ExpiryBadge } from '../../../shared/ui/expiry-badge/expiry-badge';
import { ExportMenu } from '../../../shared/ui/export-menu/export-menu';
import { SearchField } from '../../../shared/ui/search-field/search-field';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';

const COLUMNS: readonly TableColumn[] = [
  { key: 'expiryDate', labelKey: 'lots.expiryDate', sortable: true, required: true },
  { key: 'lotNumber', labelKey: 'lots.lotNumber', sortable: true },
  { key: 'sku', labelKey: 'documents.fields.sku', sortable: true },
  { key: 'productName', labelKey: 'documents.fields.product', sortable: true },
  { key: 'warehouseName', labelKey: 'stock.fields.warehouse', sortable: true },
  { key: 'locationCode', labelKey: 'documents.fields.location', sortable: true },
  { key: 'quantity', labelKey: 'stock.fields.quantity', sortable: true, align: 'end' },
  { key: 'receivedAt', labelKey: 'lots.receivedAt', sortable: true, hidden: true },
  { key: 'expiryStatus', labelKey: 'common.status' },
];

/** Ngưỡng "sắp hết hạn" chọn nhanh (ngày). */
const EXPIRING_DAY_OPTIONS = [7, 15, 30, 60, 90] as const;

interface Filters extends ListFilters {
  warehouseId: string | null;
  expiryStatus: string | null;
  days: string | null;
}

/** Tồn theo lô / hạn sử dụng, sắp theo FEFO (hết hạn trước lên đầu). */
@Component({
  selector: 'app-stock-lots-page',
  imports: [
    DatePipe,
    DecimalPipe,
    MatFormFieldModule,
    MatSelectModule,
    TranslatePipe,
    DataTable,
    CellTemplate,
    SearchField,
    StatusChip,
    ExpiryBadge,
    ExportMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-data-table
      tableId="stock-lots"
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
      [ariaLabel]="'stock.tabs.lots' | t"
      emptyIcon="event"
      (page)="list.setPage($event.pageIndex, $event.pageSize)"
      (sortChange)="list.setSort($event)"
      (rowClick)="openCard($event)"
      (retry)="list.reload()"
    >
      <ng-container filters>
        <app-search-field
          [value]="list.params().q"
          [placeholder]="'lots.searchPlaceholder' | t"
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
          <mat-label>{{ 'lots.expiryStatus' | t }}</mat-label>
          <mat-select
            [value]="list.params().filters.expiryStatus"
            (valueChange)="list.setFilter('expiryStatus', $event)"
          >
            <mat-option [value]="null">{{ 'common.all' | t }}</mat-option>
            @for (status of statusOptions; track status) {
              <mat-option [value]="status">{{ statusLabels[status].labelKey | t }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>{{ 'lots.expiringWithin' | t }}</mat-label>
          <mat-select
            [value]="list.params().filters.days ?? '30'"
            (valueChange)="list.setFilter('days', $event)"
          >
            @for (days of dayOptions; track days) {
              <mat-option [value]="'' + days">{{ 'lots.days' | t: { days } }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <app-export-menu
          [busy]="exporting()"
          [disabled]="list.total() === 0"
          (export)="export($event)"
        />
      </ng-container>

      <ng-template appCell="expiryDate" [appCellOf]="list.items()" let-row
        ><app-expiry-badge [date]="row.expiryDate"
      /></ng-template>
      <ng-template appCell="lotNumber" [appCellOf]="list.items()" let-row
        ><span class="mono">{{ row.lotNumber ?? '—' }}</span></ng-template
      >
      <ng-template appCell="sku" [appCellOf]="list.items()" let-row
        ><span class="mono">{{ row.sku }}</span></ng-template
      >
      <ng-template appCell="locationCode" [appCellOf]="list.items()" let-row
        ><span class="mono">{{ row.locationCode ?? '—' }}</span></ng-template
      >
      <ng-template appCell="quantity" [appCellOf]="list.items()" let-row
        >{{ row.quantity | number }} {{ row.unit }}</ng-template
      >
      <ng-template appCell="receivedAt" [appCellOf]="list.items()" let-row>{{
        row.receivedAt | date: 'dd/MM/yyyy HH:mm'
      }}</ng-template>
      <ng-template appCell="expiryStatus" [appCellOf]="list.items()" let-row
        ><app-status-chip [status]="statusLabels[row.expiryStatus]"
      /></ng-template>
    </app-data-table>
  `,
})
export class StockLotsPage {
  private readonly api = inject(StockApi);
  private readonly router = inject(Router);
  private readonly exporter = inject(ExportService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  protected readonly warehouses = inject(WarehouseLookup);

  protected readonly columns = COLUMNS;
  protected readonly statusLabels = EXPIRY_STATUS;
  protected readonly statusOptions = Object.keys(EXPIRY_STATUS) as ExpiryStatus[];
  protected readonly dayOptions = EXPIRING_DAY_OPTIONS;
  protected readonly canOpenCard = inject(AuthStore).hasPermission('stock-movement:read');
  protected readonly exporting = signal(false);

  protected readonly list = injectPagedList<StockLot, Filters>({
    filters: { warehouseId: null, expiryStatus: null, days: null },
    sort: { active: 'expiryDate', direction: 'asc' },
    fetch: (params) => this.api.lots(toApiQuery(params)),
  });

  constructor() {
    void this.warehouses.ensureLoaded();
  }

  protected openCard(lot: StockLot): void {
    void this.router.navigate(['/stock-movements'], {
      queryParams: {
        productId: lot.productId,
        warehouseId: lot.warehouseId,
        lotNumber: lot.lotNumber ?? null,
      },
    });
  }

  protected async export(format: ExportFormat): Promise<void> {
    this.exporting.set(true);
    try {
      const params = this.list.params();
      const rows = await fetchAllPages((page, size) =>
        this.api.lots(toApiQuery({ ...params, page, size })),
      );
      const t = (key: TranslationKey) => this.i18n.t(key);
      await this.exporter.export(
        {
          fileName: 'ton-theo-lo',
          title: t('lots.exportTitle'),
          subtitle: params.filters.warehouseId
            ? [
                `${t('stock.fields.warehouse')}: ${this.warehouses.name(params.filters.warehouseId)}`,
              ]
            : [],
          columns: [
            {
              header: t('lots.expiryDate'),
              value: (row) => row.expiryDate,
              type: 'date',
              width: 11,
            },
            {
              header: t('lots.daysToExpiry'),
              value: (row) => row.daysToExpiry,
              type: 'number',
              width: 9,
            },
            { header: t('lots.lotNumber'), value: (row) => row.lotNumber, width: 14 },
            { header: t('documents.fields.sku'), value: (row) => row.sku, width: 14 },
            { header: t('documents.fields.product'), value: (row) => row.productName, width: 28 },
            { header: t('stock.fields.warehouse'), value: (row) => row.warehouseName, width: 16 },
            { header: t('documents.fields.location'), value: (row) => row.locationCode, width: 11 },
            {
              header: t('stock.fields.quantity'),
              value: (row) => row.quantity,
              type: 'number',
              width: 9,
            },
            {
              header: t('common.status'),
              value: (row) => t(EXPIRY_STATUS[row.expiryStatus].labelKey),
              width: 12,
            },
          ],
          rows,
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
