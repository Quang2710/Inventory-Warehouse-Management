import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

import type { BarcodeScannerData } from './barcode-scanner-dialog';

/** Mở dialog quét mã (nạp lười thư viện camera); trả mã đã quét hoặc `null` nếu đóng. */
@Injectable({ providedIn: 'root' })
export class BarcodeScannerService {
  private readonly dialog = inject(MatDialog);

  async scan(data?: BarcodeScannerData): Promise<string | null> {
    const { BarcodeScannerDialog } = await import('./barcode-scanner-dialog');
    const ref = this.dialog.open<InstanceType<typeof BarcodeScannerDialog>, unknown, string>(
      BarcodeScannerDialog,
      { data, width: '540px', maxWidth: 'calc(100vw - 16px)', autoFocus: false },
    );
    return (await firstValueFrom(ref.afterClosed()))?.trim() || null;
  }
}
