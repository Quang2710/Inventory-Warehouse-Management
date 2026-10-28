import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { tap } from 'rxjs';

import type { AbcClass, AbcReport, AbcRow } from '../../../core/api';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { TranslationKey } from '../../../core/i18n/i18n.types';
import { ABC_CLASS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { ThemeService } from '../../../core/theme/theme.service';
import { chartTheme } from '../../../shared/charts/charts';
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
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';
import { ReportsApi } from '../data-access/reports.api';
import { defaultRange } from './report-range';

const COLUMNS: readonly TableColumn[] = [
  { key: 'rank', labelKey: 'reports.abc.rank', sortable: true, required: true, align: 'end' },
  { key: 'abcClass', labelKey: 'reports.abc.class' },
  { key: 'sku', labelKey: 'documents.fields.sku', sortable: true },
  { key: 'productName', labelKey: 'documents.fields.product', sortable: true },
  { key: 'categoryName', labelKey: 'stock.fields.category', hidden: true },
  { key: 'quantity', labelKey: 'stock.fields.quantity', sortable: true, align: 'end' },
  { key: 'value', labelKey: 'reports.abc.value', sortable: true, align: 'end' },
  { key: 'share', labelKey: 'reports.share', align: 'end' },
  { key: 'cumulativeShare', labelKey: 'reports.abc.cumulative', align: 'end' },
];

const CLASSES: readonly AbcClass[] = ['A', 'B', 'C'];
const THRESHOLD_A = [70, 80, 90] as const;
const THRESHOLD_B = [90, 95, 98] as const;

interface Filters extends ListFilters {
  basis: string | null;
  warehouseId: string | null;
  abcClass: string | null;
  thresholdA: string | null;
  thresholdB: string | null;
  from: string | null;
  to: string | null;
}
type Summary = Omit<AbcReport, 'items' | 'total' | 'page' | 'size'>;

/** ABC: xếp hạng mặt hàng theo giá trị, A ≈ 80% giá trị — ưu tiên kiểm soát / kiểm kê. */
@Component({
  selector: 'app-abc-page',
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
    StatusChip,
    DateRangeField,
    ExportMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './abc-page.html',
  styles: `
    .chart {
      height: 300px;
    }
    .class-tile {
      border-left: 4px solid var(--tile-color);
    }
  `,
})
export class AbcPage {
  private readonly api = inject(ReportsApi);
  private readonly exporter = inject(ExportService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly theme = inject(ThemeService);
  protected readonly warehouses = inject(WarehouseLookup);

  protected readonly columns = COLUMNS;
  protected readonly classes = CLASSES;
  protected readonly classLabels = ABC_CLASS;
  protected readonly thresholdAOptions = THRESHOLD_A;
  protected readonly thresholdBOptions = THRESHOLD_B;
  protected readonly summary = signal<Summary | null>(null);
  protected readonly exporting = signal(false);
  protected readonly colors = computed(() => chartTheme(this.theme.isDark()));
  private readonly defaults = defaultRange(90);

  protected readonly list = injectPagedList<AbcRow, Filters>({
    filters: {
      basis: null,
      warehouseId: null,
      abcClass: null,
      thresholdA: null,
      thresholdB: null,
      from: this.defaults.from,
      to: this.defaults.to,
    },
    sort: { active: 'rank', direction: 'asc' },
    size: 50,
    fetch: (params) =>
      this.api
        .abc(this.query(params))
        .pipe(
          tap(({ items: _items, total: _total, page: _page, size: _size, ...summary }) =>
            this.summary.set(summary),
          ),
        ),
  });

  protected readonly basis = computed(() => this.list.params().filters.basis ?? 'ISSUE_VALUE');

  /** Đường Pareto (một trục %): vùng A/B/C tô nhạt + nhãn trực tiếp, đường ngưỡng. */
  protected readonly chart = computed<EChartsCoreOption | null>(() => {
    const summary = this.summary();
    if (!summary || summary.pareto.length === 0) return null;
    const colors = this.colors();
    const counts = summary.classes.map((item) => item.productCount);
    const bands = CLASSES.map((abcClass, index) => {
      const start = counts.slice(0, index).reduce((sum, count) => sum + count, 0);
      return {
        abcClass,
        start: start + 1,
        end: start + counts[index],
        color: colors.series[index],
      };
    }).filter((band) => band.end >= band.start);
    const tierLabel = (abcClass: AbcClass) => this.i18n.t(ABC_CLASS[abcClass].labelKey);
    return {
      aria: { enabled: true },
      grid: { left: 8, right: 40, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        formatter: (params: { dataIndex: number; value: number }[]) => {
          const rank = params[0].dataIndex + 1;
          const band = bands.find((item) => rank >= item.start && rank <= item.end);
          return `${this.i18n.t('reports.abc.rankLabel', { rank })}${band ? ` · ${tierLabel(band.abcClass)}` : ''}<br/><b>${params[0].value.toFixed(1)}%</b> ${this.i18n.t('reports.abc.cumulative')}`;
        },
      },
      xAxis: {
        type: 'category',
        data: summary.pareto.map((_, index) => index + 1),
        axisLabel: { color: colors.muted },
        axisLine: { lineStyle: { color: colors.grid } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { color: colors.muted, formatter: '{value}%' },
        splitLine: { lineStyle: { color: colors.grid } },
      },
      series: [
        {
          type: 'line',
          name: this.i18n.t('reports.abc.cumulative'),
          data: summary.pareto,
          showSymbol: false,
          smooth: false,
          lineStyle: { width: 2, color: colors.text },
          itemStyle: { color: colors.text },
          markArea: {
            silent: true,
            data: bands.map((band) => [
              {
                xAxis: band.start - 1,
                itemStyle: { color: band.color, opacity: 0.16 },
                label: {
                  show: true,
                  position: 'insideBottom',
                  distance: 12,
                  fontSize: 14,
                  color: colors.text,
                  fontWeight: 600,
                  formatter: band.abcClass,
                },
              },
              { xAxis: band.end - 1 },
            ]),
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { type: 'dashed', color: colors.muted, width: 1 },
            label: { color: colors.muted, formatter: '{c}%' },
            data: [{ yAxis: summary.thresholdA }, { yAxis: summary.thresholdB }],
          },
        },
      ],
    };
  });

  constructor() {
    void this.warehouses.ensureLoaded();
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

  protected setThresholdA(value: string): void {
    const b = Number(this.list.params().filters.thresholdB ?? 95);
    if (Number(value) >= b)
      this.list.setFilter('thresholdB', String(THRESHOLD_B.find((x) => x > Number(value)) ?? 98));
    this.list.setFilter('thresholdA', value);
  }

  protected async export(format: ExportFormat): Promise<void> {
    this.exporting.set(true);
    try {
      const params = this.list.params();
      const rows = await fetchAllPages((page, size) =>
        this.api.abc(this.query({ ...params, page, size })),
      );
      const t = (key: TranslationKey) => this.i18n.t(key);
      const summary = this.summary();
      await this.exporter.export(
        {
          fileName: 'phan-tich-abc',
          title: t('reports.abc.title'),
          subtitle: [
            `${t('reports.abc.basis')}: ${t(this.basis() === 'STOCK_VALUE' ? 'reports.abc.basisStock' : 'reports.abc.basisIssue')}`,
            ...(this.basis() === 'ISSUE_VALUE' && summary
              ? [
                  `${t('common.dateRange')}: ${formatDateVn(summary.from)} – ${formatDateVn(summary.to)}`,
                ]
              : []),
            ...(summary
              ? summary.classes.map((item) =>
                  this.i18n.t('reports.abc.classSummary', {
                    class: item.abcClass,
                    count: item.productCount,
                    share: item.valueShare.toFixed(1),
                  }),
                )
              : []),
          ],
          columns: [
            { header: t('reports.abc.rank'), value: (row) => row.rank, type: 'number', width: 6 },
            { header: t('reports.abc.class'), value: (row) => row.abcClass, width: 6 },
            { header: t('documents.fields.sku'), value: (row) => row.sku, width: 13 },
            { header: t('documents.fields.product'), value: (row) => row.productName, width: 28 },
            { header: t('stock.fields.category'), value: (row) => row.categoryName, width: 16 },
            {
              header: t('stock.fields.quantity'),
              value: (row) => row.quantity,
              type: 'number',
              width: 9,
            },
            { header: t('reports.abc.value'), value: (row) => row.value, type: 'money', width: 14 },
            { header: t('reports.share'), value: (row) => row.share, type: 'percent', width: 8 },
            {
              header: t('reports.abc.cumulative'),
              value: (row) => row.cumulativeShare,
              type: 'percent',
              width: 9,
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
