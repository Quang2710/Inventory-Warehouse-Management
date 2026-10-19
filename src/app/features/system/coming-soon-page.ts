import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { StatePanel } from '../../shared/ui/state-panel/state-panel';

/**
 * Trang giữ chỗ cho module được lên lịch ở giai đoạn sau. Route vẫn được bảo vệ bằng
 * `accessGuard` nên có thể kiểm thử phân quyền ngay từ giai đoạn 0.
 */
@Component({
  selector: 'app-coming-soon-page',
  imports: [StatePanel, MatButtonModule, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-state-panel
      icon="construction"
      [heading]="'system.comingSoonTitle' | t"
      [message]="message()"
    >
      <a mat-stroked-button routerLink="/">{{ 'common.backHome' | t }}</a>
    </app-state-panel>
  `,
})
export class ComingSoonPage {
  private readonly i18n = inject(I18nService);

  /** Khóa dịch tên module — truyền qua `data.moduleKey` của route. */
  readonly moduleKey = input.required<string>();

  protected readonly message = computed(() =>
    this.i18n.t('system.comingSoonMessage', { module: this.i18n.translate(this.moduleKey()) }),
  );
}
