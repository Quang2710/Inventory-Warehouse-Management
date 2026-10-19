import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';

import type { Customer, CustomerType, PartnerStatus, Supplier } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { TranslationKey } from '../../../core/i18n/i18n.types';
import { CUSTOMER_TYPE_LABEL_KEYS, PARTNER_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { injectPagedList, toApiQuery } from '../../../shared/data-access/paged-list';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ConfirmService } from '../../../shared/ui/confirm-dialog/confirm.service';
import {
  CellTemplate,
  DataTable,
  type TableColumn,
} from '../../../shared/ui/data-table/data-table';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { SearchField } from '../../../shared/ui/search-field/search-field';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';
import { PartnerFormDialog, type PartnerFormData } from '../components/partner-form-dialog';
import {
  PARTNER_KINDS,
  PartnersApi,
  type Partner,
  type PartnerKind,
} from '../data-access/partners.api';

const SUPPLIER_COLUMNS: readonly TableColumn[] = [
  { key: 'code', labelKey: 'partners.fields.code', sortable: true, required: true },
  { key: 'name', labelKey: 'partners.fields.name', sortable: true, required: true },
  { key: 'taxCode', labelKey: 'partners.fields.taxCode' },
  { key: 'contactName', labelKey: 'partners.fields.contactName' },
  { key: 'phone', labelKey: 'partners.fields.phone' },
  { key: 'email', labelKey: 'partners.fields.email', hidden: true },
  { key: 'address', labelKey: 'partners.fields.address', hidden: true },
  {
    key: 'paymentTermDays',
    labelKey: 'partners.fields.paymentTermDays',
    sortable: true,
    align: 'end',
  },
  { key: 'receiptCount', labelKey: 'partners.fields.receiptCount', sortable: true, align: 'end' },
  { key: 'status', labelKey: 'partners.fields.status', sortable: true },
  { key: 'actions', labelKey: 'common.actions', required: true, align: 'end' },
];

const CUSTOMER_COLUMNS: readonly TableColumn[] = [
  { key: 'code', labelKey: 'partners.fields.code', sortable: true, required: true },
  { key: 'name', labelKey: 'partners.fields.name', sortable: true, required: true },
  { key: 'type', labelKey: 'partners.fields.type', sortable: true },
  { key: 'taxCode', labelKey: 'partners.fields.taxCode', hidden: true },
  { key: 'contactName', labelKey: 'partners.fields.contactName' },
  { key: 'phone', labelKey: 'partners.fields.phone' },
  { key: 'email', labelKey: 'partners.fields.email', hidden: true },
  { key: 'address', labelKey: 'partners.fields.address', hidden: true },
  { key: 'issueCount', labelKey: 'partners.fields.issueCount', sortable: true, align: 'end' },
  { key: 'status', labelKey: 'partners.fields.status', sortable: true },
  { key: 'actions', labelKey: 'common.actions', required: true, align: 'end' },
];

/** Danh sách nhà cung cấp hoặc khách hàng (loại lấy từ `data.kind` của route). */
@Component({
  selector: 'app-partner-list-page',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
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
  templateUrl: './partner-list-page.html',
})
export class PartnerListPage {
  private readonly api = inject(PartnersApi);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly notifications = inject(NotificationService);
  protected readonly i18n = inject(I18nService);
  protected readonly auth = inject(AuthStore);

  protected readonly kind = inject(ActivatedRoute).snapshot.data['kind'] as PartnerKind;
  protected readonly config = PARTNER_KINDS[this.kind];
  protected readonly isCustomer = this.kind === 'customer';
  protected readonly columns = this.isCustomer ? CUSTOMER_COLUMNS : SUPPLIER_COLUMNS;
  protected readonly statusLabels = PARTNER_STATUS;
  protected readonly statusOptions = Object.keys(PARTNER_STATUS) as PartnerStatus[];
  protected readonly typeLabels = CUSTOMER_TYPE_LABEL_KEYS;
  protected readonly typeOptions = Object.keys(CUSTOMER_TYPE_LABEL_KEYS) as CustomerType[];
  protected readonly canWrite = computed(() => this.auth.hasPermission(this.config.write));

  protected readonly list = injectPagedList<
    Partner,
    { status: string | null; type: string | null }
  >({
    filters: { status: null, type: null },
    sort: { active: 'code', direction: 'asc' },
    fetch: (params) =>
      this.api
        .list(this.kind, toApiQuery(params))
        .pipe(map((page) => ({ ...page, items: page.items as Partner[] }))),
  });

  protected typeLabel(partner: Partner): TranslationKey | null {
    return 'type' in partner ? CUSTOMER_TYPE_LABEL_KEYS[(partner as Customer).type] : null;
  }

  protected countOf(partner: Partner): number {
    return 'issueCount' in partner
      ? (partner as Customer).issueCount
      : (partner as Supplier).receiptCount;
  }

  protected async open(partner?: Partner): Promise<void> {
    if (!this.canWrite()) return;
    const ref = this.dialog.open<PartnerFormDialog, PartnerFormData, Partner>(PartnerFormDialog, {
      data: { kind: this.kind, partner },
      width: '720px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: 'first-tabbable',
    });
    if (await firstValueFrom(ref.afterClosed())) {
      this.list.reload();
    }
  }

  protected async remove(partner: Partner): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: this.i18n.t(this.config.deleteTitle, { name: partner.name }),
      message: this.i18n.t('partners.deleteMessage'),
      confirmText: this.i18n.t('common.delete'),
      cancelText: this.i18n.t('common.cancel'),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await firstValueFrom(this.api.delete(this.kind, partner.id));
      this.notifications.success(this.config.deleted);
      this.list.reload();
    } catch {
      // 409 (đã phát sinh chứng từ) được error interceptor hiển thị.
    }
  }
}
