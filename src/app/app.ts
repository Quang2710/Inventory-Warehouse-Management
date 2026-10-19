import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterOutlet } from '@angular/router';

import { TranslatePipe } from './core/i18n/translate.pipe';
import { LoadingService } from './core/loading/loading.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MatProgressBarModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading.isLoading()) {
      <mat-progress-bar
        class="global-progress"
        mode="indeterminate"
        [attr.aria-label]="'common.loading' | t"
      />
    }
    <router-outlet />
  `,
})
export class App {
  protected readonly loading = inject(LoadingService);
}
