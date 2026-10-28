import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { ExpiryBadge } from '../expiry-badge/expiry-badge';

/** Một phần lấy hàng (contract `StockPick` / `TransferPick`). */
export interface PickView {
  locationCode?: string | null;
  lotNumber?: string | null;
  expiryDate?: string | null;
  quantity: number;
  serialNumbers?: string[];
}

/** Danh sách phần lấy hàng theo thứ tự FEFO: ô · lô · HSD × số lượng (+ serial). */
@Component({
  selector: 'app-stock-picks',
  imports: [DecimalPipe, MatIconModule, MatTooltipModule, TranslatePipe, ExpiryBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (pick of picks(); track $index) {
      <span class="doc-pick">
        @if (pick.locationCode) {
          <span class="mono">{{ pick.locationCode }}</span>
        }
        @if (pick.lotNumber) {
          <span class="lot" [matTooltip]="'lots.lotNumber' | t">{{ pick.lotNumber }}</span>
        }
        @if (pick.expiryDate) {
          <app-expiry-badge [date]="pick.expiryDate" [showDays]="showDays()" />
        }
        <strong>× {{ pick.quantity | number }}</strong>
        @if (pick.serialNumbers?.length) {
          <mat-icon
            class="serial-icon"
            [matTooltip]="pick.serialNumbers!.join(', ')"
            [attr.aria-label]="('serials.title' | t) + ': ' + pick.serialNumbers!.join(', ')"
            >qr_code_2</mat-icon
          >
        }
      </span>
    } @empty {
      <span class="doc-muted">—</span>
    }
  `,
  styles: `
    .lot {
      padding: 0 6px;
      border-radius: var(--mat-sys-corner-extra-small);
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font: var(--mat-sys-label-medium);
    }
    .serial-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
      cursor: help;
    }
  `,
})
export class StockPicks {
  readonly picks = input.required<readonly PickView[]>();
  readonly showDays = input(true);
}
