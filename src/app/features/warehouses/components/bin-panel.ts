import { DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import type { BinStockItem, MapBin } from '../../../core/api';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';

/** Thông tin một ô và danh sách hàng đang chứa (component trình bày). */
@Component({
  selector: 'app-bin-panel',
  imports: [DecimalPipe, PercentPipe, MatIconModule, TranslatePipe, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (bin(); as bin) {
      <h3>{{ 'map.bin.title' | t: { code: bin.code } }}</h3>
      <dl class="facts">
        <dt>{{ 'map.bin.quantity' | t }}</dt>
        <dd>{{ bin.quantity | number }} / {{ bin.capacity | number }}</dd>
        <dt>{{ 'map.bin.fill' | t }}</dt>
        <dd>{{ bin.fillRate | percent: '1.0-0' }}</dd>
      </dl>
      <h4>{{ 'map.bin.products' | t }}</h4>
      @if (loading()) {
        <app-skeleton [rows]="3" />
      } @else if (items().length === 0) {
        <p class="muted">{{ 'map.bin.empty' | t }}</p>
      } @else {
        <ul class="items">
          @for (item of items(); track item.id) {
            <li>
              <span class="items__name">
                <span class="mono">{{ item.sku }}</span>
                {{ item.productName }}
              </span>
              <span class="items__qty">{{ item.quantity | number }} {{ item.unit }}</span>
            </li>
          }
        </ul>
      }
    } @else {
      <p class="hint">
        <mat-icon aria-hidden="true">touch_app</mat-icon>{{ 'map.bin.select' | t }}
      </p>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface);
    }
    h3 {
      font: var(--mat-sys-title-medium);
    }
    h4 {
      margin: 16px 0 8px;
      font: var(--mat-sys-title-small);
    }
    .facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 4px 12px;
      margin: 8px 0 0;
    }
    dt {
      color: var(--mat-sys-on-surface-variant);
    }
    dd {
      margin: 0;
    }
    .items {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .items li {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .items__name {
      display: flex;
      flex-direction: column;
    }
    .items__qty {
      white-space: nowrap;
      font: var(--mat-sys-label-large);
    }
    .hint {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class BinPanel {
  readonly bin = input<MapBin | null>(null);
  readonly items = input<readonly BinStockItem[]>([]);
  readonly loading = input(false);
}
