import { ScrollingModule, type CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { Product, StocktakeLine } from '../../../core/api';
import { I18nService } from '../../../core/i18n/i18n.service';
import { STOCKTAKE_STATUS } from '../../../core/i18n/labels';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { ProductsApi } from '../../../shared/data-access/products.api';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { StatePanel } from '../../../shared/ui/state-panel/state-panel';
import { StatusChip } from '../../../shared/ui/status-chip/status-chip';
import { CountSessionStore } from '../data-access/count-session.store';

type ScanNotice =
  | { kind: 'notFound'; code: string }
  | { kind: 'needsBin' }
  | { kind: 'needsOnline' }
  | { kind: 'unexpected'; product: Product };

const ITEM_HEIGHT = 108;

function normalize(value: string | undefined | null): string {
  return (value ?? '').trim().toUpperCase();
}

/**
 * Đếm hàng kiểm kê — tối ưu cho điện thoại và máy quét cầm tay, hoạt động cả khi mất mạng
 * (xem CountSessionStore). Route: `/stocktakes/:id/count`.
 */
@Component({
  selector: 'app-stocktake-count-page',
  imports: [
    DatePipe,
    DecimalPipe,
    ReactiveFormsModule,
    RouterLink,
    ScrollingModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatProgressBarModule,
    MatTooltipModule,
    TranslatePipe,
    StatusChip,
    StatePanel,
    Skeleton,
  ],
  providers: [CountSessionStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stocktake-count-page.html',
  styleUrl: './stocktake-count-page.scss',
})
export class StocktakeCountPage {
  private readonly dialog = inject(MatDialog);
  private readonly products = inject(ProductsApi);
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(CountSessionStore);

  /** Tham số route `:id`. */
  readonly id = input.required<string>();

  protected readonly statusLabels = STOCKTAKE_STATUS;
  protected readonly itemHeight = ITEM_HEIGHT;
  protected readonly scan = new FormControl('', { nonNullable: true });
  protected readonly binFilter = signal<string | null>(null);
  protected readonly onlyUncounted = signal(false);
  protected readonly incrementMode = signal(false);
  /** Lọc theo mã vừa quét khi một sản phẩm nằm ở nhiều ô. */
  protected readonly scanFilter = signal<string | null>(null);
  protected readonly highlighted = signal<string | null>(null);
  protected readonly notice = signal<ScanNotice | null>(null);
  /** Giá trị đang gõ dở theo dòng (chưa ghi nhận). */
  private readonly drafts = signal<Record<string, string>>({});
  private readonly viewport = viewChild<CdkVirtualScrollViewport>('viewport');

  protected readonly bins = computed(() => {
    const seen = new Map<string, { id: string; code: string; path: string }>();
    for (const line of this.store.lines()) {
      if (!seen.has(line.locationId))
        seen.set(line.locationId, {
          id: line.locationId,
          code: line.locationCode,
          path: line.locationPath,
        });
    }
    return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true }));
  });

  protected readonly visibleLines = computed(() => {
    const bin = this.binFilter();
    const code = this.scanFilter();
    return this.store
      .lines()
      .filter((line) => !bin || line.locationId === bin)
      .filter((line) => !this.onlyUncounted() || line.countedQuantity === null)
      .filter((line) => !code || normalize(line.barcode) === code || normalize(line.sku) === code)
      .sort(
        (a, b) =>
          a.locationCode.localeCompare(b.locationCode, 'vi', { numeric: true }) ||
          a.sku.localeCompare(b.sku),
      );
  });

  protected readonly selectedBinCode = computed(
    () => this.bins().find((bin) => bin.id === this.binFilter())?.code ?? '',
  );
  protected readonly trackLine = (_index: number, line: StocktakeLine): string => line.id;

  protected readonly progress = computed(() => {
    const total = this.store.lines().length;
    return total ? this.store.countedCount() / total : 0;
  });

  /** Dòng còn số đếm chưa đồng bộ. */
  protected readonly pendingLines = computed(() => {
    const keys = new Set<string>();
    for (const entry of this.store.pending()) {
      keys.add(entry.lineId ?? `local-${entry.clientId}`);
      if (entry.locationId && entry.productId) keys.add(`${entry.locationId}|${entry.productId}`);
    }
    return keys;
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.store.load(id));
    });
  }

  protected isPending(line: StocktakeLine): boolean {
    return (
      this.pendingLines().has(line.id) ||
      this.pendingLines().has(`${line.locationId}|${line.productId}`)
    );
  }

  protected draftOf(line: StocktakeLine): string {
    return (
      this.drafts()[line.id] ?? (line.countedQuantity === null ? '' : String(line.countedQuantity))
    );
  }

  protected setDraft(line: StocktakeLine, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.drafts.update((drafts) => ({ ...drafts, [line.id]: value }));
  }

  /** Ghi nhận giá trị đang gõ (Enter / rời ô). */
  protected async commit(line: StocktakeLine): Promise<void> {
    const raw = this.drafts()[line.id];
    if (raw === undefined) return;
    this.drafts.update(({ [line.id]: _removed, ...rest }) => rest);
    const value = Number(raw);
    if (
      raw.trim() === '' ||
      !Number.isInteger(value) ||
      value < 0 ||
      value === line.countedQuantity
    )
      return;
    await this.store.count(line, value);
  }

  protected async step(line: StocktakeLine, delta: number): Promise<void> {
    const base = Number(this.draftOf(line) || 0);
    this.drafts.update(({ [line.id]: _removed, ...rest }) => rest);
    await this.store.count(line, Math.max(0, base + delta));
  }

  protected async onScan(): Promise<void> {
    const code = normalize(this.scan.value);
    this.scan.setValue('');
    this.notice.set(null);
    if (!code) return;
    await this.handleCode(code);
  }

  protected async openCamera(): Promise<void> {
    const { BarcodeScannerDialog } = await import('../components/barcode-scanner-dialog');
    const ref = this.dialog.open<InstanceType<typeof BarcodeScannerDialog>, unknown, string>(
      BarcodeScannerDialog,
      {
        width: '520px',
        maxWidth: 'calc(100vw - 16px)',
      },
    );
    const code = await firstValueFrom(ref.afterClosed());
    if (code) {
      this.notice.set(null);
      await this.handleCode(normalize(code));
    }
  }

  private async handleCode(code: string): Promise<void> {
    const bin = this.binFilter();
    const matches = this.store
      .lines()
      .filter((line) => normalize(line.barcode) === code || normalize(line.sku) === code)
      .filter((line) => !bin || line.locationId === bin);

    if (matches.length === 1) {
      this.scanFilter.set(null);
      const [line] = matches;
      if (this.incrementMode() && this.store.editable()) {
        await this.store.count(line, (line.countedQuantity ?? 0) + 1);
      }
      this.focusLine(line);
      return;
    }
    if (matches.length > 1) {
      this.scanFilter.set(code); // cùng sản phẩm ở nhiều ô → thu hẹp danh sách
      return;
    }
    // Không có trong danh sách chốt → có thể là hàng thừa trong ô đang đếm.
    if (!this.store.online()) {
      this.notice.set({ kind: 'needsOnline' });
      return;
    }
    try {
      const product = await firstValueFrom(this.products.byBarcode(code));
      this.notice.set(bin ? { kind: 'unexpected', product } : { kind: 'needsBin' });
    } catch {
      this.notice.set({ kind: 'notFound', code });
    }
  }

  protected async addUnexpected(product: Product): Promise<void> {
    const bin = this.bins().find((item) => item.id === this.binFilter());
    if (!bin) return;
    await this.store.countUnexpected(
      product,
      { locationId: bin.id, locationCode: bin.code, locationPath: bin.path },
      1,
    );
    this.notice.set(null);
    const line = this.store
      .lines()
      .find((item) => item.locationId === bin.id && item.productId === product.id);
    if (line) this.focusLine(line);
  }

  protected clearScanFilter(): void {
    this.scanFilter.set(null);
  }

  /** Cuộn tới dòng, làm nổi bật và đặt con trỏ vào ô số đếm. */
  private focusLine(line: StocktakeLine): void {
    this.highlighted.set(line.id);
    const index = this.visibleLines().findIndex((item) => item.id === line.id);
    if (index < 0) return;
    this.viewport()?.scrollToIndex(index, 'smooth');
    setTimeout(() => {
      const input = document.getElementById(`count-${line.id}`) as HTMLInputElement | null;
      input?.focus();
      input?.select();
    }, 250);
  }
}
