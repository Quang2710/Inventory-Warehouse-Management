import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { BarcodeFormat } from '@zxing/library';
import { ZXingScannerModule } from '@zxing/ngx-scanner';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/**
 * Quét mã vạch bằng camera (@zxing/ngx-scanner). Được nạp lười — thư viện quét chỉ tải khi
 * người dùng bấm nút camera. Trả về chuỗi mã quét được.
 */
@Component({
  selector: 'app-barcode-scanner-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, ZXingScannerModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ 'stocktakes.count.scannerTitle' | t }}</h2>
    <mat-dialog-content>
      @if (noCamera()) {
        <p class="error" role="alert">
          <mat-icon aria-hidden="true">no_photography</mat-icon
          >{{ 'stocktakes.count.noCamera' | t }}
        </p>
      } @else {
        <p class="hint">{{ 'stocktakes.count.scannerHint' | t }}</p>
        <zxing-scanner
          class="scanner"
          [formats]="formats"
          [tryHarder]="true"
          (scanSuccess)="ref.close($event)"
          (camerasNotFound)="noCamera.set(true)"
          (permissionResponse)="!$event && noCamera.set(true)"
        />
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>{{ 'common.close' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .scanner {
      display: block;
      width: 100%;
      max-width: 480px;
      overflow: hidden;
      border-radius: var(--mat-sys-corner-medium);
    }
    .hint {
      margin-top: 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .error {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--mat-sys-error);
    }
  `,
})
export class BarcodeScannerDialog {
  protected readonly ref = inject<MatDialogRef<BarcodeScannerDialog, string>>(MatDialogRef);
  protected readonly noCamera = signal(false);
  protected readonly formats = [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.UPC_A,
    BarcodeFormat.QR_CODE,
  ];
}
