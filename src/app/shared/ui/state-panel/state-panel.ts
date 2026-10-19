import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * Khối trạng thái thống nhất cho trang/bảng: trống, lỗi, không có quyền, đang phát triển…
 * Nút hành động đặt vào nội dung con.
 */
@Component({
  selector: 'app-state-panel',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.error]': "tone() === 'error'",
    role: 'status',
  },
  template: `
    <mat-icon class="icon" aria-hidden="true">{{ icon() }}</mat-icon>
    <h2>{{ heading() }}</h2>
    @if (message()) {
      <p>{{ message() }}</p>
    }
    <div class="actions"><ng-content /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 48px 24px;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
    }
    .icon {
      width: 56px;
      height: 56px;
      font-size: 56px;
      color: var(--mat-sys-primary);
    }
    :host(.error) .icon {
      color: var(--mat-sys-error);
    }
    h2 {
      font: var(--mat-sys-title-large);
      color: var(--mat-sys-on-surface);
    }
    p {
      max-width: 480px;
      margin: 0;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
  `,
})
export class StatePanel {
  readonly icon = input.required<string>();
  readonly heading = input.required<string>();
  readonly message = input<string>();
  readonly tone = input<'neutral' | 'error'>('neutral');
}
