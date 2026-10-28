import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { tap } from 'rxjs';

import type { StockValuePage, StockValueRow } from '../../../core/api';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { TranslationKey } from '../../../core/i18n/i18n.types';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { ThemeService } from '../../../core/theme/theme.service';
import { chartTheme } from '../../../shared/charts/charts';
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
  formatMoney,
  type ExportFormat,
} from '../../../shared/export/export.service';
import {
  CellTemplate,
  DataTable,
  type TableColumn,
} from '../../../shared/ui/data-table/data-table';
import { ExportMenu } from '../../../shared/ui/export-menu/export-menu';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { SearchField } from '../../../shared/ui/search-field/search-field';
import { ReportsApi } from '../data-access/reports.api';

const COLUMNS: readonly TableColumn[] = [
  { key: 'sku', labelKey: 'documents.fields.sku', sortable: true, required: true },
  { key: 'productName', labelKey: 'documents.fields.product', sortable: true },
  { key: 'categoryName', labelKey: 'stock.fields.category', sortable: true },
  { key: 'quantity', labelKey: 'stock.fields.quantity', sortable: true, align: 'end' },
  { key: 'averageCost', labelKey: 'stock.fields.averageCost', sortable: true, align: 'end' },
  { key: 'value', labelKey: 'stock.fields.stockValue', sortable: true, align: 'end' },
  { key: 'share', labelKey: 'reports.share', align: 'end' },
];

/** Số nhóm hàng hiện trên biểu đồ; phần còn lại gộp "Khác". */
const TOP_GROUPS = 8;

interface Filters extends ListFilters {
  warehouseId: string | null;
  categoryId: string | null;
}
type Summary = Omit<StockValuePage, 'items' | 'total' | 'page' | 'size'>;

const compactMoney = new Intl.NumberFormat('vi-VN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

@Component({
  selector: 'app-stock-value-page',
  imports: [
    CurrencyPipe,
    DecimalPipe,
    MatFormFieldModule,
    MatSelectModule,
    NgxEchartsDirective,
    TranslatePipe,
    PageHeader,
    DataTable,
    CellTemplate,
    SearchField,
    ExportMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stock-value-page.html',
  styles: `
    .charts {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(240px, 1fr);
      gap: 16px;
      margin-bottom: 16px;
    }
    .chart {
      height: 320px;
    }
    .warehouses {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .warehouses li {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    @media (max-width: 959.98px) {
      .charts {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class StockValueReportPage {
  private readonly api = inject(ReportsApi);
  private readonly exporter = inject(ExportService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly theme = inject(ThemeService);
  protected readonly warehouses = inject(WarehouseLookup);
  protected readonly categories = inject(CategoryLookup);

  protected readonly columns = COLUMNS;
  protected readonly summary = signal<Summary | null>(null);
  protected readonly exporting = signal(false);

  protected readonly list = injectPagedList<StockValueRow, Filters>({
    filters: { warehouseId: null, categoryId: null },
    sort: { active: 'value', direction: 'desc' },
    fetch: (params) =>
      this.api
        .stockValue(toApiQuery(params))
        .pipe(
          tap(({ items: _items, total: _total, page: _page, size: _size, ...summary }) =>
            this.summary.set(summary),
          ),
        ),
  });

  /** Cột ngang theo nhóm hàng: một series → không cần chú giải, nhãn giá trị ở đầu cột. */
  protected readonly chart = computed<EChartsCoreOption | null>(() => {
    const summary = this.summary();
    if (!summary || summary.byCategory.length === 0) return null;
    const colors = chartTheme(this.theme.isDark());
    const top = summary.byCategory.slice(0, TOP_GROUPS);
    const rest = summary.byCategory.slice(TOP_GROUPS).reduce((sum, group) => sum + group.value, 0);
    const groups = [
      ...top.map((group) => ({ name: group.name, value: group.value, share: group.share })),
      ...(rest > 0
        ? [
            {
              name: this.i18n.t('reports.others'),
              value: rest,
              share: (rest / summary.totalValue) * 100,
            },
          ]
        : []),
    ].reverse();
    return {
      aria: { enabled: true },
      grid: { left: 8, right: 72, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: { dataIndex: number }[]) => {
          const group = groups[params[0].dataIndex];
          return `${group.name}<br/><b>${formatMoney(group.value)}</b> (${group.share.toFixed(1)}%)`;
        },
      },
      xAxis: {
        type: 'value',
        axisLabel: {
          color: colors.muted,
          formatter: (value: number) => compactMoney.format(value),
        },
        splitLine: { lineStyle: { color: colors.grid } },
      },
      yAxis: {
        type: 'category',
        data: groups.map((group) => group.name),
        axisLabel: { color: colors.text, width: 140, overflow: 'truncate' },
        axisLine: { lineStyle: { color: colors.grid } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: groups.map((group) => group.value),
          barMaxWidth: 18,
          itemStyle: { color: colors.series[0], borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: 'right',
            color: colors.muted,
            formatter: ({ dataIndex }: { dataIndex: number }) =>
              `${groups[dataIndex].share.toFixed(1)}%`,
          },
        },
      ],
    };
  });

  constructor() {
    void this.warehouses.ensureLoaded();
    void this.categories.ensureLoaded();
  }

  protected async export(format: ExportFormat): Promise<void> {
    this.exporting.set(true);
    try {
      const params = this.list.params();
      const rows = await fetchAllPages((page, size) =>
        this.api.stockValue(toApiQuery({ ...params, page, size })),
      );
      const t = (key: TranslationKey) => this.i18n.t(key);
      const summary = this.summary();
      await this.exporter.export(
        {
          fileName: 'gia-tri-ton-kho',
          title: t('reports.stockValue.title'),
          subtitle: [
            `${t('stock.fields.warehouse')}: ${params.filters.warehouseId ? this.warehouses.name(params.filters.warehouseId) : t('reports.allWarehouses')}`,
          ],
          columns: [
            { header: t('documents.fields.sku'), value: (row) => row.sku, width: 13 },
            { header: t('documents.fields.product'), value: (row) => row.productName, width: 28 },
            { header: t('stock.fields.category'), value: (row) => row.categoryName, width: 18 },
            {
              header: t('stock.fields.quantity'),
              value: (row) => row.quantity,
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
              value: (row) => row.value,
              type: 'money',
              width: 14,
            },
            { header: t('reports.share'), value: (row) => row.share, type: 'percent', width: 8 },
          ],
          rows,
          totals: [
            t('common.total'),
            null,
            null,
            summary?.totalQuantity ?? null,
            null,
            summary?.totalValue ?? null,
            100,
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
