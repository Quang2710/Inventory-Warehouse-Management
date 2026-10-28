import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import type { TranslationKey } from '../../core/i18n/i18n.types';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { PageHeader } from '../../shared/ui/page-header/page-header';

const TABS: readonly { path: string; labelKey: TranslationKey; exact: boolean }[] = [
  { path: '/stock', labelKey: 'stock.tabs.items', exact: true },
  { path: '/stock/lots', labelKey: 'stock.tabs.lots', exact: false },
  { path: '/stock/serials', labelKey: 'stock.tabs.serials', exact: false },
];

/** Tồn kho: theo kho · theo lô/HSD · serial (mỗi tab một route, giữ bộ lọc trên URL). */
@Component({
  selector: 'app-stock-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatTabsModule, TranslatePipe, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header [heading]="'stock.title' | t" [subtitle]="'stock.subtitle' | t" />
    <nav mat-tab-nav-bar [tabPanel]="panel" [attr.aria-label]="'stock.title' | t">
      @for (tab of tabs; track tab.path) {
        <a
          mat-tab-link
          [routerLink]="tab.path"
          routerLinkActive
          #active="routerLinkActive"
          [routerLinkActiveOptions]="{ exact: tab.exact }"
          [active]="active.isActive"
          >{{ tab.labelKey | t }}</a
        >
      }
    </nav>
    <mat-tab-nav-panel #panel class="panel"><router-outlet /></mat-tab-nav-panel>
  `,
  styles: `
    .panel {
      display: block;
      padding-top: 16px;
    }
  `,
})
export class StockShell {
  protected readonly tabs = TABS;
}
