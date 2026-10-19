import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';

import type { TransferStatus, TransferSummary } from '../../../core/api';
import { TRANSFER_STATUS } from '../../../core/i18n/labels';
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
import { TransfersApi } from '../data-access/transfers.api';

const COLUMNS: readonly TableColumn[] = [
  { key: 'code', labelKey: 'transfers.fields.code', sortable: true, required: true },
  {
    key: 'route',
    labelKey: 'transfers.fields.route',
    sortable: true,
    sortKey: 'fromWarehouseName',
  },
  { key: 'transferDate', labelKey: 'transfers.fields.transferDate', sortable: true },
  { key: 'expectedDate', labelKey: 'transfers.fields.expectedDate', hidden: true },
  { key: 'lineCount', labelKey: 'transfers.fields.lines', align: 'end' },
  {
    key: 'totalQuantity',
    labelKey: 'transfers.fields.totalQuantity',
    sortable: true,
    align: 'end',
  },
  { key: 'createdBy', labelKey: 'common.createdBy' },
  { key: 'status', labelKey: 'common.status', sortable: true },
];

@Component({
  selector: 'app-transfer-list-page',
  imports: [
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
    HasPermissionDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transfer-list-page.html',
  styles: `
    .route {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .route mat-icon {
      width: 16px;
      height: 16px;
      font-size: 16px;
      color: var(--mat-sys-on-surface-variant);
    }
    .short {
      color: var(--mat-sys-error);
    }
  `,
})
export class TransferListPage {
  private readonly api = inject(TransfersApi);
  private readonly router = inject(Router);
  protected readonly warehouses = inject(WarehouseLookup);

  protected readonly columns = COLUMNS;
  protected readonly statusLabels = TRANSFER_STATUS;
  protected readonly statusOptions = Object.keys(TRANSFER_STATUS) as TransferStatus[];

  protected readonly list = injectPagedList<
    TransferSummary,
    { status: string | null; fromWarehouseId: string | null; toWarehouseId: string | null }
  >({
    filters: { status: null, fromWarehouseId: null, toWarehouseId: null },
    sort: { active: 'createdAt', direction: 'desc' },
    fetch: (params) => this.api.list(toApiQuery(params)),
  });

  constructor() {
    void this.warehouses.ensureLoaded();
  }

  protected open(transfer: TransferSummary): void {
    void this.router.navigate(['/transfers', transfer.id]);
  }
}
