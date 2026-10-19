import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { StatusLabel } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/** Nhãn trạng thái có màu theo sắc thái (thành công, cảnh báo, nguy hiểm…). */
@Component({
  selector: 'app-status-chip',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': "'tone-' + status().tone" },
  template: `{{ status().labelKey | t }}`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      padding: 2px 10px;
      border-radius: var(--mat-sys-corner-full);
      font: var(--mat-sys-label-medium);
      white-space: nowrap;
    }
    :host(.tone-neutral) {
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface-variant);
    }
    :host(.tone-info) {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    :host(.tone-success) {
      background: var(--app-success-container);
      color: var(--app-on-success-container);
    }
    :host(.tone-warning) {
      background: var(--app-warning-container);
      color: var(--app-on-warning-container);
    }
    :host(.tone-danger) {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
  `,
})
export class StatusChip {
  readonly status = input.required<StatusLabel>();
}
