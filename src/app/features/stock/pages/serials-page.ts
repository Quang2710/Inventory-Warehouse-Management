import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';

import type { SerialStatus, SerialUnit } from '../../../core/api';
import { DOCUMENT_ROUTES, SERIAL_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import {
  injectPagedList,
  toApiQuery,
  type ListFilters,
} from '../../../shared/data-access/paged-list';
import { StockApi } from '../../../shared/data-access/stock.api';
import { WarehouseLookup } from '../../../shared/data-access/warehouse-lookup';
import {
  CellTemplate,
  DataTable,
  type TableColumn,
} from '../../../shared/ui/data-table/data-table';
import { SearchField } from '../../../shared/ui/search-field/search-field';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';

const COLUMNS: readonly TableColumn[] = [
  { key: 'serialNumber', labelKey: 'serials.serialNumber', sortable: true, required: true },
  { key: 'sku', labelKey: 'documents.fields.sku', sortable: true },
  { key: 'productName', labelKey: 'documents.fields.product' },
  { key: 'warehouseName', labelKey: 'stock.fields.warehouse' },
  { key: 'locationCode', labelKey: 'documents.fields.location', sortable: true },
  { key: 'receivedAt', labelKey: 'serials.receivedAt', sortable: true },
  { key: 'lastDocumentCode', labelKey: 'serials.lastDocument' },
  { key: 'status', labelKey: 'common.status', sortable: true },
];

interface Filters extends ListFilters {
  warehouseId: string | null;
  status: string | null;
}

/** Tra cứu serial: đang ở đâu, xuất cho chứng từ nào. */
@Component({
  selector: 'app-serials-page',
  imports: [
    DatePipe,
    RouterLink,
    MatFormFieldModule,
    MatSelectModule,
    TranslatePipe,
    DataTable,
    CellTemplate,
    SearchField,
    StatusChip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-data-table
      tableId="serials"
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
      [ariaLabel]="'stock.tabs.serials' | t"
      emptyIcon="qr_code_2"
      (page)="list.setPage($event.pageIndex, $event.pageSize)"
      (sortChange)="list.setSort($event)"
      (retry)="list.reload()"
    >
      <ng-container filters>
        <app-search-field
          [value]="list.params().q"
          [placeholder]="'serials.searchPlaceholder' | t"
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
      </ng-container>

      <ng-template appCell="serialNumber" [appCellOf]="list.items()" let-row
        ><span class="mono">{{ row.serialNumber }}</span></ng-template
      >
      <ng-template appCell="sku" [appCellOf]="list.items()" let-row
        ><span class="mono">{{ row.sku }}</span></ng-template
      >
      <ng-template appCell="warehouseName" [appCellOf]="list.items()" let-row>{{
        row.warehouseName ?? '—'
      }}</ng-template>
      <ng-template appCell="locationCode" [appCellOf]="list.items()" let-row
        ><span class="mono">{{ row.locationCode ?? '—' }}</span></ng-template
      >
      <ng-template appCell="receivedAt" [appCellOf]="list.items()" let-row>{{
        row.receivedAt | date
      }}</ng-template>
      <ng-template appCell="lastDocumentCode" [appCellOf]="list.items()" let-row>
        @if (documentLink(row); as link) {
          <a class="mono" [routerLink]="link">{{ row.lastDocumentCode }}</a>
        } @else {
          <span class="mono">{{ row.lastDocumentCode ?? '—' }}</span>
        }
      </ng-template>
      <ng-template appCell="status" [appCellOf]="list.items()" let-row
        ><app-status-chip [status]="statusLabels[row.status]"
      /></ng-template>
    </app-data-table>
  `,
})
export class SerialsPage {
  private readonly api = inject(StockApi);
  protected readonly warehouses = inject(WarehouseLookup);

  protected readonly columns = COLUMNS;
  protected readonly statusLabels = SERIAL_STATUS;
  protected readonly statusOptions = Object.keys(SERIAL_STATUS) as SerialStatus[];

  protected readonly list = injectPagedList<SerialUnit, Filters>({
    filters: { warehouseId: null, status: null },
    sort: { active: 'receivedAt', direction: 'desc' },
    fetch: (params) => this.api.serials(toApiQuery(params)),
  });

  constructor() {
    void this.warehouses.ensureLoaded();
  }

  protected documentLink(unit: SerialUnit): string[] | null {
    const path = unit.lastDocumentType ? DOCUMENT_ROUTES[unit.lastDocumentType] : null;
    return path && unit.lastDocumentId ? [path, unit.lastDocumentId] : null;
  }
}
