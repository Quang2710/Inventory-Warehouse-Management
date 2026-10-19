import { inject } from '@angular/core';
import type { CanDeactivateFn } from '@angular/router';

import { I18nService } from '../../core/i18n/i18n.service';
import { ConfirmService } from '../ui/confirm-dialog/confirm.service';

/** Trang có form cần cảnh báo khi rời đi mà chưa lưu. */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component.hasUnsavedChanges()) {
    return true;
  }
  const i18n = inject(I18nService);
  return inject(ConfirmService).confirm({
    title: i18n.t('common.unsavedTitle'),
    message: i18n.t('common.unsavedMessage'),
    confirmText: i18n.t('common.leave'),
    cancelText: i18n.t('common.stay'),
    destructive: true,
  });
};
