import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

import { I18nService } from '../i18n/i18n.service';
import type { TranslationKey, TranslationParams } from '../i18n/i18n.types';

type NotificationKind = 'success' | 'info' | 'warning' | 'error';

/** Thông báo ngắn (snackbar) có đa ngôn ngữ và mức độ ưu tiên cho trình đọc màn hình. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);

  success(key: TranslationKey, params?: TranslationParams): void {
    this.show(this.i18n.t(key, params), 'success');
  }

  info(key: TranslationKey, params?: TranslationParams): void {
    this.show(this.i18n.t(key, params), 'info');
  }

  warning(key: TranslationKey, params?: TranslationParams): void {
    this.show(this.i18n.t(key, params), 'warning');
  }

  /** Hiện lỗi từ một `ApiError`/lỗi bất kỳ bằng thông điệp thân thiện. */
  error(error: unknown): void {
    this.show(this.i18n.errorMessage(error), 'error');
  }

  private show(message: string, kind: NotificationKind): void {
    this.snackBar.open(message, this.i18n.t('common.close'), {
      duration: kind === 'error' ? 6000 : 4000,
      panelClass: ['app-snackbar', `app-snackbar--${kind}`],
      politeness: kind === 'error' ? 'assertive' : 'polite',
    });
  }
}
