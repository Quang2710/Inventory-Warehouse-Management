import { type WritableSignal, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { type Observable, firstValueFrom } from 'rxjs';

import type { DocumentStatus } from '../../core/api';
import { isApiError } from '../../core/http/api-error';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/i18n.types';
import { NotificationService } from '../../core/notification/notification.service';
import { ConfirmService } from '../ui/confirm-dialog/confirm.service';

/** Chứng từ có quy trình duyệt (phiếu nhập, phiếu xuất). */
export interface WorkflowDocument {
  id: string;
  code: string;
  status: DocumentStatus;
}

export interface WorkflowApi<T> {
  submit(id: string): Observable<T>;
  approve(id: string): Observable<T>;
  reject(id: string, reason: string): Observable<T>;
  cancel(id: string, reason: string): Observable<T>;
  delete(id: string): Observable<void>;
}

export interface WorkflowOptions<T extends WorkflowDocument> {
  api: WorkflowApi<T>;
  current: WritableSignal<T>;
  listPath: string;
  /** Gợi ý riêng khi hủy chứng từ đã duyệt (vd phiếu nhập: hàng đã xuất thì không hủy được). */
  cancelHintKey: TranslationKey;
  approveMessageKey: TranslationKey;
}

/**
 * Thao tác quy trình dùng chung cho màn chi tiết chứng từ: xác nhận → gọi API → cập nhật
 * chứng từ hiện tại → thông báo. Lỗi 422 theo dòng (`lines.{i}.*`) được gom vào `lineErrors`.
 */
export class DocumentWorkflow<T extends WorkflowDocument> {
  private readonly confirm = inject(ConfirmService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  readonly busy = signal(false);
  /** Lỗi theo chỉ số dòng từ response 422 (thiếu tồn, serial không hợp lệ…). */
  readonly lineErrors = signal<Record<number, string[]>>({});

  constructor(private readonly options: WorkflowOptions<T>) {}

  async submit(): Promise<void> {
    const doc = this.options.current();
    const confirmed = await this.confirm.confirm({
      title: this.i18n.t('documents.confirmSubmitTitle', { code: doc.code }),
      message: this.i18n.t('documents.confirmSubmitMessage'),
      confirmText: this.i18n.t('documents.actions.submit'),
      cancelText: this.i18n.t('common.cancel'),
    });
    if (confirmed) {
      await this.run(() => this.options.api.submit(doc.id), 'documents.submitted');
    }
  }

  async approve(): Promise<void> {
    const doc = this.options.current();
    const confirmed = await this.confirm.confirm({
      title: this.i18n.t('documents.confirmApproveTitle', { code: doc.code }),
      message: this.i18n.t(this.options.approveMessageKey),
      confirmText: this.i18n.t('documents.actions.approve'),
      cancelText: this.i18n.t('common.cancel'),
    });
    if (confirmed) {
      await this.run(() => this.options.api.approve(doc.id), 'documents.approved');
    }
  }

  async reject(): Promise<void> {
    const doc = this.options.current();
    const reason = await this.confirm.prompt({
      title: this.i18n.t('documents.rejectTitle', { code: doc.code }),
      message: this.i18n.t('documents.rejectHint'),
      label: this.i18n.t('common.reason'),
      confirmText: this.i18n.t('documents.actions.reject'),
      cancelText: this.i18n.t('common.close'),
      destructive: true,
    });
    if (reason) {
      await this.run(() => this.options.api.reject(doc.id, reason), 'documents.rejected');
    }
  }

  async cancel(): Promise<void> {
    const doc = this.options.current();
    const reason = await this.confirm.prompt({
      title: this.i18n.t('documents.cancelTitle', { code: doc.code }),
      message: this.i18n.t(this.options.cancelHintKey),
      label: this.i18n.t('common.reason'),
      confirmText: this.i18n.t('documents.actions.cancel'),
      cancelText: this.i18n.t('common.close'),
      destructive: true,
    });
    if (reason) {
      await this.run(() => this.options.api.cancel(doc.id, reason), 'documents.cancelled');
    }
  }

  async remove(): Promise<void> {
    const doc = this.options.current();
    const confirmed = await this.confirm.confirm({
      title: this.i18n.t('documents.confirmDeleteTitle', { code: doc.code }),
      message: this.i18n.t('documents.confirmDeleteMessage'),
      confirmText: this.i18n.t('common.delete'),
      cancelText: this.i18n.t('common.cancel'),
      destructive: true,
    });
    if (!confirmed || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.options.api.delete(doc.id));
      this.notifications.success('documents.deleted', { code: doc.code });
      await this.router.navigate([this.options.listPath]);
    } catch (error) {
      this.notifications.error(error);
    } finally {
      this.busy.set(false);
    }
  }

  private async run(action: () => Observable<T>, successKey: TranslationKey): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.lineErrors.set({});
    try {
      const updated = await firstValueFrom(action());
      this.options.current.set(updated);
      this.notifications.success(successKey, { code: updated.code });
    } catch (error) {
      if (isApiError(error) && error.status === 422) {
        const errors: Record<number, string[]> = {};
        for (const [path, messages] of Object.entries(error.details)) {
          const index = Number(/^lines\.(\d+)\./.exec(path)?.[1]);
          if (Number.isInteger(index)) errors[index] = [...(errors[index] ?? []), ...messages];
        }
        this.lineErrors.set(errors);
      }
      this.notifications.error(error);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Tạo DocumentWorkflow trong injection context (field initializer của component). */
export function injectDocumentWorkflow<T extends WorkflowDocument>(
  options: WorkflowOptions<T>,
): DocumentWorkflow<T> {
  return new DocumentWorkflow(options);
}
