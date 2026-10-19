import { Pipe, inject, type PipeTransform } from '@angular/core';

import { I18nService } from './i18n.service';
import type { TranslationKey, TranslationParams } from './i18n.types';

/**
 * `{{ 'auth.login.title' | t }}` · `{{ 'dashboard.greeting' | t: { name } }}`
 *
 * Impure để cập nhật ngay khi đổi ngôn ngữ (đọc signal ngôn ngữ bên trong);
 * chi phí chỉ là một lần tra object cho mỗi lần kiểm tra thay đổi.
 */
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: TranslationKey, params?: TranslationParams): string {
    return this.i18n.t(key, params);
  }
}
