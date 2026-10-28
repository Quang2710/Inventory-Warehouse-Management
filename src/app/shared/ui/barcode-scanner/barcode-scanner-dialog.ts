import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { CameraScanner } from './camera-scanner';

export interface BarcodeScannerData {
  title?: string;
  hint?: string;
}

/**
 * Quét một mã bằng camera, có ô nhập tay dự phòng (mã mờ, không có camera). Nạp lười qua
 * `BarcodeScannerService` — thư viện quét chỉ tải khi người dùng bấm nút camera.
 */
@Component({
  selector: 'app-barcode-scanner-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    TranslatePipe,
    CameraScanner,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data?.title ?? ('scanner.title' | t) }}</h2>
    <mat-dialog-content>
      <p class="hint">{{ data?.hint ?? ('scanner.hint' | t) }}</p>
      <app-camera-scanner (detected)="ref.close($event)" />
      <form class="manual" (submit)="$event.preventDefault(); submitManual()">
        <mat-form-field class="manual__field">
          <mat-label>{{ 'scanner.manual' | t }}</mat-label>
          <input matInput [formControl]="manual" autocomplete="off" />
        </mat-form-field>
        <button mat-stroked-button type="submit" [disabled]="!manual.value.trim()">
          {{ 'common.confirm' | t }}
        </button>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>{{ 'common.close' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    app-camera-scanner {
      width: min(480px, 100%);
    }
    .hint {
      margin-top: 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .manual {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-top: 12px;
    }
    .manual__field {
      flex: 1;
    }
  `,
})
export class BarcodeScannerDialog {
  protected readonly ref = inject<MatDialogRef<BarcodeScannerDialog, string>>(MatDialogRef);
  protected readonly data = inject<BarcodeScannerData | null>(MAT_DIALOG_DATA, { optional: true });
  protected readonly manual = new FormControl('', { nonNullable: true });

  protected submitManual(): void {
    const code = this.manual.value.trim();
    if (code) this.ref.close(code);
  }
}
