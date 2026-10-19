import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/** Khối giữ chỗ khi tải lần đầu (thay cho spinner toàn trang). */
@Component({
  selector: 'app-skeleton',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="visually-hidden" role="status">{{ 'common.loading' | t }}</span>
    @for (line of lines(); track line) {
      <span class="line" [style.width.%]="line"></span>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 0;
    }
    .line {
      height: 16px;
      border-radius: 4px;
      background: linear-gradient(
        90deg,
        var(--mat-sys-surface-container-high) 25%,
        var(--mat-sys-surface-container-highest) 50%,
        var(--mat-sys-surface-container-high) 75%
      );
      background-size: 200% 100%;
      animation: shimmer 1.2s ease-in-out infinite;
    }
    @keyframes shimmer {
      from {
        background-position: 200% 0;
      }
      to {
        background-position: -200% 0;
      }
    }
  `,
})
export class Skeleton {
  readonly rows = input(6);
  protected readonly lines = computed(() =>
    Array.from({ length: this.rows() }, (_, index) => [100, 92, 96, 70, 88, 60][index % 6]),
  );
}
