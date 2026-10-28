import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { StockItem, StockLot } from '../../core/api';
import { AuthStore } from '../../core/auth/auth.store';
import type { TranslationKey } from '../../core/i18n/i18n.types';
import { DOCUMENT_ROUTES, SERIAL_STATUS } from '../../core/i18n/labels';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { NotificationService } from '../../core/notification/notification.service';
import { CodeLookup, type CodeMatch } from '../../shared/data-access/code-lookup';
import { ProductsApi } from '../../shared/data-access/products.api';
import { StockApi } from '../../shared/data-access/stock.api';
import { CameraScanner } from '../../shared/ui/barcode-scanner/camera-scanner';
import { ExpiryBadge } from '../../shared/ui/expiry-badge/expiry-badge';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { StatusChip } from '../../shared/ui/status-chip/status-chip';

interface ScanResult {
  code: string;
  match: CodeMatch | null;
  stock: StockItem[];
  lots: StockLot[];
}

const HISTORY_SIZE = 8;

/** Quét mã vạch / QR / serial để tra nhanh sản phẩm, tồn theo kho và lô (FEFO). */
@Component({
  selector: 'app-scan-page',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    TranslatePipe,
    PageHeader,
    CameraScanner,
    ExpiryBadge,
    StatusChip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './scan-page.html',
  styles: `
    .layout {
      display: grid;
      grid-template-columns: minmax(280px, 420px) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }
    .manual {
      display: flex;
      gap: 8px;
      align-items: baseline;
    }
    .manual mat-form-field {
      flex: 1;
    }
    .product-name {
      font: var(--mat-sys-title-large);
    }
    .flags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 8px 0;
    }
    .quick {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 8px;
      margin-top: 12px;
    }
    .quick a {
      height: 48px;
    }
    .history {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .not-found {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--mat-sys-error);
    }
    @media (max-width: 959.98px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class ScanPage {
  private readonly lookup = inject(CodeLookup);
  private readonly products = inject(ProductsApi);
  private readonly stockApi = inject(StockApi);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthStore);

  protected readonly serialLabels = SERIAL_STATUS;
  protected readonly matchedByLabels: Readonly<Record<CodeMatch['matchedBy'], TranslationKey>> = {
    barcode: 'scan.matchedBy.barcode',
    sku: 'scan.matchedBy.sku',
    serial: 'scan.matchedBy.serial',
  };
  protected readonly manual = new FormControl('', { nonNullable: true });
  protected readonly cameraOn = signal(true);
  protected readonly busy = signal(false);
  protected readonly result = signal<ScanResult | null>(null);
  protected readonly history = signal<string[]>([]);

  protected readonly can = {
    receive: this.auth.hasPermission('goods-receipt:write'),
    issue: this.auth.hasPermission('goods-issue:write'),
    card: this.auth.hasPermission('stock-movement:read'),
    stock: this.auth.hasPermission('stock:read'),
  };
  protected readonly totalStock = computed(() =>
    (this.result()?.stock ?? []).reduce((sum, item) => sum + item.quantity, 0),
  );

  protected submitManual(): void {
    const code = this.manual.value.trim();
    this.manual.setValue('');
    if (code) void this.lookupCode(code);
  }

  protected async lookupCode(code: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.history.update((list) =>
      [code, ...list.filter((item) => item !== code)].slice(0, HISTORY_SIZE),
    );
    try {
      const match = await this.lookup.resolve(code);
      if (!match) {
        this.result.set({ code, match: null, stock: [], lots: [] });
        return;
      }
      const product = match.product;
      const [stock, lots] = await Promise.all([
        this.can.stock
          ? firstValueFrom(this.products.stockByProduct(product.id))
          : Promise.resolve([]),
        this.can.stock && (product.trackLot || product.trackExpiry)
          ? firstValueFrom(
              this.stockApi.lots({ productId: product.id, size: 20, sort: 'expiryDate,asc' }),
            ).then((page) => page.items)
          : Promise.resolve([]),
      ]);
      this.result.set({ code, match, stock, lots });
    } catch (error) {
      this.notifications.error(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected documentLink(match: CodeMatch): string[] | null {
    const serial = match.serial;
    const path = serial?.lastDocumentType ? DOCUMENT_ROUTES[serial.lastDocumentType] : null;
    return path && serial?.lastDocumentId ? [path, serial.lastDocumentId] : null;
  }
}
