import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';

import type { AuditAction, AuditEntityType, AuditLog } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import { AUDIT_ACTION_LABEL_KEYS, AUDIT_ENTITY_LABEL_KEYS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { injectPagedList, toApiQuery } from '../../../shared/data-access/paged-list';
import {
  CellTemplate,
  DataTable,
  type TableColumn,
} from '../../../shared/ui/data-table/data-table';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { SearchField } from '../../../shared/ui/search-field/search-field';
import { AuditDetailDialog } from '../components/audit-detail-dialog';
import { AuditLogsApi } from '../data-access/audit-logs.api';
import { fromLocalDate, toLocalDate } from '../../../shared/forms/date-utils';

const COLUMNS: readonly TableColumn[] = [
  { key: 'occurredAt', labelKey: 'audit.fields.occurredAt', sortable: true, required: true },
  { key: 'userName', labelKey: 'audit.fields.user', sortable: true },
  { key: 'action', labelKey: 'audit.fields.action', sortable: true },
  { key: 'entityType', labelKey: 'audit.fields.entityType', sortable: true },
  { key: 'entityLabel', labelKey: 'audit.fields.entity' },
  { key: 'summary', labelKey: 'audit.fields.summary', required: true },
  { key: 'ipAddress', labelKey: 'audit.fields.ipAddress', hidden: true },
];

/** Đường dẫn tới đối tượng của bản ghi (nếu có màn hình chi tiết và đủ quyền). */
const ENTITY_ROUTES: Partial<
  Record<AuditEntityType, { path: string; permission: Parameters<AuthStore['hasPermission']>[0] }>
> = {
  TRANSFER: { path: '/transfers', permission: 'transfer:read' },
  STOCKTAKE: { path: '/stocktakes', permission: 'stocktake:read' },
  WAREHOUSE: { path: '/warehouses', permission: 'warehouse:read' },
};

@Component({
  selector: 'app-audit-log-page',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    TranslatePipe,
    PageHeader,
    DataTable,
    CellTemplate,
    SearchField,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './audit-log-page.html',
  styles: `
    .action {
      font: var(--mat-sys-label-large);
    }
    .action--LOGIN_FAILED,
    .action--DELETE,
    .action--CANCEL,
    .action--REJECT {
      color: var(--mat-sys-error);
    }
    .summary {
      display: inline-block;
      max-width: 520px;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: bottom;
    }
    .date {
      width: 150px;
    }
  `,
})
export class AuditLogPage {
  private readonly api = inject(AuditLogsApi);
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthStore);

  protected readonly columns = COLUMNS;
  protected readonly actionLabels = AUDIT_ACTION_LABEL_KEYS;
  protected readonly entityLabels = AUDIT_ENTITY_LABEL_KEYS;
  protected readonly actionOptions = Object.keys(AUDIT_ACTION_LABEL_KEYS) as AuditAction[];
  protected readonly entityOptions = Object.keys(AUDIT_ENTITY_LABEL_KEYS) as AuditEntityType[];

  protected readonly list = injectPagedList<
    AuditLog,
    { action: string | null; entityType: string | null; from: string | null; to: string | null }
  >({
    filters: { action: null, entityType: null, from: null, to: null },
    sort: { active: 'occurredAt', direction: 'desc' },
    size: 50,
    fetch: (params) => this.api.list(toApiQuery(params)),
  });

  protected readonly fromDate = computed(() => fromLocalDate(this.list.params().filters.from));
  protected readonly toDate = computed(() => fromLocalDate(this.list.params().filters.to));

  protected setDate(key: 'from' | 'to', value: Date | null): void {
    this.list.setFilter(key, value ? toLocalDate(value) : null);
  }

  protected entityLink(entry: AuditLog): string | null {
    const route = ENTITY_ROUTES[entry.entityType];
    return route && entry.entityId && this.auth.hasPermission(route.permission)
      ? `${route.path}/${entry.entityId}`
      : null;
  }

  protected open(entry: AuditLog): void {
    this.dialog.open(AuditDetailDialog, {
      data: entry,
      width: '720px',
      maxWidth: 'calc(100vw - 32px)',
    });
  }
}
