import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { today } from '../../forms/date-utils';

/** Ngưỡng hiển thị "sắp hết hạn" phía giao diện — cùng mặc định với cảnh báo của server. */
export const EXPIRING_DAYS = 30;

function daysUntil(date: string): number {
  const toUtc = (value: string) =>
    Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10));
  return Math.round((toUtc(date) - toUtc(today())) / 86_400_000);
}

/** Hạn sử dụng kèm số ngày còn lại, tô màu khi sắp hết hạn / đã hết hạn. */
@Component({
  selector: 'app-expiry-badge',
  imports: [DatePipe, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': "'expiry expiry--' + state()" },
  template: `
    @if (date(); as value) {
      <span>{{ value | date }}</span>
      @if (showDays()) {
        <span class="days">{{
          days() < 0
            ? ('expiry.expiredAgo' | t: { days: -days() })
            : ('expiry.daysLeft' | t: { days: days() })
        }}</span>
      }
    } @else {
      —
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px;
      white-space: nowrap;
    }
    .days {
      padding: 0 6px;
      border-radius: var(--mat-sys-corner-full);
      font: var(--mat-sys-label-small);
    }
    :host(.expiry--expiring) .days {
      background: var(--app-warning-container);
      color: var(--app-on-warning-container);
    }
    :host(.expiry--expired) .days {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    :host(.expiry--valid) .days {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class ExpiryBadge {
  readonly date = input<string | null | undefined>(null);
  readonly showDays = input(true);

  protected readonly days = computed(() => {
    const date = this.date();
    return date ? daysUntil(date) : 0;
  });
  protected readonly state = computed(() => {
    if (!this.date()) return 'none';
    const days = this.days();
    return days < 0 ? 'expired' : days <= EXPIRING_DAYS ? 'expiring' : 'valid';
  });
}
