import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { Transfer } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import { isApiError } from '../../../core/http/api-error';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { TranslationKey } from '../../../core/i18n/i18n.types';
import { TRANSFER_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { ConfirmService } from '../../../shared/ui/confirm-dialog/confirm.service';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';
import { ReceiveDialog } from '../components/receive-dialog';
import { TransfersApi } from '../data-access/transfers.api';

interface TimelineEntry {
  labelKey: TranslationKey;
  icon: string;
  at: string;
  by?: string;
  note?: string;
}

/** Chi tiết phiếu chuyển kho + thao tác theo trạng thái (xuất đi, nhận, hủy, sửa, xóa). */
@Component({
  selector: 'app-transfer-detail-page',
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    TranslatePipe,
    PageHeader,
    StatusChip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transfer-detail-page.html',
  styleUrl: './transfer-detail-page.scss',
})
export class TransferDetailPage {
  private readonly api = inject(TransfersApi);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthStore);
  protected readonly i18n = inject(I18nService);

  readonly transfer = input.required<Transfer>();
  protected readonly current = linkedSignal(() => this.transfer());
  protected readonly statusLabels = TRANSFER_STATUS;
  protected readonly busy = signal(false);
  /** Lỗi thiếu tồn theo chỉ số dòng (từ 422 INSUFFICIENT_STOCK khi xuất đi). */
  protected readonly lineErrors = signal<Record<number, string>>({});

  private readonly atSource = computed(() =>
    this.auth.canAccessWarehouse(this.current().fromWarehouseId),
  );
  private readonly atDestination = computed(() =>
    this.auth.canAccessWarehouse(this.current().toWarehouseId),
  );
  protected readonly canEdit = computed(
    () =>
      this.current().status === 'DRAFT' &&
      this.auth.hasPermission('transfer:write') &&
      this.atSource(),
  );
  protected readonly canReceive = computed(
    () =>
      this.current().status === 'IN_TRANSIT' &&
      this.auth.hasPermission('transfer:receive') &&
      this.atDestination(),
  );
  protected readonly canCancel = computed(
    () =>
      this.current().status === 'IN_TRANSIT' &&
      this.auth.hasPermission('transfer:write') &&
      this.atSource(),
  );
  protected readonly shortfall = computed(() =>
    this.current().status === 'RECEIVED'
      ? this.current().lines.reduce(
          (sum, line) => sum + line.quantity - (line.receivedQuantity ?? 0),
          0,
        )
      : 0,
  );

  protected readonly timeline = computed<TimelineEntry[]>(() => {
    const transfer = this.current();
    const entries: TimelineEntry[] = [
      {
        labelKey: 'transfers.timeline.created',
        icon: 'edit_note',
        at: transfer.createdAt,
        by: transfer.createdBy.fullName,
      },
    ];
    if (transfer.shippedAt) {
      entries.push({
        labelKey: 'transfers.timeline.shipped',
        icon: 'local_shipping',
        at: transfer.shippedAt,
        by: transfer.shippedBy?.fullName,
      });
    }
    if (transfer.receivedAt) {
      entries.push({
        labelKey: 'transfers.timeline.received',
        icon: 'inventory',
        at: transfer.receivedAt,
        by: transfer.receivedBy?.fullName,
        note: transfer.receiveNote,
      });
    }
    if (transfer.cancelledAt) {
      entries.push({
        labelKey: 'transfers.timeline.cancelled',
        icon: 'cancel',
        at: transfer.cancelledAt,
        by: transfer.cancelledBy?.fullName,
        note: transfer.cancelReason,
      });
    }
    return entries;
  });

  protected async ship(): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: this.i18n.t('transfers.confirmShipTitle'),
      message: this.i18n.t('transfers.confirmShipMessage'),
      confirmText: this.i18n.t('transfers.actions.ship'),
      cancelText: this.i18n.t('common.cancel'),
    });
    if (!confirmed) return;
    await this.run(async () => {
      this.lineErrors.set({});
      try {
        this.current.set(await firstValueFrom(this.api.ship(this.current().id)));
        this.notifications.success('transfers.shipped');
      } catch (error) {
        if (isApiError(error) && error.status === 422) {
          const errors: Record<number, string> = {};
          for (const [path, messages] of Object.entries(error.details)) {
            const index = Number(/^lines\.(\d+)\./.exec(path)?.[1]);
            if (Number.isInteger(index)) errors[index] = messages[0];
          }
          this.lineErrors.set(errors);
        }
        this.notifications.error(error);
      }
    });
  }

  protected async receive(): Promise<void> {
    const ref = this.dialog.open<ReceiveDialog, Transfer, Transfer>(ReceiveDialog, {
      data: this.current(),
      width: '820px',
      maxWidth: 'calc(100vw - 32px)',
    });
    const received = await firstValueFrom(ref.afterClosed());
    if (received) this.current.set(received);
  }

  protected async cancel(): Promise<void> {
    const reason = await this.confirm.prompt({
      title: this.i18n.t('transfers.cancelTitle', { code: this.current().code }),
      message: this.i18n.t('transfers.cancelHintInTransit'),
      label: this.i18n.t('common.reason'),
      confirmText: this.i18n.t('transfers.actions.cancel'),
      cancelText: this.i18n.t('common.close'),
      destructive: true,
    });
    if (!reason) return;
    await this.run(async () => {
      this.current.set(await firstValueFrom(this.api.cancel(this.current().id, reason)));
      this.notifications.success('transfers.cancelled');
    });
  }

  protected async remove(): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: this.i18n.t('transfers.confirmDeleteTitle', { code: this.current().code }),
      message: '',
      confirmText: this.i18n.t('common.delete'),
      cancelText: this.i18n.t('common.cancel'),
      destructive: true,
    });
    if (!confirmed) return;
    await this.run(async () => {
      await firstValueFrom(this.api.delete(this.current().id));
      this.notifications.success('transfers.deleted');
      await this.router.navigate(['/transfers']);
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await action();
    } catch {
      // lỗi đã được hiển thị (interceptor hoặc nhánh xử lý riêng)
    } finally {
      this.busy.set(false);
    }
  }
}
