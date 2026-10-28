import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { Stocktake, StocktakeStatus, StocktakeSummary } from '../../../core/api';
import { STOCKTAKE_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { injectPagedList, toApiQuery } from '../../../shared/data-access/paged-list';
import { WarehouseLookup } from '../../../shared/data-access/warehouse-lookup';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import {
  CellTemplate,
  DataTable,
  type TableColumn,
} from '../../../shared/ui/data-table/data-table';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { SearchField } from '../../../shared/ui/search-field/search-field';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';
import { StocktakeCreateDialog } from '../components/stocktake-create-dialog';
import { StocktakesApi } from '../data-access/stocktakes.api';

const COLUMNS: readonly TableColumn[] = [
  { key: 'code', labelKey: 'stocktakes.fields.code', sortable: true, required: true },
  { key: 'name', labelKey: 'stocktakes.fields.name', sortable: true },
  { key: 'warehouseName', labelKey: 'stocktakes.fields.warehouse', sortable: true },
  { key: 'scopeLabel', labelKey: 'stocktakes.fields.scope' },
  {
    key: 'progress',
    labelKey: 'stocktakes.fields.progress',
    sortable: true,
    sortKey: 'countedLineCount',
  },
  { key: 'varianceLineCount', labelKey: 'stocktakes.fields.varianceLines', align: 'end' },
  {
    key: 'varianceValue',
    labelKey: 'stocktakes.fields.varianceValue',
    sortable: true,
    align: 'end',
  },
  { key: 'createdAt', labelKey: 'common.createdAt', sortable: true },
  { key: 'status', labelKey: 'common.status', sortable: true },
];

@Component({
  selector: 'app-stocktake-list-page',
  imports: [
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
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
    HasPermissionDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header [heading]="'stocktakes.title' | t" [subtitle]="'stocktakes.subtitle' | t">
      <button
        *hasPermission="'stocktake:write'"
        actions
        mat-flat-button
        type="button"
        (click)="create()"
      >
        <mat-icon>add</mat-icon>{{ 'stocktakes.create' | t }}
      </button>
    </app-page-header>

    <app-data-table
      tableId="stocktakes"
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
      [clickable]="true"
      [ariaLabel]="'stocktakes.title' | t"
      emptyIcon="fact_check"
      (page)="list.setPage($event.pageIndex, $event.pageSize)"
      (sortChange)="list.setSort($event)"
      (rowClick)="open($event)"
      (retry)="list.reload()"
    >
      <ng-container filters>
        <app-search-field
          [value]="list.params().q"
          [placeholder]="'stocktakes.searchPlaceholder' | t"
          (queryChange)="list.setQuery($event)"
        />
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
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>{{ 'stocktakes.fields.warehouse' | t }}</mat-label>
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
      </ng-container>

      <ng-template appCell="code" [appCellOf]="list.items()" let-row
        ><span class="mono">{{ row.code }}</span></ng-template
      >
      <ng-template appCell="progress" [appCellOf]="list.items()" let-row>{{
        'stocktakes.count.progress' | t: { counted: row.countedLineCount, total: row.lineCount }
      }}</ng-template>
      <ng-template appCell="varianceValue" [appCellOf]="list.items()" let-row>{{
        row.varianceValue | currency: 'VND' : 'symbol' : '1.0-0'
      }}</ng-template>
      <ng-template appCell="varianceLineCount" [appCellOf]="list.items()" let-row>{{
        row.varianceLineCount | number
      }}</ng-template>
      <ng-template appCell="createdAt" [appCellOf]="list.items()" let-row>{{
        row.createdAt | date
      }}</ng-template>
      <ng-template appCell="status" [appCellOf]="list.items()" let-row
        ><app-status-chip [status]="statusLabels[row.status]"
      /></ng-template>
    </app-data-table>
  `,
})
export class StocktakeListPage {
  private readonly api = inject(StocktakesApi);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  protected readonly warehouses = inject(WarehouseLookup);

  protected readonly columns = COLUMNS;
  protected readonly statusLabels = STOCKTAKE_STATUS;
  protected readonly statusOptions = Object.keys(STOCKTAKE_STATUS) as StocktakeStatus[];

  protected readonly list = injectPagedList<
    StocktakeSummary,
    { status: string | null; warehouseId: string | null }
  >({
    filters: { status: null, warehouseId: null },
    sort: { active: 'createdAt', direction: 'desc' },
    fetch: (params) => this.api.list(toApiQuery(params)),
  });

  constructor() {
    void this.warehouses.ensureLoaded();
  }

  protected open(stocktake: StocktakeSummary): void {
    void this.router.navigate(['/stocktakes', stocktake.id]);
  }

  protected async create(): Promise<void> {
    const ref = this.dialog.open<StocktakeCreateDialog, unknown, Stocktake>(StocktakeCreateDialog, {
      maxWidth: 'calc(100vw - 32px)',
    });
    const created = await firstValueFrom(ref.afterClosed());
    if (created) await this.router.navigate(['/stocktakes', created.id, 'count']);
  }
}
