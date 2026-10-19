import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { StatePanel } from '../../shared/ui/state-panel/state-panel';

@Component({
  selector: 'app-forbidden-page',
  imports: [StatePanel, MatButtonModule, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-state-panel
      icon="block"
      tone="error"
      [heading]="'system.forbiddenTitle' | t"
      [message]="'system.forbiddenMessage' | t"
    >
      <a mat-stroked-button routerLink="/">{{ 'common.backHome' | t }}</a>
    </app-state-panel>
  `,
})
export class ForbiddenPage {}
