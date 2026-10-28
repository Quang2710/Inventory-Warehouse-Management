import { Pipe, inject, type PipeTransform } from '@angular/core';
import type { AbstractControl } from '@angular/forms';

import { I18nService } from '../../core/i18n/i18n.service';

/**
 * Thông điệp lỗi tiếng Việt/Anh cho một control: `<mat-error>{{ form.controls.code | fieldError }}</mat-error>`.
 * Lỗi từ server (422) được gắn vào control dưới khóa `server` (xem `applyServerErrors`).
 */
@Pipe({ name: 'fieldError', pure: false })
export class FieldErrorPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(control: AbstractControl | null | undefined): string {
    const errors = control?.errors;
    if (!errors) return '';
    if (errors['server']) return String(errors['server']);
    if (errors['required']) return this.i18n.t('validation.required');
    if (errors['minlength'])
      return this.i18n.t('validation.minlength', { min: errors['minlength'].requiredLength });
    if (errors['maxlength'])
      return this.i18n.t('validation.maxlength', { max: errors['maxlength'].requiredLength });
    if (errors['min']) return this.i18n.t('validation.min', { min: errors['min'].min });
    if (errors['max']) return this.i18n.t('validation.max', { max: errors['max'].max });
    if (errors['email']) return this.i18n.t('validation.email');
    if (errors['integer']) return this.i18n.t('validation.integer');
    if (errors['pattern']) return this.i18n.t('validation.pattern');
    // Validator nghiệp vụ trả { messageKey: TranslationKey, params? } (vd lỗi HSD, số serial).
    for (const error of Object.values(errors) as { messageKey?: unknown; params?: object }[]) {
      if (error && typeof error.messageKey === 'string') {
        return this.i18n.translate(error.messageKey, error.params as Record<string, string>);
      }
    }
    if (typeof errors['message'] === 'string') return errors['message'];
    return this.i18n.t('validation.invalid');
  }
}
