import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';

import type { DocumentStatus, GoodsReceiptSummary } from '../../../core/api';
import { I18nService } from '../../../core/i18n/i18n.service';
import { DOCUMENT_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import {
  injectPagedList,
  toApiQuery,
  type ListFilters,
} from '../../../shared/data-access/paged-list';
import { WarehouseLookup } from '../../../shared/data-access/warehouse-lookup';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
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
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';
import { GoodsReceiptsApi } from '../data-access/goods-receipts.api';

const COLUMNS: readonly TableColumn[] = [
  { key: 'code', labelKey: 'receipts.fields.code', sortable: true, required: true },
  { key: 'receiptDate', labelKey: 'receipts.fields.receiptDate', sortable: true },
  { key: 'warehouseName', labelKey: 'receipts.fields.warehouse', sortable: true },
  { key: 'supplierName', labelKey: 'receipts.fields.supplier', sortable: true },
  { key: 'referenceNo', labelKey: 'receipts.fields.referenceNo', hidden: true },
  { key: 'lineCount', labelKey: 'documents.fields.lines', align: 'end' },
  {
    key: 'totalQuantity',
    labelKey: 'documents.fields.totalQuantity',
    sortable: true,
    align: 'end',
  },
  { key: 'totalAmount', labelKey: 'receipts.fields.totalAmount', sortable: true, align: 'end' },
  { key: 'createdBy', labelKey: 'common.createdBy', hidden: true },
  { key: 'status', labelKey: 'common.status', sortable: true },
];

interface Filters extends ListFilters {
  status: string | null;
  warehouseId: string | null;
  from: string | null;
  to: string | null;
}

@Component({
  selector: 'app-receipt-list-page',
  imports: [
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
    TranslatePipe,
    PageHeader,
    DataTable,
    CellTemplate,
    SearchField,
    StatusChip,
    DateRangeField,
    ExportMenu,
    HasPermissionDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './receipt-list-page.html',
})
export class ReceiptListPage {
  private readonly api = inject(GoodsReceiptsApi);
  private readonly router = inject(Router);
  private readonly exporter = inject(ExportService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  protected readonly warehouses = inject(WarehouseLookup);

  protected readonly columns = COLUMNS;
  protected readonly statusLabels = DOCUMENT_STATUS;
  protected readonly statusOptions = Object.keys(DOCUMENT_STATUS) as DocumentStatus[];
  protected readonly exporting = signal(false);

  protected readonly list = injectPagedList<GoodsReceiptSummary, Filters>({
    filters: { status: null, warehouseId: null, from: null, to: null },
    sort: { active: 'createdAt', direction: 'desc' },
    fetch: (params) => this.api.list(toApiQuery(params)),
  });

  constructor() {
    void this.warehouses.ensureLoaded();
  }

  protected setRange(range: DateRange): void {
    this.list.setFilter('from', range.from);
    this.list.setFilter('to', range.to);
  }

  protected open(receipt: GoodsReceiptSummary): void {
    void this.router.navigate(['/goods-receipts', receipt.id]);
  }

  protected async export(format: ExportFormat): Promise<void> {
    this.exporting.set(true);
    try {
      const params = this.list.params();
      const rows = await fetchAllPages((page, size) =>
        this.api.list(toApiQuery({ ...params, page, size })),
      );
      const t = (key: Parameters<I18nService['t']>[0]) => this.i18n.t(key);
      const { filters } = params;
      await this.exporter.export(
        {
          fileName: 'phieu-nhap',
          title: t('receipts.title'),
          subtitle: [
            filters.warehouseId
              ? `${t('receipts.fields.warehouse')}: ${this.warehouses.name(filters.warehouseId)}`
              : '',
            filters.from
              ? `${t('common.dateRange')}: ${formatDateVn(filters.from)} – ${formatDateVn(filters.to)}`
              : '',
          ].filter(Boolean),
          columns: [
            { header: t('receipts.fields.code'), value: (row) => row.code, width: 16 },
            {
              header: t('receipts.fields.receiptDate'),
              value: (row) => row.receiptDate,
              type: 'date',
              width: 11,
            },
            {
              header: t('receipts.fields.warehouse'),
              value: (row) => row.warehouseName,
              width: 18,
            },
            { header: t('receipts.fields.supplier'), value: (row) => row.supplierName, width: 26 },
            {
              header: t('receipts.fields.referenceNo'),
              value: (row) => row.referenceNo,
              width: 16,
            },
            {
              header: t('documents.fields.totalQuantity'),
              value: (row) => row.totalQuantity,
              type: 'number',
              width: 10,
            },
            {
              header: t('receipts.fields.totalAmount'),
              value: (row) => row.totalAmount,
              type: 'money',
              width: 14,
            },
            {
              header: t('common.status'),
              value: (row) => t(DOCUMENT_STATUS[row.status].labelKey),
              width: 12,
            },
          ],
          rows,
          totals: [
            t('common.total'),
            null,
            null,
            null,
            null,
            rows.reduce((sum, row) => sum + row.totalQuantity, 0),
            rows.reduce((sum, row) => sum + row.totalAmount, 0),
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
