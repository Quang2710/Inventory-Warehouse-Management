import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

import { PromptDialog, type PromptDialogData } from '../prompt-dialog/prompt-dialog';
import { ConfirmDialog, type ConfirmDialogData } from './confirm-dialog';

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialog = inject(MatDialog);

  /** Trả về `true` khi người dùng xác nhận. */
  async confirm(data: ConfirmDialogData): Promise<boolean> {
    const ref = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data,
      width: '440px',
      maxWidth: 'calc(100vw - 32px)',
      // Focus nút đầu tiên ("Hủy") — lựa chọn an toàn cho thao tác nguy hiểm.
      autoFocus: 'first-tabbable',
      role: 'alertdialog',
    });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }

  /** Hỏi một nội dung bắt buộc (vd lý do hủy). `undefined` nếu người dùng bỏ qua. */
  async prompt(data: PromptDialogData): Promise<string | undefined> {
    const ref = this.dialog.open<PromptDialog, PromptDialogData, string>(PromptDialog, {
      data,
      width: '480px',
      maxWidth: 'calc(100vw - 32px)',
    });
    return firstValueFrom(ref.afterClosed());
  }
}
