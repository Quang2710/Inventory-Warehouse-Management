import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
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
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { Stocktake, StocktakeLine } from '../../../core/api';
import { AuthStore } from '../../../core/auth/auth.store';
import { I18nService } from '../../../core/i18n/i18n.service';
import { STOCKTAKE_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NotificationService } from '../../../core/notification/notification.service';
import { ConfirmService } from '../../../shared/ui/confirm-dialog/confirm.service';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';
import { StocktakesApi } from '../data-access/stocktakes.api';

type LineFilter = 'all' | 'counted' | 'uncounted' | 'variance';

/** Xem kết quả kiểm kê và xử lý: gửi duyệt, mở lại, duyệt (sinh điều chỉnh tồn), hủy. */
@Component({
  selector: 'app-stocktake-detail-page',
  imports: [
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    TranslatePipe,
    PageHeader,
    StatusChip,
    Skeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stocktake-detail-page.html',
})
export class StocktakeDetailPage {
  private readonly api = inject(StocktakesApi);
  private readonly auth = inject(AuthStore);
  private readonly confirm = inject(ConfirmService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);

  readonly stocktake = input.required<Stocktake>();
  protected readonly current = linkedSignal(() => this.stocktake());
  protected readonly statusLabels = STOCKTAKE_STATUS;
  protected readonly lines = signal<StocktakeLine[] | null>(null);
  protected readonly filter = signal<LineFilter>('variance');
  protected readonly busy = signal(false);

  private readonly inScope = computed(() =>
    this.auth.canAccessWarehouse(this.current().warehouseId),
  );
  protected readonly canCount = computed(
    () =>
      this.inScope() &&
      this.current().status === 'IN_PROGRESS' &&
      this.auth.hasPermission('stocktake:count'),
  );
  protected readonly canDecide = computed(
    () =>
      this.inScope() &&
      this.current().status === 'SUBMITTED' &&
      this.auth.hasPermission('stocktake:approve'),
  );
  protected readonly canCancel = computed(
    () =>
      this.inScope() &&
      ['IN_PROGRESS', 'SUBMITTED'].includes(this.current().status) &&
      this.auth.hasPermission('stocktake:write'),
  );

  protected readonly visibleLines = computed(() => {
    const lines = this.lines() ?? [];
    switch (this.filter()) {
      case 'counted':
        return lines.filter(
          (line) => line.countedQuantity !== null && line.countedQuantity !== undefined,
        );
      case 'uncounted':
        return lines.filter(
          (line) => line.countedQuantity === null || line.countedQuantity === undefined,
        );
      case 'variance':
        return lines.filter((line) => !!line.variance);
      default:
        return lines;
    }
  });

  constructor() {
    queueMicrotask(() => void this.loadLines());
  }

  private async loadLines(): Promise<void> {
    try {
      const lines = await firstValueFrom(this.api.lines(this.current().id));
      this.lines.set(lines);
      if (!lines.some((line) => line.variance)) this.filter.set('all');
    } catch (error) {
      this.notifications.error(error);
      this.lines.set([]);
    }
  }

  protected async submit(): Promise<void> {
    const stocktake = this.current();
    const ok = await this.confirm.confirm({
      title: this.i18n.t('stocktakes.confirmSubmitTitle'),
      message: this.i18n.t('stocktakes.confirmSubmitMessage', {
        counted: stocktake.countedLineCount,
        total: stocktake.lineCount,
      }),
      confirmText: this.i18n.t('stocktakes.actions.submit'),
      cancelText: this.i18n.t('common.cancel'),
    });
    if (ok) await this.run(() => this.api.submit(stocktake.id), 'stocktakes.submitted');
  }

  protected async reopen(): Promise<void> {
    await this.run(() => this.api.reopen(this.current().id), 'stocktakes.reopened');
  }

  protected async approve(): Promise<void> {
    const stocktake = this.current();
    const ok = await this.confirm.confirm({
      title: this.i18n.t('stocktakes.confirmApproveTitle'),
      message: this.i18n.t('stocktakes.confirmApproveMessage', {
        lines: stocktake.varianceLineCount,
        quantity: stocktake.varianceQuantity,
      }),
      confirmText: this.i18n.t('stocktakes.actions.approve'),
      cancelText: this.i18n.t('common.cancel'),
    });
    if (ok) await this.run(() => this.api.approve(stocktake.id), 'stocktakes.approved');
  }

  protected async cancel(): Promise<void> {
    const stocktake = this.current();
    const reason = await this.confirm.prompt({
      title: this.i18n.t('stocktakes.cancelTitle', { code: stocktake.code }),
      message: '',
      label: this.i18n.t('common.reason'),
      confirmText: this.i18n.t('stocktakes.actions.cancel'),
      cancelText: this.i18n.t('common.close'),
      destructive: true,
    });
    if (reason) await this.run(() => this.api.cancel(stocktake.id, reason), 'stocktakes.cancelled');
  }

  private async run(
    action: () => ReturnType<StocktakesApi['submit']>,
    successKey: Parameters<NotificationService['success']>[0],
  ): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      this.current.set(await firstValueFrom(action()));
      this.notifications.success(successKey);
      await this.loadLines();
    } catch {
      // lỗi đã được interceptor hiển thị
    } finally {
      this.busy.set(false);
    }
  }
}
