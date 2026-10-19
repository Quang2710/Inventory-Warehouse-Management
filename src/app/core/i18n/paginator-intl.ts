import { Injectable, effect, inject } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';

import { I18nService } from './i18n.service';

/** Nhãn của mat-paginator theo ngôn ngữ đang chọn. */
@Injectable()
export class AppPaginatorIntl extends MatPaginatorIntl {
  private readonly i18n = inject(I18nService);

  constructor() {
    super();
    effect(() => {
      this.i18n.language();
      this.itemsPerPageLabel = this.i18n.t('common.rowsPerPage');
      this.firstPageLabel = this.i18n.t('common.firstPage');
      this.lastPageLabel = this.i18n.t('common.lastPage');
      this.nextPageLabel = this.i18n.t('common.nextPage');
      this.previousPageLabel = this.i18n.t('common.previousPage');
      this.changes.next();
    });
  }

  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0) {
      return this.i18n.t('common.rangeLabel', { start: 0, end: 0, total: 0 });
    }
    const start = page * pageSize + 1;
    const end = Math.min(length, (page + 1) * pageSize);
    const format = new Intl.NumberFormat('vi-VN');
    return this.i18n.t('common.rangeLabel', {
      start: format.format(start),
      end: format.format(end),
      total: format.format(length),
    });
  };
}
