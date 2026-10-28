import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';

import type { Alert, AlertType } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { TranslationKey } from '../../../core/i18n/i18n.types';
import { ALERT_TYPE } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import {
  injectPagedList,
  toApiQuery,
  type ListFilters,
} from '../../../shared/data-access/paged-list';
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
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { SearchField } from '../../../shared/ui/search-field/search-field';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';
import { AlertsStore } from '../data-access/alerts.store';
import { AlertsApi } from '../data-access/alerts.api';

const COLUMNS: readonly TableColumn[] = [
  { key: 'type', labelKey: 'alerts.fields.type', sortable: true, required: true },
  { key: 'sku', labelKey: 'documents.fields.sku', sortable: true },
  { key: 'productName', labelKey: 'documents.fields.product', sortable: true },
  { key: 'warehouseName', labelKey: 'stock.fields.warehouse', sortable: true },
  { key: 'quantity', labelKey: 'stock.fields.quantity', sortable: true, align: 'end' },
  { key: 'detail', labelKey: 'alerts.fields.detail' },
  { key: 'locationCode', labelKey: 'documents.fields.location', hidden: true },
  { key: 'value', labelKey: 'alerts.fields.value', sortable: true, align: 'end' },
  { key: 'actions', labelKey: 'common.actions', required: true, align: 'end' },
];

const DAY_OPTIONS = [7, 15, 30, 60, 90] as const;
const TYPES = Object.keys(ALERT_TYPE) as AlertType[];

interface Filters extends ListFilters {
  type: string | null;
  warehouseId: string | null;
  days: string | null;
}

@Component({
  selector: 'app-alerts-page',
  imports: [
    CurrencyPipe,
    DecimalPipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
    MatTooltipModule,
    TranslatePipe,
    PageHeader,
    DataTable,
    CellTemplate,
    SearchField,
    StatusChip,
    ExpiryBadge,
    ExportMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alerts-page.html',
  styles: `
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .tile {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-low);
      color: inherit;
      text-align: start;
      font: inherit;
      cursor: pointer;
    }
    .tile[aria-pressed='true'] {
      border-color: var(--mat-sys-primary);
      background: var(--mat-sys-primary-container);
    }
    .tile mat-icon {
      color: var(--mat-sys-on-surface-variant);
    }
    .tile.danger mat-icon {
      color: var(--mat-sys-error);
    }
    .tile .count {
      display: block;
      font: var(--mat-sys-headline-small);
    }
    .type {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
  `,
})
export class AlertsPage {
  private readonly api = inject(AlertsApi);
  private readonly exporter = inject(ExportService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthStore);
  protected readonly store = inject(AlertsStore);
  protected readonly warehouses = inject(WarehouseLookup);

  protected readonly columns = COLUMNS;
  protected readonly types = TYPES;
  protected readonly typeLabels = ALERT_TYPE;
  protected readonly dayOptions = DAY_OPTIONS;
  protected readonly exporting = signal(false);
  protected readonly canReceive = this.auth.hasPermission('goods-receipt:write');
  protected readonly canIssue = this.auth.hasPermission('goods-issue:write');

  protected readonly list = injectPagedList<Alert, Filters>({
    filters: { type: null, warehouseId: null, days: null },
    fetch: (params) =>
      this.api.list(
        toApiQuery({
          ...params,
          filters: {
            ...params.filters,
            days: params.filters.days ?? String(this.store.expiringDays()),
          },
        }),
      ),
  });

  protected readonly days = computed(() =>
    Number(this.list.params().filters.days ?? this.store.expiringDays()),
  );
  protected readonly counts = computed<Record<AlertType, number>>(() => {
    const summary = this.store.summary();
    return {
      EXPIRED: summary?.expired ?? 0,
      OUT_OF_STOCK: summary?.outOfStock ?? 0,
      EXPIRING: summary?.expiring ?? 0,
      LOW_STOCK: summary?.lowStock ?? 0,
    };
  });

  constructor() {
    void this.warehouses.ensureLoaded();
    void this.store.refresh();
  }

  protected toggleType(type: AlertType): void {
    this.list.setFilter('type', this.list.params().filters.type === type ? null : type);
  }

  protected setDays(days: string): void {
    this.store.setExpiringDays(Number(days));
    this.list.setFilter('days', days);
  }

  protected async export(format: ExportFormat): Promise<void> {
    this.exporting.set(true);
    try {
      const params = this.list.params();
      const filters = { ...params.filters, days: String(this.days()) };
      const rows = await fetchAllPages((page, size) =>
        this.api.list(toApiQuery({ ...params, filters, page, size })),
      );
      const t = (key: TranslationKey) => this.i18n.t(key);
      await this.exporter.export(
        {
          fileName: 'canh-bao-ton-kho',
          title: t('alerts.title'),
          subtitle: [this.i18n.t('alerts.expiringWithin', { days: this.days() })],
          columns: [
            {
              header: t('alerts.fields.type'),
              value: (row) => t(ALERT_TYPE[row.type].labelKey),
              width: 14,
            },
            { header: t('documents.fields.sku'), value: (row) => row.sku, width: 14 },
            { header: t('documents.fields.product'), value: (row) => row.productName, width: 28 },
            { header: t('stock.fields.warehouse'), value: (row) => row.warehouseName, width: 16 },
            {
              header: t('stock.fields.quantity'),
              value: (row) => row.quantity,
              type: 'number',
              width: 9,
            },
            {
              header: t('stock.fields.minStock'),
              value: (row) => row.minStock,
              type: 'number',
              width: 9,
            },
            {
              header: t('alerts.fields.suggested'),
              value: (row) => row.suggestedQuantity,
              type: 'number',
              width: 10,
            },
            { header: t('lots.lotNumber'), value: (row) => row.lotNumber, width: 12 },
            {
              header: t('lots.expiryDate'),
              value: (row) => row.expiryDate,
              type: 'date',
              width: 11,
            },
            {
              header: t('alerts.fields.value'),
              value: (row) => row.value,
              type: 'money',
              width: 13,
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
