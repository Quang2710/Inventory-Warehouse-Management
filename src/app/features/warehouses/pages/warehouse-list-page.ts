import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { Warehouse, WarehouseStatus } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import { WAREHOUSE_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { injectPagedList, toApiQuery } from '../../../shared/data-access/paged-list';
import { WarehousesApi } from '../../../shared/data-access/warehouses.api';
import {
  CellTemplate,
  DataTable,
  type TableColumn,
} from '../../../shared/ui/data-table/data-table';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { SearchField } from '../../../shared/ui/search-field/search-field';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';
import { WarehouseFormDialog } from '../components/warehouse-form-dialog';

const COLUMNS: readonly TableColumn[] = [
  { key: 'code', labelKey: 'warehouses.fields.code', sortable: true, required: true },
  { key: 'name', labelKey: 'warehouses.fields.name', sortable: true, required: true },
  { key: 'address', labelKey: 'warehouses.fields.address', hidden: true },
  { key: 'managerName', labelKey: 'warehouses.fields.managerName' },
  { key: 'binCount', labelKey: 'warehouses.columns.bins', sortable: true, align: 'end' },
  { key: 'skuCount', labelKey: 'warehouses.columns.skus', sortable: true, align: 'end' },
  { key: 'totalQuantity', labelKey: 'warehouses.columns.quantity', sortable: true, align: 'end' },
  { key: 'totalValue', labelKey: 'warehouses.columns.value', sortable: true, align: 'end' },
  { key: 'status', labelKey: 'warehouses.fields.status', sortable: true },
];

@Component({
  selector: 'app-warehouse-list-page',
  imports: [
    DecimalPipe,
    CurrencyPipe,
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './warehouse-list-page.html',
})
export class WarehouseListPage {
  private readonly api = inject(WarehousesApi);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);

  protected readonly columns = COLUMNS;
  protected readonly statusLabels = WAREHOUSE_STATUS;
  protected readonly statusOptions: WarehouseStatus[] = ['ACTIVE', 'INACTIVE'];
  /** Chỉ người dùng được phân quyền mọi kho mới tạo kho mới. */
  protected readonly canCreate = computed(
    () => this.auth.hasPermission('warehouse:write') && this.auth.warehouseScope() === null,
  );

  protected readonly list = injectPagedList<Warehouse, { status: string | null }>({
    filters: { status: null },
    sort: { active: 'code', direction: 'asc' },
    fetch: (params) => this.api.list(toApiQuery(params)),
  });

  protected openDetail(warehouse: Warehouse): void {
    void this.router.navigate(['/warehouses', warehouse.id]);
  }

  protected async create(): Promise<void> {
    const ref = this.dialog.open<WarehouseFormDialog, undefined, Warehouse>(WarehouseFormDialog, {
      width: '640px',
      maxWidth: 'calc(100vw - 32px)',
    });
    const created = await firstValueFrom(ref.afterClosed());
    if (created) {
      void this.router.navigate(['/warehouses', created.id], { queryParams: { tab: 'locations' } });
    }
  }
}
